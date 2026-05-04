"""
MessageContextManager — in-memory per-group context for multi-message signal handling.

Maintains:
  - A rolling buffer of recent messages (history)
  - Pending signals: partial signals that opened preliminary positions and are
    waiting for a follow-up message to arrive before the timeout expires
"""

from __future__ import annotations

import time
import uuid
from collections import deque
from dataclasses import dataclass, field

HISTORY_SIZE = 20  # messages kept per group


@dataclass
class MessageRecord:
    text: str
    timestamp: float           # time.time()
    message_id: int | None = None
    was_signal: bool = False
    signal_group_id: str | None = None


@dataclass
class PendingSignal:
    pending_id: str
    trigger_text: str
    created_at: float          # time.time()
    timeout_seconds: int
    trade_group_ids: list[str] = field(default_factory=list)   # signal_group_id of preliminary trades
    ticket_ids: list[int]      = field(default_factory=list)   # MT5 order/position tickets
    symbol: str | None = None
    direction: str | None = None
    notes: str = ""            # AI context note for follow-up evaluation

    @property
    def is_expired(self) -> bool:
        return time.time() - self.created_at > self.timeout_seconds

    @property
    def age_seconds(self) -> float:
        return time.time() - self.created_at


class MessageContextManager:
    """
    Stateful per-(user_id, group_id) context for the multi-message pipeline.

    One instance is shared across all calls for the same channel; it lives
    entirely in memory and resets on server restart.
    """

    def __init__(self) -> None:
        self._history: deque[MessageRecord] = deque(maxlen=HISTORY_SIZE)
        self._pending: dict[str, PendingSignal] = {}

    # ── History ───────────────────────────────────────────────────────────────

    def add_message(
        self,
        text: str,
        message_id: int | None = None,
        was_signal: bool = False,
        signal_group_id: str | None = None,
    ) -> None:
        self._history.append(MessageRecord(
            text=text,
            timestamp=time.time(),
            message_id=message_id,
            was_signal=was_signal,
            signal_group_id=signal_group_id,
        ))

    def get_history(self) -> list[MessageRecord]:
        return list(self._history)

    # ── Pending signals ───────────────────────────────────────────────────────

    def add_pending(
        self,
        trigger_text: str,
        timeout_seconds: int,
        trade_group_ids: list[str] | None = None,
        ticket_ids: list[int] | None = None,
        symbol: str | None = None,
        direction: str | None = None,
        notes: str = "",
    ) -> str:
        pending_id = str(uuid.uuid4())[:12]
        self._pending[pending_id] = PendingSignal(
            pending_id=pending_id,
            trigger_text=trigger_text,
            created_at=time.time(),
            timeout_seconds=timeout_seconds,
            trade_group_ids=trade_group_ids or [],
            ticket_ids=ticket_ids or [],
            symbol=symbol,
            direction=direction,
            notes=notes,
        )
        return pending_id

    def get_pending(self) -> list[PendingSignal]:
        """Return active (non-expired) pending signals."""
        self._cleanup_expired()
        return list(self._pending.values())

    def resolve_pending(self, pending_id: str) -> PendingSignal | None:
        """Remove and return a pending signal (e.g. when it is completed)."""
        return self._pending.pop(pending_id, None)

    def pop_expired(self) -> list[PendingSignal]:
        """Remove and return all expired pending signals."""
        expired = [p for p in self._pending.values() if p.is_expired]
        for p in expired:
            del self._pending[p.pending_id]
        return expired

    def has_pending(self) -> bool:
        self._cleanup_expired()
        return bool(self._pending)

    def _cleanup_expired(self) -> None:
        expired_ids = [pid for pid, p in self._pending.items() if p.is_expired]
        for pid in expired_ids:
            del self._pending[pid]

    # ── Prompt formatting ─────────────────────────────────────────────────────

    def format_for_prompt(self) -> str:
        """
        Render history + pending signals as text to inject into an AI prompt.
        Returns empty string when there is nothing useful.
        """
        lines: list[str] = []

        history = self.get_history()
        if history:
            lines.append("Recent messages in this group (oldest first):")
            for rec in history:
                age = int(time.time() - rec.timestamp)
                tag = " [was a trading signal]" if rec.was_signal else ""
                lines.append(f"  [{age}s ago]{tag} {rec.text[:300]}")
            lines.append("")

        pending = self.get_pending()
        if pending:
            lines.append("Pending signals awaiting follow-up:")
            for ps in pending:
                meta = (
                    f"pending_id={ps.pending_id}, "
                    f"age={int(ps.age_seconds)}s, "
                    f"timeout={ps.timeout_seconds}s"
                    + (f", {ps.direction} {ps.symbol}" if ps.symbol else "")
                )
                lines.append(f"  [{meta}] Trigger: '{ps.trigger_text[:200]}'")
                if ps.notes:
                    lines.append(f"    Notes: {ps.notes}")
            lines.append("")

        return "\n".join(lines)
