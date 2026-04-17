"""
ClosedTradeStore — persistenza di ogni posizione chiusa su MT5.

Usa lo stesso file users.db. Popolato dall'app.py ogni volta che il
PositionWatcher rileva un evento "position_closed", INDIPENDENTEMENTE
da qualsiasi strategia configurata dall'utente.

Schema:
  closed_trades(
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    ticket          INTEGER NOT NULL,       -- ticket della posizione
    symbol          TEXT NOT NULL,
    order_type      TEXT NOT NULL,          -- "BUY" | "SELL"
    lots            REAL,
    entry_price     REAL,
    close_price     REAL,
    sl              REAL,
    tp              REAL,
    profit          REAL,                   -- P&L netto inclusi swap/commission
    reason          TEXT,                   -- "TP" | "SL" | "CLIENT" | "EXPERT" | ...
    open_time       TEXT,
    close_time      TEXT NOT NULL,
    signal_group_id TEXT,
    UNIQUE(user_id, ticket)                 -- evita duplicati in caso di retry
  )
"""

from __future__ import annotations

import json as _json
import statistics
from pathlib import Path
from typing import Any

import aiosqlite

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS closed_trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT    NOT NULL,
    ticket          INTEGER NOT NULL,
    symbol          TEXT    NOT NULL,
    order_type      TEXT    NOT NULL,
    lots            REAL,
    entry_price     REAL,
    close_price     REAL,
    sl              REAL,
    tp              REAL,
    profit          REAL,
    reason          TEXT,
    open_time       TEXT,
    close_time      TEXT    NOT NULL,
    signal_group_id TEXT,
    UNIQUE(user_id, ticket)
)
"""

_CREATE_INDEX_USER  = "CREATE INDEX IF NOT EXISTS idx_closed_trades_user_id ON closed_trades(user_id)"
_CREATE_INDEX_TIME  = "CREATE INDEX IF NOT EXISTS idx_closed_trades_close_time ON closed_trades(close_time)"


class ClosedTradeStore:

    def __init__(self, db_path: Path):
        self._db_path = db_path

    async def init(self) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.execute(_CREATE_INDEX_USER)
            await db.execute(_CREATE_INDEX_TIME)
            await db.commit()

    async def insert(self, user_id: str, event_data: dict) -> None:
        """
        Salva una posizione chiusa. Ignora silenziosamente i duplicati
        (UNIQUE constraint su user_id + ticket).

        event_data è il dict prodotto da mt5_position_watcher._build_close_event:
            ticket, symbol, order_type, lots, entry_price, close_price,
            sl, tp, profit, reason, open_time, close_time, signal_group_id
        """
        ticket = event_data.get("ticket")
        if ticket is None:
            return

        close_time = event_data.get("close_time") or ""
        if not close_time:
            from datetime import datetime, timezone
            close_time = datetime.now(timezone.utc).isoformat()

        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """
                INSERT OR IGNORE INTO closed_trades
                    (user_id, ticket, symbol, order_type, lots,
                     entry_price, close_price, sl, tp,
                     profit, reason, open_time, close_time, signal_group_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    int(ticket),
                    event_data.get("symbol", ""),
                    event_data.get("order_type", ""),
                    event_data.get("lots"),
                    event_data.get("entry_price"),
                    event_data.get("close_price"),
                    event_data.get("sl"),
                    event_data.get("tp"),
                    event_data.get("profit"),
                    event_data.get("reason"),
                    event_data.get("open_time"),
                    close_time,
                    event_data.get("signal_group_id"),
                ),
            )
            await db.commit()

    async def get_all_by_user_id(self, user_id: str) -> list[dict]:
        """Ritorna tutte le operazioni chiuse per un utente (ordinate cronologicamente)."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM closed_trades WHERE user_id = ? ORDER BY close_time ASC",
                (user_id,),
            )
            rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def delete_by_user_id(self, user_id: str) -> int:
        """Elimina tutti i trade chiusi dell'utente. Ritorna il numero di righe eliminate."""
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "DELETE FROM closed_trades WHERE user_id = ?", (user_id,)
            )
            await db.commit()
            return cursor.rowcount

    async def count_by_user_id(self, user_id: str) -> int:
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT COUNT(*) FROM closed_trades WHERE user_id = ?", (user_id,)
            )
            row = await cursor.fetchone()
        return row[0] if row else 0

    async def get_recent_trades(self, user_id: str, limit: int = 5) -> list[dict]:
        """Ritorna le ultime N posizioni chiuse con tutti i campi, ordinate dalla più recente."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT ticket, symbol, order_type, lots, entry_price, close_price,
                       sl, tp, profit, reason, open_time, close_time, signal_group_id
                FROM closed_trades
                WHERE user_id = ?
                ORDER BY close_time DESC
                LIMIT ?
                """,
                (user_id, limit),
            )
            rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_trade_stats(self, user_id: str) -> dict:
        """
        Calcola statistiche complete sulle operazioni chiuse:
        - Win rate, P&L medio/mediano/totale
        - Breakdown per motivo chiusura (TP / SL / CLIENT / EXPERT)
        - P&L giornaliero (ultimi 90 giorni) e settimanale
        - Per simbolo: totale trade, win rate, P&L totale/medio
        - Profit factor, best/worst trade
        - Statistiche consecutive vincite/perdite
        - Numero operazioni per giorno (media)
        """
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row

            # ── 1. Aggregati globali ───────────────────────────────────────
            cur = await db.execute(
                """
                SELECT
                  COUNT(*)                                                          AS total_trades,
                  COALESCE(SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END), 0)         AS wins,
                  COALESCE(SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END), 0)        AS losses,
                  COALESCE(AVG(profit), 0)                                         AS avg_profit,
                  COALESCE(SUM(profit), 0)                                         AS total_profit,
                  COALESCE(SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END), 0)    AS gross_profit,
                  COALESCE(ABS(SUM(CASE WHEN profit < 0 THEN profit ELSE 0 END)), 0) AS gross_loss,
                  COALESCE(MAX(profit), 0)                                         AS best_trade,
                  COALESCE(MIN(profit), 0)                                         AS worst_trade,
                  COALESCE(AVG(CASE WHEN profit > 0 THEN profit END), 0)           AS avg_win,
                  COALESCE(AVG(CASE WHEN profit < 0 THEN profit END), 0)           AS avg_loss,
                  COALESCE(AVG(CASE WHEN reason = 'TP' THEN profit END), 0)        AS avg_tp_profit,
                  COALESCE(AVG(CASE WHEN reason = 'SL' THEN profit END), 0)        AS avg_sl_loss
                FROM closed_trades WHERE user_id = ?
                """,
                (user_id,),
            )
            base = dict(await cur.fetchone())

            # ── 2. Breakdown per motivo ────────────────────────────────────
            cur = await db.execute(
                """
                SELECT
                  COALESCE(reason, 'UNKNOWN') AS reason,
                  COUNT(*) AS count,
                  COALESCE(SUM(profit), 0) AS total_profit,
                  COALESCE(AVG(profit), 0) AS avg_profit
                FROM closed_trades WHERE user_id = ?
                GROUP BY COALESCE(reason, 'UNKNOWN')
                ORDER BY count DESC
                """,
                (user_id,),
            )
            by_reason = [dict(r) for r in await cur.fetchall()]

            # ── 3. P&L giornaliero (ultimi 90 giorni) ─────────────────────
            cur = await db.execute(
                """
                SELECT
                  date(close_time) AS day,
                  COUNT(*) AS trades,
                  COALESCE(SUM(profit), 0) AS pnl,
                  COALESCE(SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END), 0) AS wins,
                  COALESCE(SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END), 0) AS losses
                FROM closed_trades
                WHERE user_id = ? AND date(close_time) >= date('now', '-90 days')
                GROUP BY date(close_time)
                ORDER BY day ASC
                """,
                (user_id,),
            )
            daily_pnl = [dict(r) for r in await cur.fetchall()]

            # ── 4. Per simbolo ─────────────────────────────────────────────
            cur = await db.execute(
                """
                SELECT
                  symbol,
                  COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END), 0) AS wins,
                  COALESCE(SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END), 0) AS losses,
                  COALESCE(AVG(profit), 0) AS avg_profit,
                  COALESCE(SUM(profit), 0) AS total_profit,
                  COALESCE(MAX(profit), 0) AS best_trade,
                  COALESCE(MIN(profit), 0) AS worst_trade,
                  COALESCE(SUM(CASE WHEN reason='TP' THEN 1 ELSE 0 END), 0)     AS tp_count,
                  COALESCE(SUM(CASE WHEN reason='SL' THEN 1 ELSE 0 END), 0)     AS sl_count
                FROM closed_trades WHERE user_id = ?
                GROUP BY symbol
                ORDER BY total DESC
                """,
                (user_id,),
            )
            by_symbol_raw = [dict(r) for r in await cur.fetchall()]

            # ── 5. Tutti i profitti in ordine cronologico (per mediana, consecutive) ──
            cur = await db.execute(
                "SELECT profit, close_time FROM closed_trades WHERE user_id = ? ORDER BY close_time ASC",
                (user_id,),
            )
            profit_rows = await cur.fetchall()

        # ── Calcoli Python ────────────────────────────────────────────────
        profits = [r[0] for r in profit_rows if r[0] is not None]

        total_trades = int(base["total_trades"])
        wins         = int(base["wins"])
        losses       = int(base["losses"])

        win_rate = round(wins / total_trades * 100, 1) if total_trades else 0.0

        median_profit = round(statistics.median(profits), 2) if profits else 0.0

        gross_profit = float(base["gross_profit"])
        gross_loss   = float(base["gross_loss"])
        profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else None

        # Consecutive wins/losses
        max_consec_wins = max_consec_losses = cur_wins = cur_losses = 0
        for p in profits:
            if p > 0:
                cur_wins += 1
                cur_losses = 0
                max_consec_wins = max(max_consec_wins, cur_wins)
            else:
                cur_losses += 1
                cur_wins = 0
                max_consec_losses = max(max_consec_losses, cur_losses)

        # P&L cumulativo (per il grafico)
        cumulative = 0.0
        cumulative_pnl = []
        for i, (p, ts) in enumerate(profit_rows):
            if p is not None:
                cumulative += p
            cumulative_pnl.append({
                "index":  i + 1,
                "ts":     profit_rows[i][1],
                "profit": round(float(p), 2) if p is not None else 0.0,
                "cumulative": round(cumulative, 2),
            })

        # Weekly P&L dal daily
        from datetime import datetime as _dt
        weekly_map: dict[str, dict] = {}
        for d in daily_pnl:
            try:
                dt  = _dt.strptime(d["day"], "%Y-%m-%d")
                iso = dt.isocalendar()
                wk  = f"{iso[0]}-W{iso[1]:02d}"
                if wk not in weekly_map:
                    weekly_map[wk] = {"week": wk, "trades": 0, "pnl": 0.0, "wins": 0, "losses": 0}
                weekly_map[wk]["trades"] += d["trades"]
                weekly_map[wk]["pnl"]    += float(d["pnl"] or 0)
                weekly_map[wk]["wins"]   += int(d["wins"] or 0)
                weekly_map[wk]["losses"] += int(d["losses"] or 0)
            except Exception:
                pass
        weekly_pnl = [
            {**v, "pnl": round(v["pnl"], 2)}
            for v in sorted(weekly_map.values(), key=lambda x: x["week"])
        ]

        # Completa by_symbol con success_rate arrotondato
        by_symbol = []
        for s in by_symbol_raw:
            total = s["total"]
            s["win_rate"]     = round(s["wins"] / total * 100, 1) if total else 0.0
            s["avg_profit"]   = round(float(s["avg_profit"] or 0), 2)
            s["total_profit"] = round(float(s["total_profit"] or 0), 2)
            s["best_trade"]   = round(float(s["best_trade"] or 0), 2)
            s["worst_trade"]  = round(float(s["worst_trade"] or 0), 2)
            by_symbol.append(s)

        # Days attivi (per calcolo operazioni/giorno)
        active_days = len(daily_pnl)
        avg_trades_per_day = round(total_trades / active_days, 1) if active_days else 0.0

        return {
            "total_trades":          total_trades,
            "wins":                  wins,
            "losses":                losses,
            "win_rate":              win_rate,
            "avg_profit":            round(float(base["avg_profit"] or 0), 2),
            "median_profit":         median_profit,
            "total_profit":          round(float(base["total_profit"] or 0), 2),
            "gross_profit":          round(gross_profit, 2),
            "gross_loss":            round(gross_loss, 2),
            "profit_factor":         profit_factor,
            "best_trade":            round(float(base["best_trade"] or 0), 2),
            "worst_trade":           round(float(base["worst_trade"] or 0), 2),
            "avg_win":               round(float(base["avg_win"] or 0), 2),
            "avg_loss":              round(float(base["avg_loss"] or 0), 2),
            "avg_tp_profit":         round(float(base["avg_tp_profit"] or 0), 2),
            "avg_sl_loss":           round(float(base["avg_sl_loss"] or 0), 2),
            "max_consecutive_wins":  max_consec_wins,
            "max_consecutive_losses":max_consec_losses,
            "avg_trades_per_day":    avg_trades_per_day,
            "active_trading_days":   active_days,
            "by_reason":             by_reason,
            "daily_pnl":             daily_pnl,
            "weekly_pnl":            weekly_pnl[-16:],
            "by_symbol":             by_symbol,
            "cumulative_pnl":        cumulative_pnl[-300:],  # max 300 punti per il grafico
        }
