"""
SignalLogStore — persistenza dei log di elaborazione segnali su SQLite.

Usa lo stesso file users.db per poter fare JOIN con la tabella users.

Schema:
  signal_logs(
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,      -- Telegram user_id
    ts              TEXT NOT NULL,      -- ISO timestamp UTC
    sender_name     TEXT,               -- nome del mittente Telegram
    message_text    TEXT NOT NULL,      -- testo raw del messaggio
    is_signal       INTEGER NOT NULL DEFAULT 0,  -- 1 se Flash ha detto YES
    flash_raw       TEXT,               -- risposta testuale raw di Gemini Flash
    has_mt5_creds   INTEGER NOT NULL DEFAULT 0,  -- 1 se aveva credenziali MT5
    sizing_strategy TEXT,               -- strategia sizing dell'utente al momento
    account_info    TEXT,               -- JSON dict info conto MT5 (balance, equity…)
    signals_json    TEXT,               -- JSON array di TradeSignal estratti
    results_json    TEXT,               -- JSON array di TradeResult
    error_step      TEXT,               -- nome dello step che ha fallito (es. "flash")
    error_msg       TEXT                -- messaggio di errore
  )
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS signal_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT    NOT NULL,
    ts              TEXT    NOT NULL,
    sender_name     TEXT,
    message_text    TEXT    NOT NULL,
    is_signal       INTEGER NOT NULL DEFAULT 0,
    flash_raw       TEXT,
    has_mt5_creds   INTEGER NOT NULL DEFAULT 0,
    sizing_strategy TEXT,
    account_info    TEXT,
    signals_json    TEXT,
    results_json    TEXT,
    error_step      TEXT,
    error_msg       TEXT
)
"""

_CREATE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_signal_logs_user_id ON signal_logs(user_id)
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SignalLogStore:
    """
    Log di elaborazione segnali.

    Uso:
        store = SignalLogStore(db_path)
        await store.init()

        log_id = await store.insert(
            user_id="123",
            sender_name="Trader X",
            message_text="BUY XAUUSD @ 2300 SL 2290 TP 2320",
            is_signal=True,
            flash_raw="YES",
            has_mt5_creds=True,
            sizing_strategy="risk 1% per trade",
            account_info={"balance": 10000, ...},
            signals_json=[{"symbol": "XAUUSD", ...}],
            results_json=[{"success": True, "order_id": 12345, ...}],
        )

        logs = await store.get_by_user_id("123", limit=50, offset=0)
    """

    def __init__(self, db_path: Path):
        self._db_path = db_path

    async def init(self) -> None:
        """Crea la tabella e l'indice se non esistono."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.execute(_CREATE_INDEX)
            await db.commit()

    async def insert(
        self,
        *,
        user_id: str,
        sender_name: str | None,
        message_text: str,
        is_signal: bool = False,
        flash_raw: str | None = None,
        has_mt5_creds: bool = False,
        sizing_strategy: str | None = None,
        account_info: dict | None = None,
        signals: list[Any] | None = None,
        results: list[Any] | None = None,
        error_step: str | None = None,
        error_msg: str | None = None,
        ts: str | None = None,
    ) -> int:
        """
        Inserisce un log di elaborazione.
        Ritorna l'id del record inserito.
        """
        ts = ts or _now_iso()

        signals_json = json.dumps(signals) if signals is not None else None
        results_json = json.dumps(results) if results is not None else None
        account_info_json = json.dumps(account_info) if account_info is not None else None

        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                """
                INSERT INTO signal_logs
                    (user_id, ts, sender_name, message_text,
                     is_signal, flash_raw,
                     has_mt5_creds, sizing_strategy, account_info,
                     signals_json, results_json,
                     error_step, error_msg)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    ts,
                    sender_name,
                    message_text,
                    1 if is_signal else 0,
                    flash_raw,
                    1 if has_mt5_creds else 0,
                    sizing_strategy,
                    account_info_json,
                    signals_json,
                    results_json,
                    error_step,
                    error_msg,
                ),
            )
            await db.commit()
            return cursor.lastrowid  # type: ignore[return-value]

    async def get_by_user_id(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """Ritorna i log più recenti per un utente (ordinati dal più nuovo)."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT * FROM signal_logs
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                (user_id, limit, offset),
            )
            rows = await cursor.fetchall()

        return [_row_to_dict(row) for row in rows]

    async def count_by_user_id(self, user_id: str) -> int:
        """Conta i log totali per un utente."""
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT COUNT(*) FROM signal_logs WHERE user_id = ?",
                (user_id,),
            )
            row = await cursor.fetchone()
        return row[0] if row else 0


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_dict(row: aiosqlite.Row) -> dict:
    d = dict(row)
    # Deserializza i campi JSON
    for field in ("account_info", "signals_json", "results_json"):
        raw = d.get(field)
        if raw:
            try:
                d[field] = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                d[field] = None
    # Converti i booleani
    d["is_signal"]     = bool(d.get("is_signal", 0))
    d["has_mt5_creds"] = bool(d.get("has_mt5_creds", 0))
    return d
