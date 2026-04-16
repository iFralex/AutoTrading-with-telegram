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
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id              TEXT    NOT NULL,
    ts                   TEXT    NOT NULL,
    sender_name          TEXT,
    message_text         TEXT    NOT NULL,
    is_signal            INTEGER NOT NULL DEFAULT 0,
    flash_raw            TEXT,
    has_mt5_creds        INTEGER NOT NULL DEFAULT 0,
    sizing_strategy      TEXT,
    account_info         TEXT,
    signals_json         TEXT,
    results_json         TEXT,
    error_step           TEXT,
    error_msg            TEXT,
    telegram_message_id  INTEGER,
    signal_group_id      TEXT
)
"""

_CREATE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_signal_logs_user_id ON signal_logs(user_id)
"""

_CREATE_INDEX_MSG_ID = """
CREATE INDEX IF NOT EXISTS idx_signal_logs_tg_msg_id
    ON signal_logs(user_id, telegram_message_id)
"""

_MIGRATIONS = [
    "ALTER TABLE signal_logs ADD COLUMN telegram_message_id INTEGER",
    "ALTER TABLE signal_logs ADD COLUMN signal_group_id TEXT",
]


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
        """Crea la tabella, gli indici e applica le migration se non esistono."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.execute(_CREATE_INDEX)
            await db.execute(_CREATE_INDEX_MSG_ID)
            await db.commit()
            for sql in _MIGRATIONS:
                try:
                    await db.execute(sql)
                    await db.commit()
                except Exception:
                    pass

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
        telegram_message_id: int | None = None,
        signal_group_id: str | None = None,
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
                     error_step, error_msg,
                     telegram_message_id, signal_group_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    telegram_message_id,
                    signal_group_id,
                ),
            )
            await db.commit()
            return cursor.lastrowid  # type: ignore[return-value]

    async def get_by_telegram_message_id(
        self, user_id: str, telegram_message_id: int
    ) -> dict | None:
        """
        Cerca un log per message_id Telegram.
        Ritorna il record se era un segnale, None altrimenti.
        """
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT * FROM signal_logs
                WHERE user_id = ? AND telegram_message_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (user_id, telegram_message_id),
            )
            row = await cursor.fetchone()

        if row is None:
            return None
        return _row_to_dict(row)

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

    async def get_stats_by_user_id(self, user_id: str) -> dict:
        """
        Calcola statistiche aggregate complete per un utente dai signal_logs.
        Usa query SQL aggregate dove possibile, Python per i campi JSON.
        """
        import json as _json
        from datetime import datetime as _dt

        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row

            # ── 1. Contatori base ──────────────────────────────────────────
            cur = await db.execute(
                """
                SELECT
                  COUNT(*) AS total_messages,
                  COALESCE(SUM(is_signal), 0) AS total_signals,
                  COALESCE(SUM(CASE WHEN error_step IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_errors,
                  COALESCE(SUM(CASE WHEN results_json IS NOT NULL THEN 1 ELSE 0 END), 0) AS messages_with_orders
                FROM signal_logs WHERE user_id = ?
                """,
                (user_id,),
            )
            base = dict(await cur.fetchone())

            # ── 2. Trend giornaliero (ultimi 90 giorni) ───────────────────
            cur = await db.execute(
                """
                SELECT
                  date(ts) AS day,
                  COUNT(*) AS messages,
                  COALESCE(SUM(is_signal), 0) AS signals,
                  COALESCE(SUM(CASE WHEN results_json IS NOT NULL THEN 1 ELSE 0 END), 0) AS orders_sent
                FROM signal_logs
                WHERE user_id = ? AND date(ts) >= date('now', '-90 days')
                GROUP BY date(ts)
                ORDER BY day ASC
                """,
                (user_id,),
            )
            daily_stats = [dict(r) for r in await cur.fetchall()]

            # ── 3. Distribuzione oraria ───────────────────────────────────
            cur = await db.execute(
                """
                SELECT
                  CAST(strftime('%H', ts) AS INTEGER) AS hour,
                  COUNT(*) AS messages,
                  COALESCE(SUM(is_signal), 0) AS signals
                FROM signal_logs
                WHERE user_id = ?
                GROUP BY strftime('%H', ts)
                ORDER BY hour ASC
                """,
                (user_id,),
            )
            hourly_distribution = [dict(r) for r in await cur.fetchall()]

            # ── 4. Top senders ────────────────────────────────────────────
            cur = await db.execute(
                """
                SELECT sender_name, COUNT(*) AS count
                FROM signal_logs
                WHERE user_id = ? AND sender_name IS NOT NULL
                GROUP BY sender_name
                ORDER BY count DESC
                LIMIT 10
                """,
                (user_id,),
            )
            top_senders = [dict(r) for r in await cur.fetchall()]

            # ── 5. Errori per step ────────────────────────────────────────
            cur = await db.execute(
                """
                SELECT error_step, COUNT(*) AS count
                FROM signal_logs
                WHERE user_id = ? AND error_step IS NOT NULL
                GROUP BY error_step
                ORDER BY count DESC
                """,
                (user_id,),
            )
            errors_by_step = [dict(r) for r in await cur.fetchall()]

            # ── 6. Righe con JSON per analisi dettagliata ─────────────────
            cur = await db.execute(
                """
                SELECT ts, signals_json, results_json, account_info
                FROM signal_logs
                WHERE user_id = ? AND (signals_json IS NOT NULL OR account_info IS NOT NULL)
                ORDER BY id ASC
                """,
                (user_id,),
            )
            json_rows = await cur.fetchall()

        # ── Analisi JSON in Python ─────────────────────────────────────────
        all_executions: list[dict] = []
        all_signal_items: list[dict] = []
        balance_trend: list[dict] = []

        for row in json_rows:
            ts_val, signals_raw, results_raw, acc_raw = (
                row["ts"], row["signals_json"], row["results_json"], row["account_info"]
            )

            if signals_raw:
                try:
                    for s in _json.loads(signals_raw):
                        s["ts"] = ts_val
                        all_signal_items.append(s)
                except Exception:
                    pass

            if results_raw:
                try:
                    for r in _json.loads(results_raw):
                        r["ts"] = ts_val
                        all_executions.append(r)
                except Exception:
                    pass

            if acc_raw:
                try:
                    acc = _json.loads(acc_raw)
                    if acc.get("balance") is not None:
                        balance_trend.append({
                            "ts":      ts_val,
                            "balance": acc.get("balance"),
                            "equity":  acc.get("equity"),
                        })
                except Exception:
                    pass

        # ── Statistiche ordini ────────────────────────────────────────────
        total_execs = len(all_executions)
        successful  = sum(1 for e in all_executions if e.get("success"))
        failed      = total_execs - successful

        # ── Per simbolo ───────────────────────────────────────────────────
        sym_map: dict[str, dict] = {}
        for ex in all_executions:
            sig = ex.get("signal") or {}
            sym = (sig.get("symbol") or "UNKNOWN").upper()
            if sym not in sym_map:
                sym_map[sym] = {
                    "symbol": sym,
                    "total": 0, "successful": 0, "failed": 0,
                    "buy": 0, "sell": 0, "lots": [],
                }
            sym_map[sym]["total"] += 1
            if ex.get("success"):
                sym_map[sym]["successful"] += 1
            else:
                sym_map[sym]["failed"] += 1
            ot = (sig.get("order_type") or "").upper()
            if ot == "BUY":
                sym_map[sym]["buy"] += 1
            elif ot == "SELL":
                sym_map[sym]["sell"] += 1
            if sig.get("lot_size"):
                sym_map[sym]["lots"].append(float(sig["lot_size"]))

        by_symbol = []
        for s in sorted(sym_map.values(), key=lambda x: x["total"], reverse=True):
            lots = s.pop("lots")
            s["avg_lot"]      = round(sum(lots) / len(lots), 3) if lots else None
            s["success_rate"] = round(s["successful"] / s["total"] * 100, 1) if s["total"] else 0.0
            by_symbol.append(s)

        # ── BUY vs SELL ───────────────────────────────────────────────────
        by_order_type: dict[str, int] = {"BUY": 0, "SELL": 0}
        for ex in all_executions:
            sig = ex.get("signal") or {}
            ot = (sig.get("order_type") or "").upper()
            if ot in by_order_type:
                by_order_type[ot] += 1

        # ── Order mode ────────────────────────────────────────────────────
        by_order_mode: dict[str, int] = {}
        for s in all_signal_items:
            mode = (s.get("order_mode") or "UNKNOWN").upper()
            by_order_mode[mode] = by_order_mode.get(mode, 0) + 1

        # ── Lot stats ─────────────────────────────────────────────────────
        all_lots = [float(s["lot_size"]) for s in all_signal_items if s.get("lot_size")]

        # ── Weekly stats (dal daily) ──────────────────────────────────────
        weekly_map: dict[str, dict] = {}
        for d in daily_stats:
            try:
                dt = _dt.strptime(d["day"], "%Y-%m-%d")
                iso = dt.isocalendar()
                week_key = f"{iso[0]}-W{iso[1]:02d}"
                if week_key not in weekly_map:
                    weekly_map[week_key] = {"week": week_key, "messages": 0, "signals": 0, "orders": 0}
                weekly_map[week_key]["messages"] += d["messages"]
                weekly_map[week_key]["signals"]  += int(d["signals"] or 0)
                weekly_map[week_key]["orders"]   += int(d["orders_sent"] or 0)
            except Exception:
                pass
        weekly_stats = sorted(weekly_map.values(), key=lambda x: x["week"])

        total_msgs = int(base.get("total_messages") or 0)
        total_sigs = int(base.get("total_signals") or 0)

        return {
            "total_messages":          total_msgs,
            "total_signals":           total_sigs,
            "signal_rate":             round(total_sigs / total_msgs * 100, 1) if total_msgs else 0.0,
            "total_order_executions":  total_execs,
            "successful_orders":       successful,
            "failed_orders":           failed,
            "execution_success_rate":  round(successful / total_execs * 100, 1) if total_execs else 0.0,
            "total_errors":            int(base.get("total_errors") or 0),
            "errors_by_step":          errors_by_step,
            "daily_stats":             daily_stats,
            "weekly_stats":            weekly_stats[-16:],
            "hourly_distribution":     hourly_distribution,
            "top_senders":             top_senders,
            "by_symbol":               by_symbol,
            "by_order_type":           by_order_type,
            "by_order_mode":           by_order_mode,
            "avg_lot_size":            round(sum(all_lots) / len(all_lots), 3) if all_lots else None,
            "min_lot_size":            min(all_lots) if all_lots else None,
            "max_lot_size":            max(all_lots) if all_lots else None,
            "balance_trend":           balance_trend[-200:],
        }


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
