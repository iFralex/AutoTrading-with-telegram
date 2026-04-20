"""
BacktestStore — persistenza dei run di backtesting su SQLite (users.db).

Tabelle:
  backtest_runs   — un record per ogni run (metadati + statistiche aggregate)
  backtest_trades — ogni trade simulato con esito e dettagli
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

_CREATE_RUNS = """
CREATE TABLE IF NOT EXISTS backtest_runs (
    id                      TEXT    PRIMARY KEY,
    user_id                 TEXT    NOT NULL,
    group_id                TEXT    NOT NULL,
    group_name              TEXT,
    started_at              TEXT    NOT NULL,
    completed_at            TEXT,
    status                  TEXT    NOT NULL DEFAULT 'running',
    error_msg               TEXT,

    mode                    TEXT    NOT NULL,
    limit_value             TEXT    NOT NULL,
    use_ai                  INTEGER NOT NULL DEFAULT 0,
    starting_balance_usd    REAL    DEFAULT 1000,

    total_messages          INTEGER,
    period_from             TEXT,
    period_to               TEXT,

    flash_calls             INTEGER DEFAULT 0,
    flash_tokens_in         INTEGER DEFAULT 0,
    flash_tokens_out        INTEGER DEFAULT 0,
    flash_cost_usd          REAL    DEFAULT 0,
    flash_time_seconds      REAL    DEFAULT 0,
    pro_calls               INTEGER DEFAULT 0,
    pro_tokens_in           INTEGER DEFAULT 0,
    pro_tokens_out          INTEGER DEFAULT 0,
    pro_cost_usd            REAL    DEFAULT 0,
    pro_time_seconds        REAL    DEFAULT 0,
    pretrade_calls          INTEGER DEFAULT 0,
    pretrade_tokens_in      INTEGER DEFAULT 0,
    pretrade_tokens_out     INTEGER DEFAULT 0,
    pretrade_cost_usd       REAL    DEFAULT 0,
    total_ai_cost_usd       REAL    DEFAULT 0,
    total_ai_seconds        REAL    DEFAULT 0,

    total_pnl_usd           REAL,
    avg_pnl_usd             REAL,
    best_trade_usd          REAL,
    worst_trade_usd         REAL,
    max_drawdown_usd        REAL,
    final_balance_usd       REAL,

    signals_detected        INTEGER DEFAULT 0,
    signal_detection_rate   REAL    DEFAULT 0,
    signals_extracted       INTEGER DEFAULT 0,

    total_trades            INTEGER DEFAULT 0,
    trades_filled           INTEGER DEFAULT 0,
    trades_not_filled       INTEGER DEFAULT 0,
    trades_open_at_end      INTEGER DEFAULT 0,
    winning_trades          INTEGER DEFAULT 0,
    losing_trades           INTEGER DEFAULT 0,
    win_rate                REAL    DEFAULT 0,
    total_pnl_pips          REAL    DEFAULT 0,
    avg_pnl_pips            REAL    DEFAULT 0,
    best_trade_pips         REAL    DEFAULT 0,
    worst_trade_pips        REAL    DEFAULT 0,
    profit_factor           REAL,
    max_drawdown_pips       REAL    DEFAULT 0,
    sharpe_ratio            REAL,
    avg_trade_duration_min  REAL    DEFAULT 0,
    avg_rr_ratio            REAL,

    ai_approved             INTEGER DEFAULT 0,
    ai_rejected             INTEGER DEFAULT 0,
    ai_modified             INTEGER DEFAULT 0,

    symbol_stats_json       TEXT,
    sender_stats_json       TEXT,
    time_stats_json         TEXT,
    bars_coverage_json      TEXT,
    equity_curve_json       TEXT
)
"""

_CREATE_TRADES = """
CREATE TABLE IF NOT EXISTS backtest_trades (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT    NOT NULL REFERENCES backtest_runs(id),
    user_id          TEXT    NOT NULL,
    msg_id           INTEGER,
    msg_ts           TEXT,
    sender_name      TEXT,
    message_text     TEXT,
    symbol           TEXT,
    order_type       TEXT,
    order_mode       TEXT,
    entry_price_raw  TEXT,
    stop_loss        REAL,
    take_profit      REAL,
    lot_size         REAL,
    actual_entry     REAL,
    actual_entry_ts  TEXT,
    exit_price       REAL,
    exit_ts          TEXT,
    outcome          TEXT,
    pnl_pips         REAL,
    pnl_usd          REAL,
    duration_min     REAL,
    ai_approved      INTEGER,
    ai_reason        TEXT
)
"""

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_backtest_runs_user ON backtest_runs(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades(run_id)",
    "CREATE INDEX IF NOT EXISTS idx_backtest_trades_user ON backtest_trades(user_id)",
]

_MIGRATIONS = [
    "ALTER TABLE backtest_runs ADD COLUMN pretrade_tokens_in  INTEGER DEFAULT 0",
    "ALTER TABLE backtest_runs ADD COLUMN pretrade_tokens_out INTEGER DEFAULT 0",
    "ALTER TABLE backtest_runs ADD COLUMN starting_balance_usd REAL DEFAULT 1000",
    "ALTER TABLE backtest_runs ADD COLUMN total_pnl_usd    REAL",
    "ALTER TABLE backtest_runs ADD COLUMN avg_pnl_usd      REAL",
    "ALTER TABLE backtest_runs ADD COLUMN best_trade_usd   REAL",
    "ALTER TABLE backtest_runs ADD COLUMN worst_trade_usd  REAL",
    "ALTER TABLE backtest_runs ADD COLUMN max_drawdown_usd REAL",
    "ALTER TABLE backtest_runs ADD COLUMN final_balance_usd REAL",
    "ALTER TABLE backtest_trades ADD COLUMN pnl_usd REAL",
    "ALTER TABLE backtest_trades ADD COLUMN chart_bars_json TEXT",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BacktestStore:

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path

    async def init(self) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_RUNS)
            await db.execute(_CREATE_TRADES)
            for idx in _INDEXES:
                await db.execute(idx)
            for migration in _MIGRATIONS:
                try:
                    await db.execute(migration)
                except Exception:
                    pass
            await db.commit()

    # ── Run lifecycle ─────────────────────────────────────────────────────────

    async def create_run(
        self,
        run_id: str,
        user_id: str,
        group_id: str,
        group_name: str | None,
        mode: str,
        limit_value: str,
        use_ai: bool,
        starting_balance_usd: float = 1000.0,
    ) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """
                INSERT INTO backtest_runs
                    (id, user_id, group_id, group_name, started_at, status,
                     mode, limit_value, use_ai, starting_balance_usd)
                VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
                """,
                (run_id, user_id, group_id, group_name, _now_iso(),
                 mode, limit_value, int(use_ai), starting_balance_usd),
            )
            await db.commit()

    async def update_run(self, run_id: str, **fields) -> None:
        if not fields:
            return
        # Serialize JSON blobs
        for k in ("symbol_stats_json", "sender_stats_json", "time_stats_json",
                  "bars_coverage_json", "equity_curve_json"):
            if k in fields and not isinstance(fields[k], str):
                fields[k] = json.dumps(fields[k], ensure_ascii=False)
        cols = ", ".join(f"{k} = ?" for k in fields)
        vals = list(fields.values()) + [run_id]
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(f"UPDATE backtest_runs SET {cols} WHERE id = ?", vals)
            await db.commit()

    async def finish_run(self, run_id: str, stats: dict) -> None:
        stats["completed_at"] = _now_iso()
        stats["status"] = "done"
        await self.update_run(run_id, **stats)

    async def fail_run(self, run_id: str, error_msg: str) -> None:
        await self.update_run(run_id, status="error", error_msg=error_msg,
                              completed_at=_now_iso())

    # ── Trade insert ──────────────────────────────────────────────────────────

    async def insert_trades(self, trades: list[dict]) -> None:
        if not trades:
            return
        rows = [
            (
                t["run_id"], t["user_id"],
                t.get("msg_id"), t.get("msg_ts"), t.get("sender_name"),
                t.get("message_text", "")[:500],
                t.get("symbol"), t.get("order_type"), t.get("order_mode"),
                str(t.get("entry_price_raw")),
                t.get("stop_loss"), t.get("take_profit"), t.get("lot_size"),
                t.get("actual_entry"), t.get("actual_entry_ts"),
                t.get("exit_price"), t.get("exit_ts"),
                t.get("outcome"), t.get("pnl_pips"), t.get("pnl_usd"), t.get("duration_min"),
                int(t["ai_approved"]) if t.get("ai_approved") is not None else None,
                t.get("ai_reason"),
                json.dumps(t["chart_bars_json"], ensure_ascii=False)
                    if t.get("chart_bars_json") else None,
            )
            for t in trades
        ]
        async with aiosqlite.connect(self._db_path) as db:
            await db.executemany(
                """
                INSERT INTO backtest_trades
                    (run_id, user_id, msg_id, msg_ts, sender_name, message_text,
                     symbol, order_type, order_mode, entry_price_raw,
                     stop_loss, take_profit, lot_size,
                     actual_entry, actual_entry_ts, exit_price, exit_ts,
                     outcome, pnl_pips, pnl_usd, duration_min, ai_approved, ai_reason,
                     chart_bars_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                rows,
            )
            await db.commit()

    # ── Queries ───────────────────────────────────────────────────────────────

    async def get_run(self, run_id: str) -> dict | None:
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("SELECT * FROM backtest_runs WHERE id = ?", (run_id,))
            row = await cur.fetchone()
        if row is None:
            return None
        d = dict(row)
        for k in ("symbol_stats_json", "sender_stats_json", "time_stats_json",
                  "bars_coverage_json", "equity_curve_json"):
            if d.get(k):
                try:
                    d[k] = json.loads(d[k])
                except Exception:
                    pass
        return d

    async def get_trades(self, run_id: str) -> list[dict]:
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT * FROM backtest_trades WHERE run_id = ? ORDER BY msg_ts ASC",
                (run_id,),
            )
            rows = await cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("chart_bars_json"):
                try:
                    d["chart_bars_json"] = json.loads(d["chart_bars_json"])
                except Exception:
                    d["chart_bars_json"] = None
            result.append(d)
        return result

    async def list_runs(self, user_id: str) -> list[dict]:
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                """
                SELECT id, user_id, group_id, group_name, started_at, completed_at,
                       status, error_msg, mode, limit_value, use_ai,
                       total_messages, period_from, period_to,
                       total_ai_cost_usd, total_ai_seconds,
                       signals_detected, signals_extracted, total_trades,
                       winning_trades, losing_trades, win_rate,
                       total_pnl_pips, profit_factor, max_drawdown_pips, sharpe_ratio
                FROM backtest_runs
                WHERE user_id = ?
                ORDER BY started_at DESC
                """,
                (user_id,),
            )
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def delete_run(self, run_id: str) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("DELETE FROM backtest_trades WHERE run_id = ?", (run_id,))
            await db.execute("DELETE FROM backtest_runs WHERE id = ?", (run_id,))
            await db.commit()
