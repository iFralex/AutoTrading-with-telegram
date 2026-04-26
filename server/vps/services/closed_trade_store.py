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

    async def get_position_history(
        self,
        user_id: str,
        days: int = 1,
        symbol: str | None = None,
    ) -> list[dict]:
        """Storico posizioni chiuse per l'agente AI (filtro per giorni e simbolo)."""
        from datetime import datetime, timedelta, timezone
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        query = """
            SELECT ticket, symbol, order_type, lots, entry_price, close_price,
                   sl, tp, profit, reason, open_time, close_time
            FROM closed_trades
            WHERE user_id = ? AND close_time >= ?
        """
        params: list = [user_id, cutoff]
        if symbol:
            query += " AND symbol = ?"
            params.append(symbol)
        query += " ORDER BY close_time DESC"
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(query, params)
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

    async def get_period_pnl(self, user_id: str, days: int) -> float:
        """Ritorna il P&L degli ultimi N giorni (incluso oggi)."""
        cutoff = f"date('now', '-{max(0, days - 1)} days')"
        async with aiosqlite.connect(self._db_path) as db:
            cur = await db.execute(
                f"""
                SELECT COALESCE(SUM(profit), 0)
                FROM closed_trades
                WHERE user_id = ? AND DATE(close_time) >= {cutoff}
                """,
                (user_id,),
            )
            row = await cur.fetchone()
        return float(row[0]) if row else 0.0

    async def get_current_month_pnl(self, user_id: str) -> float:
        """Ritorna il P&L del mese corrente (UTC)."""
        async with aiosqlite.connect(self._db_path) as db:
            cur = await db.execute(
                """
                SELECT COALESCE(SUM(profit), 0)
                FROM closed_trades
                WHERE user_id = ?
                  AND strftime('%Y-%m', close_time) = strftime('%Y-%m', 'now')
                """,
                (user_id,),
            )
            row = await cur.fetchone()
        return float(row[0]) if row else 0.0

    async def get_today_pnl(self, user_id: str) -> float:
        """Ritorna il P&L totale di oggi (UTC)."""
        async with aiosqlite.connect(self._db_path) as db:
            cur = await db.execute(
                """
                SELECT COALESCE(SUM(profit), 0)
                FROM closed_trades
                WHERE user_id = ? AND DATE(close_time) = DATE('now')
                """,
                (user_id,),
            )
            row = await cur.fetchone()
        return float(row[0]) if row else 0.0

    async def get_group_trade_stats(self, user_id: str, group_id: int) -> dict:
        """Statistiche trade per un gruppo specifico con metriche estese per il Trust Score."""
        _cte = """
            WITH group_signal_ids AS (
                SELECT DISTINCT signal_group_id FROM signal_logs
                WHERE user_id = ? AND group_id = ? AND signal_group_id IS NOT NULL
            )
        """
        async with aiosqlite.connect(self._db_path) as db:
            # Aggregate stats
            cur = await db.execute(
                _cte + """
                SELECT
                    COUNT(*)                                                               AS total_trades,
                    COALESCE(SUM(CASE WHEN profit > 0  THEN 1 ELSE 0 END), 0)             AS wins,
                    COALESCE(SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END), 0)             AS losses,
                    COALESCE(SUM(profit), 0)                                               AS total_profit,
                    COALESCE(SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END), 0)          AS gross_profit,
                    COALESCE(ABS(SUM(CASE WHEN profit < 0 THEN profit ELSE 0 END)), 0)    AS gross_loss,
                    COALESCE(AVG(CASE WHEN profit > 0 THEN profit END), 0)                AS avg_win,
                    COALESCE(AVG(CASE WHEN profit < 0 THEN profit END), 0)                AS avg_loss
                FROM closed_trades
                WHERE user_id = ?
                  AND signal_group_id IN (SELECT signal_group_id FROM group_signal_ids)
                """,
                (user_id, group_id, user_id),
            )
            row = await cur.fetchone()
            # Profits in order for consecutive-streak calculation
            cur2 = await db.execute(
                _cte + """
                SELECT profit FROM closed_trades
                WHERE user_id = ?
                  AND signal_group_id IN (SELECT signal_group_id FROM group_signal_ids)
                ORDER BY close_time ASC
                """,
                (user_id, group_id, user_id),
            )
            profit_rows = await cur2.fetchall()

        if row is None or int(row[0] or 0) == 0:
            return {
                "total_trades": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
                "total_profit": 0.0, "gross_profit": 0.0, "gross_loss": 0.0,
                "profit_factor": None, "avg_win": 0.0, "avg_loss": 0.0,
                "max_consecutive_wins": 0, "max_consecutive_losses": 0,
            }

        total        = int(row[0] or 0)
        wins         = int(row[1] or 0)
        losses       = int(row[2] or 0)
        total_profit = float(row[3] or 0)
        gross_profit = float(row[4] or 0)
        gross_loss   = float(row[5] or 0)
        avg_win      = float(row[6] or 0)
        avg_loss     = float(row[7] or 0)
        profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else None

        profits = [r[0] for r in profit_rows if r[0] is not None]
        max_cw = max_cl = cur_w = cur_l = 0
        for p in profits:
            if p > 0:
                cur_w += 1; cur_l = 0
                max_cw = max(max_cw, cur_w)
            else:
                cur_l += 1; cur_w = 0
                max_cl = max(max_cl, cur_l)

        return {
            "total_trades":          total,
            "wins":                  wins,
            "losses":                losses,
            "win_rate":              round(wins / total * 100, 1) if total else 0.0,
            "total_profit":          round(total_profit, 2),
            "gross_profit":          round(gross_profit, 2),
            "gross_loss":            round(gross_loss, 2),
            "profit_factor":         profit_factor,
            "avg_win":               round(avg_win, 2),
            "avg_loss":              round(avg_loss, 2),
            "max_consecutive_wins":  max_cw,
            "max_consecutive_losses":max_cl,
        }

    async def get_monthly_summary(self, user_id: str, year: int, month: int) -> dict:
        """Riepilogo trade di un mese specifico (per il report mensile)."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                """
                SELECT
                    COUNT(*)                                           AS total_trades,
                    SUM(CASE WHEN profit > 0  THEN 1 ELSE 0 END)      AS wins,
                    SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END)      AS losses,
                    SUM(profit)                                        AS total_profit
                FROM closed_trades
                WHERE user_id = ?
                  AND strftime('%Y', close_time) = ?
                  AND strftime('%m', close_time) = ?
                """,
                (user_id, str(year), f"{month:02d}"),
            )
            row = await cur.fetchone()
        total  = int(row["total_trades"] or 0)
        wins   = int(row["wins"]         or 0)
        losses = int(row["losses"]       or 0)
        profit = float(row["total_profit"] or 0)
        return {
            "total_trades": total,
            "wins":         wins,
            "losses":       losses,
            "win_rate":     round(wins / total * 100, 1) if total else 0.0,
            "total_profit": round(profit, 2),
        }

    async def _build_full_stats(self, db, where_clause: str, params: tuple) -> dict:
        """
        Calcola le statistiche complete per un insieme di trade definito
        da where_clause (es. "user_id = ? AND strftime(...)").
        Usato sia da get_monthly_stats che da get_period_stats.
        """
        db.row_factory = aiosqlite.Row

        cur = await db.execute(
            f"""
            SELECT
                COUNT(*)                                                             AS total_trades,
                COALESCE(SUM(CASE WHEN profit > 0  THEN 1 ELSE 0 END), 0)           AS wins,
                COALESCE(SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END), 0)           AS losses,
                COALESCE(SUM(profit), 0)                                             AS total_profit,
                COALESCE(SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END), 0)       AS gross_profit,
                COALESCE(ABS(SUM(CASE WHEN profit < 0 THEN profit ELSE 0 END)), 0)  AS gross_loss,
                COALESCE(AVG(CASE WHEN profit > 0 THEN profit END), 0)              AS avg_win,
                COALESCE(AVG(CASE WHEN profit < 0 THEN profit END), 0)              AS avg_loss,
                COALESCE(MAX(profit), 0)                                             AS best_trade,
                COALESCE(MIN(profit), 0)                                             AS worst_trade,
                COALESCE(SUM(CASE WHEN reason='TP' THEN 1 ELSE 0 END), 0)           AS tp_count,
                COALESCE(SUM(CASE WHEN reason='SL' THEN 1 ELSE 0 END), 0)           AS sl_count,
                COALESCE(SUM(CASE WHEN reason NOT IN ('TP','SL') THEN 1 ELSE 0 END),0) AS manual_count,
                COUNT(DISTINCT date(close_time))                                     AS active_days
            FROM closed_trades
            WHERE {where_clause}
            """,
            params,
        )
        row = await cur.fetchone()

        cur2 = await db.execute(
            f"""
            SELECT symbol,
                COUNT(*)                                                            AS total,
                COALESCE(SUM(CASE WHEN profit > 0  THEN 1 ELSE 0 END), 0)          AS wins,
                COALESCE(SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END), 0)          AS losses,
                COALESCE(SUM(profit), 0)                                            AS total_profit,
                COALESCE(AVG(profit), 0)                                            AS avg_profit,
                COALESCE(MAX(profit), 0)                                            AS best_trade,
                COALESCE(MIN(profit), 0)                                            AS worst_trade,
                COALESCE(SUM(CASE WHEN reason='TP' THEN 1 ELSE 0 END), 0)          AS tp_count,
                COALESCE(SUM(CASE WHEN reason='SL' THEN 1 ELSE 0 END), 0)          AS sl_count
            FROM closed_trades
            WHERE {where_clause}
            GROUP BY symbol ORDER BY total_profit DESC
            """,
            params,
        )
        sym_rows = await cur2.fetchall()

        cur3 = await db.execute(
            f"SELECT profit FROM closed_trades WHERE {where_clause} ORDER BY close_time ASC",
            params,
        )
        profit_rows = await cur3.fetchall()

        total  = int(row["total_trades"] or 0)
        wins   = int(row["wins"] or 0)
        losses = int(row["losses"] or 0)
        gp     = float(row["gross_profit"] or 0)
        gl     = float(row["gross_loss"]   or 0)

        profits = [float(r[0]) for r in profit_rows if r[0] is not None]
        max_cw = max_cl = cur_w = cur_l = 0
        for p in profits:
            if p > 0:
                cur_w += 1; cur_l = 0
                max_cw = max(max_cw, cur_w)
            else:
                cur_l += 1; cur_w = 0
                max_cl = max(max_cl, cur_l)

        by_symbol = []
        for s in sym_rows:
            t = int(s["total"] or 0)
            by_symbol.append({
                "symbol":       s["symbol"],
                "total":        t,
                "wins":         int(s["wins"] or 0),
                "losses":       int(s["losses"] or 0),
                "win_rate":     round(int(s["wins"] or 0) / t * 100, 1) if t else 0.0,
                "total_profit": round(float(s["total_profit"] or 0), 2),
                "avg_profit":   round(float(s["avg_profit"] or 0), 2),
                "best_trade":   round(float(s["best_trade"] or 0), 2),
                "worst_trade":  round(float(s["worst_trade"] or 0), 2),
                "tp_count":     int(s["tp_count"] or 0),
                "sl_count":     int(s["sl_count"] or 0),
            })

        return {
            "total_trades":          total,
            "wins":                  wins,
            "losses":                losses,
            "win_rate":              round(wins / total * 100, 1) if total else 0.0,
            "total_profit":          round(float(row["total_profit"] or 0), 2),
            "gross_profit":          round(gp, 2),
            "gross_loss":            round(gl, 2),
            "profit_factor":         round(gp / gl, 2) if gl > 0 else None,
            "avg_win":               round(float(row["avg_win"] or 0), 2),
            "avg_loss":              round(float(row["avg_loss"] or 0), 2),
            "best_trade":            round(float(row["best_trade"] or 0), 2),
            "worst_trade":           round(float(row["worst_trade"] or 0), 2),
            "tp_count":              int(row["tp_count"] or 0),
            "sl_count":              int(row["sl_count"] or 0),
            "manual_count":          int(row["manual_count"] or 0),
            "max_consecutive_wins":  max_cw,
            "max_consecutive_losses":max_cl,
            "active_trading_days":   int(row["active_days"] or 0),
            "by_symbol":             by_symbol,
        }

    async def get_monthly_stats(self, user_id: str, year: int, month: int) -> dict:
        """Stats complete di un mese specifico (per il report PDF)."""
        async with aiosqlite.connect(self._db_path) as db:
            return await self._build_full_stats(
                db,
                "user_id = ? AND strftime('%Y', close_time) = ? AND strftime('%m', close_time) = ?",
                (user_id, str(year), f"{month:02d}"),
            )

    async def get_period_stats(self, user_id: str, days: int) -> dict:
        """Stats complete degli ultimi N giorni (per il report on-demand)."""
        async with aiosqlite.connect(self._db_path) as db:
            return await self._build_full_stats(
                db,
                f"user_id = ? AND DATE(close_time) >= date('now', '-{max(0, days - 1)} days')",
                (user_id,),
            )

    async def _build_groups_stats(
        self, db, where_clause: str, params: tuple, user_id: str,
        min_groups: int = 2,
    ) -> list[dict]:
        """
        Per ogni gruppo Telegram con trade nel periodo, ritorna stats aggregate
        incluso max_consecutive_losses (usato per il Trust Score).

        min_groups=2  → per il periodo corrente (confronto utile solo con ≥2 canali)
        min_groups=1  → per il periodo precedente (lookup per ogni canale presente)

        Funziona anche dopo l'eliminazione di un gruppo da user_groups: i dati
        restano in signal_logs e closed_trades e vengono recuperati tramite
        signal_group_id (bridge tra i due store).
        """
        db.row_factory = aiosqlite.Row

        cur = await db.execute(f"""
            SELECT sl.group_id, MAX(sl.group_name) AS group_name
            FROM closed_trades ct
            JOIN signal_logs sl ON ct.signal_group_id = sl.signal_group_id
            WHERE {where_clause} AND sl.group_id IS NOT NULL
            GROUP BY sl.group_id
            ORDER BY MAX(sl.group_name)
        """, params)
        groups = [(r["group_id"], r["group_name"]) for r in await cur.fetchall()]

        if len(groups) < min_groups:
            return []

        _sg_subq = """
            SELECT DISTINCT signal_group_id FROM signal_logs
            WHERE user_id = ? AND group_id = ? AND signal_group_id IS NOT NULL
        """

        result = []
        for gid, gname in groups:
            sg_params = (user_id, gid)

            cur2 = await db.execute(f"""
                SELECT
                    COUNT(ct.id)                                                              AS total_trades,
                    COALESCE(SUM(CASE WHEN ct.profit > 0  THEN 1 ELSE 0 END), 0)             AS wins,
                    COALESCE(SUM(CASE WHEN ct.profit <= 0 THEN 1 ELSE 0 END), 0)             AS losses,
                    COALESCE(SUM(ct.profit), 0)                                               AS total_profit,
                    COALESCE(SUM(CASE WHEN ct.profit > 0 THEN ct.profit ELSE 0 END), 0)      AS gross_profit,
                    COALESCE(ABS(SUM(CASE WHEN ct.profit < 0 THEN ct.profit ELSE 0 END)), 0) AS gross_loss,
                    COALESCE(AVG(CASE WHEN ct.profit > 0 THEN ct.profit END), 0)             AS avg_win,
                    COALESCE(AVG(CASE WHEN ct.profit < 0 THEN ct.profit END), 0)             AS avg_loss,
                    COALESCE(MAX(ct.profit), 0)                                               AS best_trade,
                    COALESCE(MIN(ct.profit), 0)                                               AS worst_trade,
                    COALESCE(SUM(CASE WHEN ct.reason='TP' THEN 1 ELSE 0 END), 0)             AS tp_count,
                    COALESCE(SUM(CASE WHEN ct.reason='SL' THEN 1 ELSE 0 END), 0)             AS sl_count
                FROM closed_trades ct
                JOIN ({_sg_subq}) sg ON ct.signal_group_id = sg.signal_group_id
                WHERE {where_clause}
            """, sg_params + params)
            row = await cur2.fetchone()

            total = int(row["total_trades"] or 0)
            if total == 0:
                continue
            wins = int(row["wins"] or 0)
            gp   = float(row["gross_profit"] or 0)
            gl   = float(row["gross_loss"]   or 0)

            # Profits in chronological order for consecutive streak
            cur3 = await db.execute(f"""
                SELECT ct.profit FROM closed_trades ct
                JOIN ({_sg_subq}) sg ON ct.signal_group_id = sg.signal_group_id
                WHERE {where_clause}
                ORDER BY ct.close_time ASC
            """, sg_params + params)
            profits = [r[0] for r in await cur3.fetchall() if r[0] is not None]
            max_cw = max_cl = cur_w = cur_l = 0
            for p in profits:
                if p > 0:
                    cur_w += 1; cur_l = 0
                    max_cw = max(max_cw, cur_w)
                else:
                    cur_l += 1; cur_w = 0
                    max_cl = max(max_cl, cur_l)

            result.append({
                "group_id":              gid,
                "group_name":            gname or f"Gruppo {gid}",
                "total_trades":          total,
                "wins":                  wins,
                "losses":                int(row["losses"] or 0),
                "win_rate":              round(wins / total * 100, 1),
                "total_profit":          round(float(row["total_profit"] or 0), 2),
                "gross_profit":          round(gp, 2),
                "gross_loss":            round(gl, 2),
                "profit_factor":         round(gp / gl, 2) if gl > 0 else None,
                "avg_win":               round(float(row["avg_win"]  or 0), 2),
                "avg_loss":              round(float(row["avg_loss"] or 0), 2),
                "best_trade":            round(float(row["best_trade"]  or 0), 2),
                "worst_trade":           round(float(row["worst_trade"] or 0), 2),
                "tp_count":              int(row["tp_count"] or 0),
                "sl_count":              int(row["sl_count"] or 0),
                "max_consecutive_losses": max_cl,
                "max_consecutive_wins":   max_cw,
            })

        return result

    async def get_monthly_groups_stats(self, user_id: str, year: int, month: int) -> list[dict]:
        """Stats per-gruppo per un mese specifico. Ritorna [] se un solo gruppo."""
        async with aiosqlite.connect(self._db_path) as db:
            return await self._build_groups_stats(
                db,
                "user_id = ? AND strftime('%Y', close_time) = ? AND strftime('%m', close_time) = ?",
                (user_id, str(year), f"{month:02d}"),
                user_id,
            )

    async def get_monthly_groups_stats_prev(self, user_id: str, year: int, month: int) -> list[dict]:
        """Stats per-gruppo per il mese precedente a (year, month). min_groups=1."""
        if month == 1:
            prev_year, prev_month = year - 1, 12
        else:
            prev_year, prev_month = year, month - 1
        async with aiosqlite.connect(self._db_path) as db:
            return await self._build_groups_stats(
                db,
                "user_id = ? AND strftime('%Y', close_time) = ? AND strftime('%m', close_time) = ?",
                (user_id, str(prev_year), f"{prev_month:02d}"),
                user_id,
                min_groups=1,
            )

    async def get_period_groups_stats(self, user_id: str, days: int) -> list[dict]:
        """Stats per-gruppo per gli ultimi N giorni. Ritorna [] se un solo gruppo."""
        async with aiosqlite.connect(self._db_path) as db:
            return await self._build_groups_stats(
                db,
                f"user_id = ? AND DATE(close_time) >= date('now', '-{max(0, days - 1)} days')",
                (user_id,),
                user_id,
            )

    async def get_period_groups_stats_prev(self, user_id: str, days: int) -> list[dict]:
        """Stats per-gruppo per il periodo precedente (da 2*days fa a days fa). min_groups=1."""
        d = max(0, days - 1)
        async with aiosqlite.connect(self._db_path) as db:
            return await self._build_groups_stats(
                db,
                f"user_id = ? AND DATE(close_time) >= date('now', '-{d * 2 + 1} days')"
                f" AND DATE(close_time) < date('now', '-{d} days')",
                (user_id,),
                user_id,
                min_groups=1,
            )

    async def get_period_trades(self, user_id: str, days: int) -> list[dict]:
        """Tutti i trade degli ultimi N giorni (per il report on-demand)."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                f"""
                SELECT ticket, symbol, order_type, lots, entry_price, close_price,
                       sl, tp, profit, reason, open_time, close_time
                FROM closed_trades
                WHERE user_id = ? AND DATE(close_time) >= date('now', '-{max(0, days - 1)} days')
                ORDER BY close_time ASC
                """,
                (user_id,),
            )
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_period_equity_curve(self, user_id: str, days: int) -> list[dict]:
        """P&L giornaliero e cumulativo degli ultimi N giorni (per l'equity chart on-demand)."""
        async with aiosqlite.connect(self._db_path) as db:
            cur = await db.execute(
                f"""
                SELECT date(close_time) AS day, COALESCE(SUM(profit), 0) AS daily_pnl
                FROM closed_trades
                WHERE user_id = ? AND DATE(close_time) >= date('now', '-{max(0, days - 1)} days')
                GROUP BY date(close_time)
                ORDER BY day ASC
                """,
                (user_id,),
            )
            rows = await cur.fetchall()
        cumulative = 0.0
        result = []
        for row in rows:
            daily = float(row[1] or 0)
            cumulative += daily
            result.append({
                "day":            row[0],
                "daily_pnl":      round(daily, 2),
                "cumulative_pnl": round(cumulative, 2),
            })
        return result

    async def get_monthly_trades(self, user_id: str, year: int, month: int) -> list[dict]:
        """Tutti i trade di un mese specifico con dettagli completi (per la lista PDF)."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                """
                SELECT ticket, symbol, order_type, lots, entry_price, close_price,
                       sl, tp, profit, reason, open_time, close_time
                FROM closed_trades
                WHERE user_id = ?
                  AND strftime('%Y', close_time) = ?
                  AND strftime('%m', close_time) = ?
                ORDER BY close_time ASC
                """,
                (user_id, str(year), f"{month:02d}"),
            )
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_monthly_equity_curve(self, user_id: str, year: int, month: int) -> list[dict]:
        """P&L giornaliero e cumulativo per un mese specifico (per l'equity chart nel PDF)."""
        async with aiosqlite.connect(self._db_path) as db:
            cur = await db.execute(
                """
                SELECT
                    date(close_time)       AS day,
                    COALESCE(SUM(profit), 0) AS daily_pnl
                FROM closed_trades
                WHERE user_id = ?
                  AND strftime('%Y', close_time) = ?
                  AND strftime('%m', close_time) = ?
                GROUP BY date(close_time)
                ORDER BY day ASC
                """,
                (user_id, str(year), f"{month:02d}"),
            )
            rows = await cur.fetchall()

        cumulative = 0.0
        result = []
        for row in rows:
            daily = float(row[1] or 0)
            cumulative += daily
            result.append({
                "day":            row[0],
                "daily_pnl":      round(daily, 2),
                "cumulative_pnl": round(cumulative, 2),
            })
        return result

    async def get_last_n_months_summaries(self, user_id: str, n: int = 6) -> list[dict]:
        """Riepilogo mensile degli ultimi N mesi (incluso il corrente), in ordine cronologico."""
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        results = []
        for i in range(n - 1, -1, -1):
            month = now.month - i
            year  = now.year
            while month <= 0:
                month += 12
                year  -= 1
            s = await self.get_monthly_summary(user_id, year, month)
            results.append({"year": year, "month": month, **s})
        return results

    async def get_last_week_summary(self, user_id: str) -> dict:
        """Ritorna un riepilogo dei trade degli ultimi 7 giorni per il report settimanale."""
        from datetime import datetime, timezone, timedelta
        since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                """
                SELECT
                    COUNT(*)                                           AS total_trades,
                    SUM(CASE WHEN profit > 0  THEN 1 ELSE 0 END)      AS wins,
                    SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END)      AS losses,
                    SUM(profit)                                        AS total_profit
                FROM closed_trades
                WHERE user_id = ? AND DATE(close_time) >= ?
                """,
                (user_id, since),
            )
            row = await cur.fetchone()
        total  = int(row["total_trades"] or 0)
        wins   = int(row["wins"]         or 0)
        losses = int(row["losses"]       or 0)
        profit = float(row["total_profit"] or 0)
        return {
            "total_trades": total,
            "wins":         wins,
            "losses":       losses,
            "win_rate":     round(wins / total * 100, 1) if total else 0.0,
            "total_profit": round(profit, 2),
        }

    # ── Community Groups ─────────────────────────────────────────────────────

    _COMMUNITY_WHERE = (
        "user_id = ? AND signal_group_id IN ("
        "  SELECT DISTINCT signal_group_id FROM signal_logs"
        "  WHERE user_id = ? AND group_id = ? AND signal_group_id IS NOT NULL"
        ")"
    )

    async def get_community_group_stats(
        self, source_user_id: str, source_group_id: int
    ) -> dict:
        """Full stats for a community group (identified by source user + group)."""
        async with aiosqlite.connect(self._db_path) as db:
            return await self._build_full_stats(
                db,
                self._COMMUNITY_WHERE,
                (source_user_id, source_user_id, source_group_id),
            )

    async def get_community_group_equity(
        self, source_user_id: str, source_group_id: int
    ) -> list[dict]:
        """Daily cumulative PnL curve for a community group."""
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                f"""
                SELECT date(close_time) AS day, COALESCE(SUM(profit), 0) AS daily_pnl
                FROM closed_trades
                WHERE {self._COMMUNITY_WHERE} AND profit IS NOT NULL
                GROUP BY date(close_time)
                ORDER BY day ASC
                """,
                (source_user_id, source_user_id, source_group_id),
            )
            rows = await cursor.fetchall()
        cumulative = 0.0
        result = []
        for row in rows:
            daily = float(row[1] or 0)
            cumulative += daily
            result.append({
                "day":            row[0],
                "daily_pnl":      round(daily, 2),
                "cumulative_pnl": round(cumulative, 2),
            })
        return result

    async def get_community_group_trades(
        self, source_user_id: str, source_group_id: int, limit: int = 30
    ) -> list[dict]:
        """Recent trades for a community group."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                f"""
                SELECT ticket, symbol, order_type, lots, entry_price, close_price,
                       sl, tp, profit, reason, open_time, close_time
                FROM closed_trades
                WHERE {self._COMMUNITY_WHERE}
                ORDER BY close_time DESC
                LIMIT ?
                """,
                (source_user_id, source_user_id, source_group_id, limit),
            )
            rows = await cursor.fetchall()
        return [dict(r) for r in rows]
