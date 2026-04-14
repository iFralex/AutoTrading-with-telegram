"""
StrategyLogStore — persistenza dei log di esecuzione strategia su SQLite.

Registra ogni invocazione del StrategyExecutor: evento scatenante, strategy
text, lista di tool call eseguite, risposta finale dell'AI e eventuali errori.
Usa lo stesso file users.db per coerenza con gli altri store.

Schema:
  strategy_logs(
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             TEXT    NOT NULL,
    ts                  TEXT    NOT NULL,           -- ISO timestamp UTC
    event_type          TEXT    NOT NULL,           -- "pre_trade" | "position_closed" | ...
    event_data_json     TEXT,                       -- JSON del contesto evento
    management_strategy TEXT,                       -- snapshot della strategia al momento
    tool_calls_json     TEXT,                       -- JSON array [{name, args, result}, ...]
    final_response      TEXT,                       -- testo finale dell'AI
    signals_json        TEXT,                       -- segnali pre-trade (solo event_type=pre_trade)
    decisions_json      TEXT,                       -- decisioni pre-trade (solo event_type=pre_trade)
    error_msg           TEXT                        -- errore se l'agente è andato in errore
  )
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS strategy_logs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             TEXT    NOT NULL,
    ts                  TEXT    NOT NULL,
    event_type          TEXT    NOT NULL,
    event_data_json     TEXT,
    management_strategy TEXT,
    tool_calls_json     TEXT,
    final_response      TEXT,
    signals_json        TEXT,
    decisions_json      TEXT,
    error_msg           TEXT
)
"""

_CREATE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_strategy_logs_user_id ON strategy_logs(user_id)
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class StrategyLogStore:
    """
    Log di esecuzione dell'AI strategy agent.

    Uso:
        store = StrategyLogStore(db_path)
        await store.init()

        await store.insert(
            user_id="123",
            event_type="position_closed",
            event_data={"ticket": 1001, "symbol": "XAUUSD", ...},
            management_strategy="...",
            tool_calls=[{"name": "get_open_positions", "args": {}, "result": [...]}],
            final_response="Ho spostato SL a break even per i ticket #1002 e #1003.",
        )
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path

    async def init(self) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.execute(_CREATE_INDEX)
            await db.commit()

    async def insert(
        self,
        *,
        user_id: str,
        event_type: str,
        event_data: dict | None = None,
        management_strategy: str | None = None,
        tool_calls: list[dict] | None = None,
        final_response: str | None = None,
        signals: list[Any] | None = None,
        decisions: list[Any] | None = None,
        error_msg: str | None = None,
        ts: str | None = None,
    ) -> int:
        ts = ts or _now_iso()

        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                """
                INSERT INTO strategy_logs
                    (user_id, ts, event_type,
                     event_data_json, management_strategy,
                     tool_calls_json, final_response,
                     signals_json, decisions_json, error_msg)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    ts,
                    event_type,
                    json.dumps(event_data, default=str)  if event_data  is not None else None,
                    management_strategy,
                    json.dumps(tool_calls, default=str)  if tool_calls  is not None else None,
                    final_response,
                    json.dumps(signals,    default=str)  if signals     is not None else None,
                    json.dumps(decisions,  default=str)  if decisions   is not None else None,
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
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT * FROM strategy_logs
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                (user_id, limit, offset),
            )
            rows = await cursor.fetchall()
        return [_row_to_dict(row) for row in rows]

    async def count_by_user_id(self, user_id: str) -> int:
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT COUNT(*) FROM strategy_logs WHERE user_id = ?",
                (user_id,),
            )
            row = await cursor.fetchone()
        return row[0] if row else 0


def _row_to_dict(row: aiosqlite.Row) -> dict:
    d = dict(row)
    for field in ("event_data_json", "tool_calls_json", "signals_json", "decisions_json"):
        raw = d.pop(field, None)
        key = field.replace("_json", "")
        if raw:
            try:
                d[key] = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                d[key] = None
        else:
            d[key] = None
    return d
