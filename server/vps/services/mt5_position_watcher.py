"""
PositionWatcher — monitora le posizioni aperte MT5 e genera eventi per il StrategyExecutor.

Ogni N secondi confronta lo snapshot corrente delle posizioni con quello precedente
per ogni utente registrato. Quando rileva un cambiamento, emette un evento asincrono
verso il callback on_event, che tipicamente chiama StrategyExecutor.on_event().

Eventi generati:
  position_closed   — un ticket è sparito (TP, SL o chiusura manuale/EA)
  position_opened   — un ticket è apparso (nuova posizione rilevata)
  position_modified — SL o TP di una posizione esistente sono cambiati

Design:
  - Task asyncio unico che itera sugli utenti registrati ogni POLL_INTERVAL secondi.
  - Per ogni utente: una sola sessione MT5 sincrona (initialize → snapshot → shutdown)
    eseguita nel ThreadPoolExecutor single-worker condiviso con RangeOrderWatcher.
    MT5 è un singleton per processo: le sessioni devono essere seriali.
  - Il primo ciclo dopo la registrazione di un utente è "di inizializzazione":
    imposta il baseline senza emettere eventi, per evitare falsi "position_closed"
    al boot del server.
  - asyncio.Lock per utente: on_event_callback è async e potrebbe impiegare
    qualche secondo; il lock evita che un secondo ciclo del watcher scateni
    un evento mentre il primo è ancora in elaborazione.

Nota sui conflitti MT5: il PositionWatcher usa lo stesso _executor single-worker del
RangeOrderWatcher, garantendo che non vi siano mai due sessioni MT5 attive
contemporaneamente nello stesso processo.
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Awaitable, Callable

from vps.services.mt5_trader import MT5Trader

logger = logging.getLogger(__name__)

# Single-worker condiviso concettualmente con RangeOrderWatcher.
# MT5 è un singleton per processo → una sola sessione alla volta.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mt5-pos-watch")

POLL_INTERVAL = 8   # secondi tra un ciclo e il successivo


# ── Tipo del callback on_event ─────────────────────────────────────────────

OnEventCallback = Callable[[str, str, dict], Awaitable[None]]
# firma: on_event(user_id, event_type, event_data) → None


# ── Strutture dati ─────────────────────────────────────────────────────────

@dataclass
class _UserCreds:
    user_id:             str
    mt5_login:           int
    mt5_password:        str
    mt5_server:          str
    user_dir:            Path
    management_strategy: str


@dataclass
class _PositionSnapshot:
    """Stato minimo di una posizione per rilevare i cambiamenti."""
    ticket:          int
    symbol:          str
    order_type:      str          # "BUY" | "SELL"
    lots:            float
    entry_price:     float
    sl:              float | None
    tp:              float | None
    open_time:       str          # ISO UTC
    signal_group_id: str | None


# ── Classe principale ──────────────────────────────────────────────────────

class PositionWatcher:
    """
    Avvio:
        watcher = PositionWatcher(mt5_trader=trader, on_event=callback)
        watcher.start()
        watcher.register_user(user_id, user_dict)
        await watcher.stop()
    """

    def __init__(
        self,
        mt5_trader: MT5Trader,
        on_event: OnEventCallback,
    ) -> None:
        self._trader    = mt5_trader
        self._on_event  = on_event

        # user_id → credenziali
        self._creds: dict[str, _UserCreds] = {}

        # user_id → snapshot precedente {ticket: _PositionSnapshot}
        self._prev: dict[str, dict[int, _PositionSnapshot]] = {}

        # user_id → True se il primo ciclo (baseline) è già stato fatto
        self._initialized: set[str] = set()

        # Per utente: lock che impedisce eventi sovrapposti
        self._event_locks: dict[str, asyncio.Lock] = {}

        self._task: asyncio.Task | None = None

    # ── API pubblica ───────────────────────────────────────────────────────

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="position-watcher")
        logger.info("PositionWatcher avviato (poll ogni %ds)", POLL_INTERVAL)

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("PositionWatcher fermato")

    def register_user(self, user_id: str, user_dict: dict) -> None:
        """
        Registra un utente per il monitoraggio.
        user_dict deve avere: mt5_login, mt5_password, mt5_server, management_strategy.
        """
        mt5_login    = user_dict.get("mt5_login")
        mt5_password = user_dict.get("mt5_password")
        mt5_server   = user_dict.get("mt5_server")

        if not (mt5_login and mt5_password and mt5_server):
            logger.debug("PositionWatcher: utente %s senza credenziali MT5 — skip", user_id)
            return

        management_strategy = user_dict.get("management_strategy") or ""
        if not management_strategy.strip():
            logger.debug(
                "PositionWatcher: utente %s senza management_strategy — non monitorato",
                user_id,
            )
            return

        user_dir = self._trader._users_dir / user_id
        self._creds[user_id] = _UserCreds(
            user_id             = user_id,
            mt5_login           = int(mt5_login),
            mt5_password        = mt5_password,
            mt5_server          = mt5_server,
            user_dir            = user_dir,
            management_strategy = management_strategy,
        )
        self._event_locks.setdefault(user_id, asyncio.Lock())
        logger.info("PositionWatcher: utente %s registrato", user_id)

    def unregister_user(self, user_id: str) -> None:
        self._creds.pop(user_id, None)
        self._prev.pop(user_id, None)
        self._initialized.discard(user_id)
        logger.info("PositionWatcher: utente %s de-registrato", user_id)

    def update_strategy(self, user_id: str, new_strategy: str) -> None:
        """Aggiorna la management_strategy di un utente già registrato."""
        if user_id in self._creds:
            self._creds[user_id].management_strategy = new_strategy

    # ── Loop interno ───────────────────────────────────────────────────────

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(POLL_INTERVAL)

            if not self._creds:
                continue

            snapshot_users = list(self._creds.items())

            for user_id, creds in snapshot_users:
                await self._process_user(user_id, creds)

    async def _process_user(self, user_id: str, creds: _UserCreds) -> None:
        """
        Per un singolo utente: ottiene lo snapshot corrente, confronta con
        il precedente, emette gli eventi rilevati.
        """
        loop = asyncio.get_event_loop()
        try:
            current: dict[int, _PositionSnapshot] = await loop.run_in_executor(
                _executor,
                _snapshot_sync,
                self._trader,
                creds,
            )
        except Exception as exc:
            logger.warning(
                "PositionWatcher utente %s: snapshot fallito — %s",
                user_id, exc,
            )
            return

        prev = self._prev.get(user_id, {})

        if user_id not in self._initialized:
            # Primo ciclo: imposta baseline, non emette eventi
            self._prev[user_id] = current
            self._initialized.add(user_id)
            logger.info(
                "PositionWatcher utente %s: baseline inizializzato (%d posizioni)",
                user_id, len(current),
            )
            return

        # ── Confronto ─────────────────────────────────────────────────────
        events: list[tuple[str, dict]] = []

        prev_tickets    = set(prev.keys())
        current_tickets = set(current.keys())

        # Posizioni chiuse
        for ticket in prev_tickets - current_tickets:
            old_pos  = prev[ticket]
            close_ev = await self._build_close_event(creds, old_pos)
            events.append(("position_closed", close_ev))
            logger.info(
                "PositionWatcher utente %s: posizione #%d %s %s chiusa (motivo: %s)",
                user_id, ticket, old_pos.order_type, old_pos.symbol,
                close_ev.get("reason", "?"),
            )

        # Posizioni aperte (nuove)
        for ticket in current_tickets - prev_tickets:
            new_pos = current[ticket]
            events.append(("position_opened", _snapshot_to_dict(new_pos)))
            logger.info(
                "PositionWatcher utente %s: posizione #%d %s %s aperta",
                user_id, ticket, new_pos.order_type, new_pos.symbol,
            )

        # Posizioni modificate (SL o TP cambiato)
        for ticket in prev_tickets & current_tickets:
            old = prev[ticket]
            new = current[ticket]
            if old.sl != new.sl or old.tp != new.tp:
                events.append(("position_modified", {
                    "ticket":  ticket,
                    "symbol":  new.symbol,
                    "old_sl":  old.sl,
                    "new_sl":  new.sl,
                    "old_tp":  old.tp,
                    "new_tp":  new.tp,
                    "signal_group_id": new.signal_group_id,
                }))
                logger.debug(
                    "PositionWatcher utente %s: pos #%d modificata SL %s→%s TP %s→%s",
                    user_id, ticket, old.sl, new.sl, old.tp, new.tp,
                )

        # Aggiorna baseline
        self._prev[user_id] = current

        # Emetti eventi in sequenza (rispetta il lock per utente)
        if events:
            lock = self._event_locks.setdefault(user_id, asyncio.Lock())
            async with lock:
                for event_type, event_data in events:
                    try:
                        await self._on_event(user_id, event_type, event_data)
                    except Exception as exc:
                        logger.error(
                            "PositionWatcher utente %s: on_event callback errore: %s",
                            user_id, exc, exc_info=True,
                        )

    async def _build_close_event(
        self,
        creds: _UserCreds,
        old_pos: _PositionSnapshot,
    ) -> dict:
        """
        Costruisce il dizionario dell'evento position_closed.
        Recupera il deal di chiusura da MT5 per ottenere motivo e prezzo di chiusura.
        """
        loop = asyncio.get_event_loop()
        deal = await loop.run_in_executor(
            _executor,
            self._trader.get_last_closed_deal_sync,
            creds.user_id,
            creds.mt5_login,
            creds.mt5_password,
            creds.mt5_server,
            old_pos.ticket,
        )

        close_price  = deal["price"]  if deal else None
        close_profit = deal["profit"] if deal else None
        close_reason = deal["reason"] if deal else "UNKNOWN"
        close_time   = deal["close_time"] if deal else datetime.now(timezone.utc).isoformat()

        return {
            "ticket":          old_pos.ticket,
            "symbol":          old_pos.symbol,
            "order_type":      old_pos.order_type,
            "lots":            old_pos.lots,
            "entry_price":     old_pos.entry_price,
            "close_price":     close_price,
            "sl":              old_pos.sl,
            "tp":              old_pos.tp,
            "profit":          close_profit,
            "reason":          close_reason,   # "TP" | "SL" | "CLIENT" | "EXPERT" | ...
            "open_time":       old_pos.open_time,
            "close_time":      close_time,
            "signal_group_id": old_pos.signal_group_id,
        }


# ── Sync helpers (girano in ThreadPoolExecutor) ────────────────────────────

def _snapshot_sync(
    trader: MT5Trader,
    creds: _UserCreds,
) -> dict[int, _PositionSnapshot]:
    """
    Apre una sessione MT5, prende lo snapshot delle posizioni, la chiude.
    Ritorna {ticket: _PositionSnapshot}.
    """
    raw = trader.get_positions_sync(
        creds.user_id,
        creds.mt5_login,
        creds.mt5_password,
        creds.mt5_server,
    )
    result: dict[int, _PositionSnapshot] = {}
    for ticket, pos in raw.items():
        result[ticket] = _PositionSnapshot(
            ticket          = pos["ticket"],
            symbol          = pos["symbol"],
            order_type      = pos["order_type"],
            lots            = pos["lots"],
            entry_price     = pos["entry_price"],
            sl              = pos["sl"],
            tp              = pos["tp"],
            open_time       = pos["open_time"],
            signal_group_id = pos.get("signal_group_id"),
        )
    return result


def _snapshot_to_dict(snap: _PositionSnapshot) -> dict:
    return {
        "ticket":          snap.ticket,
        "symbol":          snap.symbol,
        "order_type":      snap.order_type,
        "lots":            snap.lots,
        "entry_price":     snap.entry_price,
        "sl":              snap.sl,
        "tp":              snap.tp,
        "open_time":       snap.open_time,
        "signal_group_id": snap.signal_group_id,
    }
