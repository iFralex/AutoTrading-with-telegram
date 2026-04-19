"""
BacktestEngine — orchestratore del backtesting storico (Strategia C).

Pipeline:
  1. Fetch storico Telegram  (TelegramManager.get_history)
  2. Detection batch in parallelo (Gemini Flash flex, semaforo 20)
  3. Extraction segnali  (Gemini Pro flex, sequenziale per costo)
  4. [use_ai=True] Decisione pre-trade AI (StrategyExecutor)
  5. Download barre MT5  (per simbolo, lazy, M1→H1 fallback)
  6. Simulazione walk-forward  (SL/TP, con cache barre in memoria)
  7. Calcolo report completo → salvataggio BacktestStore
"""

from __future__ import annotations

import asyncio
import bisect
import logging
import math
import statistics
import time as _time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from vps.services.backtest_store import BacktestStore
    from vps.services.mt5_trader import MT5Trader
    from vps.services.signal_processor import SignalProcessor, TradeSignal
    from vps.services.strategy_executor import StrategyExecutor
    from vps.services.telegram_manager import TelegramManager

logger = logging.getLogger(__name__)

# ── Costanti simulazione ──────────────────────────────────────────────────────

_MAX_TRADE_HORIZON_DAYS = 7    # dopo 7 giorni → open_at_end
_DETECT_CONCURRENCY     = 20   # massimo 20 Flash in parallelo
_GEMINI_PRICING = {            # USD per milione di token (50% flex = metà standard)
    "flash_in":  0.075,
    "flash_out": 0.30,
    "pro_in":    0.625,
    "pro_out":   5.00,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pip_size(symbol: str, price: float) -> float:
    """Stima la dimensione di 1 pip dal simbolo e dal prezzo corrente."""
    sym = symbol.upper()
    if price <= 0:
        return 1.0
    if "JPY" in sym:
        return 0.01
    if price >= 10_000:   # BTC, indici molto alti
        return 1.0
    if price >= 500:      # oro, S&P 500
        return 0.1
    if price >= 10:       # DAX, petrolio, ecc.
        return 0.01
    return 0.0001         # forex standard


def _pnl_pips(order_type: str, entry: float, exit_price: float, pip: float) -> float:
    if pip <= 0:
        return 0.0
    direction = 1.0 if order_type == "BUY" else -1.0
    return round(direction * (exit_price - entry) / pip, 1)


def _ts_to_dt(unix_ts: int) -> datetime:
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc)


def _bars_bisect(bars: list[dict], from_unix: int) -> int:
    """Ritorna l'indice della prima barra con time >= from_unix."""
    times = [b["time"] for b in bars]
    return bisect.bisect_left(times, from_unix)


# ── Simulazione singolo trade ─────────────────────────────────────────────────

@dataclass
class SimResult:
    outcome: str         # "TP" | "SL" | "open_at_end" | "not_filled"
    actual_entry: float | None
    actual_entry_ts: str | None
    exit_price: float | None
    exit_ts: str | None
    pnl_pips: float | None
    duration_min: float | None


def _simulate_trade(
    signal,            # TradeSignal
    signal_ts: datetime,
    bars: list[dict],  # barre M1 (o fallback) per il periodo necessario
    point: float | None,
) -> SimResult:
    """
    Simula un singolo trade a partire dal timestamp del segnale.

    Logica entrata:
      MARKET        → open della barra successiva al segnale
      LIMIT/STOP    → prima barra che tocca entry_price
      entry range   → usa il punto medio come entry_price LIMIT

    Walk-forward post-entry su ogni barra:
      BUY : SL se bar.low  <= stop_loss; TP se bar.high >= take_profit
      SELL: SL se bar.high >= stop_loss; TP se bar.low  <= take_profit
      Se entrambi nella stessa barra → SL wins (pessimistic)
    """
    _not_filled = SimResult("not_filled", None, None, None, None, None, None)
    _open_end   = SimResult("open_at_end", None, None, None, None, None, None)

    if not bars:
        return _not_filled

    sig_unix = int(signal_ts.timestamp())
    start_idx = _bars_bisect(bars, sig_unix)

    # ── Determina entry_price effettivo ───────────────────────────────────────
    raw_entry = signal.entry_price
    if isinstance(raw_entry, list) and len(raw_entry) == 2:
        target_entry = (raw_entry[0] + raw_entry[1]) / 2.0
        order_mode = "LIMIT"
    elif isinstance(raw_entry, (int, float)):
        target_entry = float(raw_entry)
        order_mode = signal.order_mode or "LIMIT"
    else:
        target_entry = None
        order_mode = "MARKET"

    # ── Trova barra di entry ──────────────────────────────────────────────────
    entry_price: float | None = None
    entry_bar_idx: int | None = None

    horizon_unix = sig_unix + _MAX_TRADE_HORIZON_DAYS * 86400

    if order_mode == "MARKET" or target_entry is None:
        # Entra all'apertura della prima barra successiva al segnale
        if start_idx < len(bars):
            entry_bar_idx = start_idx
            entry_price   = bars[start_idx]["open"]
    else:
        # Ordine pendente: cerca il trigger
        for i in range(start_idx, len(bars)):
            b = bars[i]
            if b["time"] > horizon_unix:
                break
            ot = signal.order_type
            mode = order_mode
            if mode == "LIMIT":
                triggered = (ot == "BUY"  and b["low"]  <= target_entry) or \
                            (ot == "SELL" and b["high"] >= target_entry)
            else:  # STOP
                triggered = (ot == "BUY"  and b["high"] >= target_entry) or \
                            (ot == "SELL" and b["low"]  <= target_entry)
            if triggered:
                entry_bar_idx = i
                entry_price   = target_entry
                break

    if entry_bar_idx is None or entry_price is None:
        return _not_filled

    entry_ts = _ts_to_dt(bars[entry_bar_idx]["time"]).isoformat()
    sl = signal.stop_loss
    tp = signal.take_profit

    # Se non ci sono né SL né TP non possiamo simulare la chiusura
    if sl is None and tp is None:
        entry_dt = _ts_to_dt(bars[entry_bar_idx]["time"])
        ref_price = bars[entry_bar_idx]["close"]
        pip = point or _pip_size(signal.symbol, entry_price)
        return SimResult(
            outcome="open_at_end",
            actual_entry=entry_price,
            actual_entry_ts=entry_ts,
            exit_price=ref_price,
            exit_ts=entry_ts,
            pnl_pips=_pnl_pips(signal.order_type, entry_price, ref_price, pip),
            duration_min=0.0,
        )

    pip = point or _pip_size(signal.symbol, entry_price)

    # ── Walk-forward post-entry ───────────────────────────────────────────────
    for i in range(entry_bar_idx + 1, len(bars)):
        b = bars[i]
        if b["time"] > horizon_unix:
            break

        ot = signal.order_type
        sl_hit = (sl is not None) and (
            (ot == "BUY"  and b["low"]  <= sl) or
            (ot == "SELL" and b["high"] >= sl)
        )
        tp_hit = (tp is not None) and (
            (ot == "BUY"  and b["high"] >= tp) or
            (ot == "SELL" and b["low"]  <= tp)
        )

        if sl_hit or tp_hit:
            # Se entrambi nella stessa barra → SL (pessimistic)
            outcome    = "SL" if sl_hit else "TP"
            exit_price = sl if sl_hit else tp
            assert exit_price is not None
            exit_ts    = _ts_to_dt(b["time"]).isoformat()
            entry_dt   = _ts_to_dt(bars[entry_bar_idx]["time"])
            exit_dt    = _ts_to_dt(b["time"])
            duration   = (exit_dt - entry_dt).total_seconds() / 60.0
            return SimResult(
                outcome=outcome,
                actual_entry=entry_price,
                actual_entry_ts=entry_ts,
                exit_price=exit_price,
                exit_ts=exit_ts,
                pnl_pips=_pnl_pips(ot, entry_price, exit_price, pip),
                duration_min=round(duration, 1),
            )

    # Nessun evento → open_at_end
    last_close = bars[-1]["close"]
    last_ts    = _ts_to_dt(bars[-1]["time"])
    entry_dt   = _ts_to_dt(bars[entry_bar_idx]["time"])
    duration   = (last_ts - entry_dt).total_seconds() / 60.0
    return SimResult(
        outcome="open_at_end",
        actual_entry=entry_price,
        actual_entry_ts=entry_ts,
        exit_price=last_close,
        exit_ts=last_ts.isoformat(),
        pnl_pips=_pnl_pips(signal.order_type, entry_price, last_close, pip),
        duration_min=round(duration, 1),
    )


# ── Report aggregato ──────────────────────────────────────────────────────────

def _compute_aggregate(trades: list[dict], cost_info: dict, telegram_meta: dict) -> dict:
    """Calcola tutte le statistiche aggregate dal set di trade simulati."""
    filled = [t for t in trades if t["outcome"] not in ("not_filled",)]
    closed = [t for t in filled if t["outcome"] in ("TP", "SL")]
    wins   = [t for t in closed if (t["pnl_pips"] or 0) > 0]
    losses = [t for t in closed if (t["pnl_pips"] or 0) <= 0]

    total     = len(trades)
    n_filled  = len(filled)
    n_nf      = len([t for t in trades if t["outcome"] == "not_filled"])
    n_open    = len([t for t in filled if t["outcome"] == "open_at_end"])
    n_wins    = len(wins)
    n_losses  = len(losses)

    win_rate   = round(n_wins / len(closed) * 100, 1) if closed else 0.0

    pips       = [t["pnl_pips"] for t in closed if t["pnl_pips"] is not None]
    total_pips = round(sum(pips), 1) if pips else 0.0
    avg_pips   = round(statistics.mean(pips), 1) if pips else 0.0
    best_pips  = round(max(pips), 1) if pips else 0.0
    worst_pips = round(min(pips), 1) if pips else 0.0

    gross_pos  = sum(p for p in pips if p > 0)
    gross_neg  = abs(sum(p for p in pips if p < 0))
    pf = round(gross_pos / gross_neg, 2) if gross_neg > 0 else None

    # Max drawdown
    cumulative = 0.0
    peak = 0.0
    max_dd = 0.0
    for p in pips:
        cumulative += p
        peak = max(peak, cumulative)
        max_dd = max(max_dd, peak - cumulative)
    max_dd = round(max_dd, 1)

    # Sharpe (252 giorni annualizzati, daily pnl)
    sharpe = None
    if len(pips) >= 2:
        try:
            mean_p = statistics.mean(pips)
            std_p  = statistics.stdev(pips)
            if std_p > 0:
                sharpe = round(mean_p / std_p * math.sqrt(252), 2)
        except Exception:
            pass

    # Durata media trade
    durations = [t["duration_min"] for t in closed if t.get("duration_min") is not None]
    avg_dur   = round(statistics.mean(durations), 1) if durations else 0.0

    # RR medio
    rr_list = []
    for t in closed:
        sl = t.get("stop_loss")
        tp = t.get("take_profit")
        ep = t.get("actual_entry")
        if sl and tp and ep:
            sl_dist = abs(ep - sl)
            tp_dist = abs(tp - ep)
            if sl_dist > 0:
                rr_list.append(tp_dist / sl_dist)
    avg_rr = round(statistics.mean(rr_list), 2) if rr_list else None

    # Equity curve (cronologica)
    sorted_trades = sorted(closed, key=lambda t: t.get("exit_ts") or "")
    cumul = 0.0
    equity_curve = []
    for t in sorted_trades:
        p = t["pnl_pips"] or 0
        cumul += p
        equity_curve.append({
            "ts":    t.get("exit_ts"),
            "trade": round(p, 1),
            "cumul": round(cumul, 1),
        })

    # ── Per simbolo ───────────────────────────────────────────────────────────
    symbol_map: dict[str, dict] = {}
    for t in filled:
        sym = t.get("symbol") or "?"
        s = symbol_map.setdefault(sym, {
            "symbol": sym, "trades": 0, "wins": 0, "losses": 0,
            "pnl_pips": 0.0, "pips_list": [],
        })
        s["trades"] += 1
        if t["outcome"] in ("TP", "SL"):
            p = t.get("pnl_pips") or 0
            s["pnl_pips"] += p
            s["pips_list"].append(p)
            if p > 0:
                s["wins"] += 1
            else:
                s["losses"] += 1

    symbol_stats = []
    for s in symbol_map.values():
        pl = s.pop("pips_list")
        n  = s["wins"] + s["losses"]
        symbol_stats.append({
            **s,
            "pnl_pips":   round(s["pnl_pips"], 1),
            "win_rate":   round(s["wins"] / n * 100, 1) if n else 0.0,
            "avg_pips":   round(statistics.mean(pl), 1) if pl else 0.0,
            "best_pips":  round(max(pl), 1) if pl else 0.0,
            "worst_pips": round(min(pl), 1) if pl else 0.0,
        })
    symbol_stats.sort(key=lambda x: x["trades"], reverse=True)

    # ── Per sender ────────────────────────────────────────────────────────────
    sender_map: dict[str, dict] = {}
    for t in trades:
        sn = t.get("sender_name") or "?"
        s  = sender_map.setdefault(sn, {
            "sender_name": sn, "messages": 0, "signals": 0,
            "trades": 0, "wins": 0, "losses": 0, "pnl_pips": 0.0, "pips_list": [],
        })
        s["messages"] += 1
        if t.get("outcome") != "not_signal":
            s["signals"] += 1
        if t["outcome"] in ("TP", "SL", "open_at_end"):
            s["trades"] += 1
            if t["outcome"] in ("TP", "SL"):
                p = t.get("pnl_pips") or 0
                s["pnl_pips"] += p
                s["pips_list"].append(p)
                if p > 0:
                    s["wins"] += 1
                else:
                    s["losses"] += 1

    sender_stats = []
    for s in sender_map.values():
        pl = s.pop("pips_list")
        n  = s["wins"] + s["losses"]
        sender_stats.append({
            **s,
            "pnl_pips": round(s["pnl_pips"], 1),
            "win_rate": round(s["wins"] / n * 100, 1) if n else 0.0,
        })
    sender_stats.sort(key=lambda x: x["trades"], reverse=True)

    # ── Per ora e giorno settimana ─────────────────────────────────────────────
    by_hour:    dict[str, dict] = {}
    by_weekday: dict[str, dict] = {}
    for t in closed:
        ts = t.get("actual_entry_ts") or t.get("msg_ts")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts)
            h  = str(dt.hour)
            wd = str(dt.weekday())  # 0=lunedì
            p  = t.get("pnl_pips") or 0
            for bucket, key in ((by_hour, h), (by_weekday, wd)):
                b = bucket.setdefault(key, {"trades": 0, "wins": 0, "pnl_pips": 0.0})
                b["trades"] += 1
                b["pnl_pips"] = round(b["pnl_pips"] + p, 1)
                if p > 0:
                    b["wins"] += 1
        except Exception:
            pass

    # ── AI stats ──────────────────────────────────────────────────────────────
    ai_approved = sum(1 for t in trades if t.get("ai_approved") == 1)
    ai_rejected = sum(1 for t in trades if t.get("ai_approved") == 0)
    ai_modified = sum(1 for t in trades if t.get("ai_approved") == 1 and t.get("ai_reason", "").startswith("modified"))

    return {
        "total_trades":           total,
        "trades_filled":          n_filled,
        "trades_not_filled":      n_nf,
        "trades_open_at_end":     n_open,
        "winning_trades":         n_wins,
        "losing_trades":          n_losses,
        "win_rate":               win_rate,
        "total_pnl_pips":         total_pips,
        "avg_pnl_pips":           avg_pips,
        "best_trade_pips":        best_pips,
        "worst_trade_pips":       worst_pips,
        "profit_factor":          pf,
        "max_drawdown_pips":      max_dd,
        "sharpe_ratio":           sharpe,
        "avg_trade_duration_min": avg_dur,
        "avg_rr_ratio":           avg_rr,
        "ai_approved":            ai_approved,
        "ai_rejected":            ai_rejected,
        "ai_modified":            ai_modified,
        "symbol_stats_json":      symbol_stats,
        "sender_stats_json":      sender_stats,
        "time_stats_json":        {"by_hour": by_hour, "by_weekday": by_weekday},
        "equity_curve_json":      equity_curve[-500:],
        **cost_info,
        **telegram_meta,
    }


# ── Engine principale ─────────────────────────────────────────────────────────

class BacktestEngine:

    def __init__(
        self,
        telegram_manager: "TelegramManager",
        signal_processor: "SignalProcessor",
        mt5_trader: "MT5Trader",
        backtest_store: "BacktestStore",
        strategy_executor: "StrategyExecutor | None" = None,
    ) -> None:
        self._tm   = telegram_manager
        self._sp   = signal_processor
        self._mt5  = mt5_trader
        self._store = backtest_store
        self._se   = strategy_executor

    async def run(
        self,
        *,
        run_id: str,
        user_id: str,
        group_id: str,
        group_name: str | None,
        mode: str,           # "date_limit" | "message_count"
        limit_value: str,    # ISO date str oppure int come str
        use_ai: bool,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        sizing_strategy: str | None,
        management_strategy: str | None,
    ) -> None:
        """
        Esegue il backtest completo in background.
        Aggiorna backtest_runs e inserisce backtest_trades al termine.
        """
        t0 = _time.monotonic()
        _u = {"user_id": user_id}
        logger.info("Backtest %s avviato per utente %s", run_id, user_id, extra=_u)

        try:
            await self._run_inner(
                run_id=run_id, user_id=user_id,
                group_id=group_id, group_name=group_name,
                mode=mode, limit_value=limit_value,
                use_ai=use_ai,
                mt5_login=mt5_login, mt5_password=mt5_password, mt5_server=mt5_server,
                sizing_strategy=sizing_strategy,
                management_strategy=management_strategy,
                t0=t0,
            )
        except Exception as exc:
            logger.error("Backtest %s errore: %s", run_id, exc, exc_info=True, extra=_u)
            await self._store.fail_run(run_id, str(exc))

    async def _run_inner(self, *, run_id, user_id, group_id, group_name,
                         mode, limit_value, use_ai,
                         mt5_login, mt5_password, mt5_server,
                         sizing_strategy, management_strategy, t0) -> None:

        ulog = logging.LoggerAdapter(logger, {"user_id": user_id})

        # ── 1. Fetch storico Telegram ─────────────────────────────────────────
        ulog.info("[%s] Phase 1: fetch storico Telegram...", run_id)
        await self._store.update_run(run_id, status="running:telegram_fetch")

        until_date: datetime | None = None
        msg_limit: int | None = None

        if mode == "date_limit":
            until_date = datetime.fromisoformat(limit_value).replace(tzinfo=timezone.utc)
        else:
            msg_limit = int(limit_value)

        loop = asyncio.get_event_loop()
        messages: list[dict] = await loop.run_in_executor(
            None,
            lambda: self._tm.get_history(
                user_id=user_id,
                group_id=int(group_id),
                limit=msg_limit,
                until_date=until_date,
            ),
        )

        if not messages:
            await self._store.fail_run(run_id, "Nessun messaggio trovato nel periodo richiesto")
            return

        period_from = messages[0]["date_iso"]
        period_to   = messages[-1]["date_iso"]
        ulog.info("[%s] Scaricati %d messaggi (%s → %s)", run_id, len(messages), period_from, period_to)
        await self._store.update_run(run_id,
            total_messages=len(messages),
            period_from=period_from,
            period_to=period_to,
        )

        # ── 2. Detection batch in parallelo (Flash flex) ──────────────────────
        ulog.info("[%s] Phase 2: detection Flash batch (%d msg)...", run_id, len(messages))
        await self._store.update_run(run_id, status="running:signal_detection")

        flash_t0 = _time.monotonic()
        detections, flash_stats = await self._detect_batch(
            [m["text"] for m in messages], user_id=user_id
        )
        flash_elapsed = _time.monotonic() - flash_t0

        signals_detected = sum(1 for d in detections if d)
        detection_rate   = round(signals_detected / len(messages) * 100, 1) if messages else 0.0
        ulog.info("[%s] Segnali rilevati: %d/%d (%.1f%%)", run_id,
                    signals_detected, len(messages), detection_rate)

        await self._store.update_run(run_id,
            flash_calls=flash_stats["calls"],
            flash_tokens_in=flash_stats["tokens_in"],
            flash_tokens_out=flash_stats["tokens_out"],
            flash_cost_usd=flash_stats["cost_usd"],
            flash_time_seconds=round(flash_elapsed, 1),
            signals_detected=signals_detected,
            signal_detection_rate=detection_rate,
        )

        # ── 3. Extraction segnali (Pro flex) ──────────────────────────────────
        ulog.info("[%s] Phase 3: extraction Pro per %d messaggi...", run_id, signals_detected)
        await self._store.update_run(run_id, status="running:signal_extraction")

        signal_msgs = [
            messages[i] for i, detected in enumerate(detections) if detected
        ]

        extracted: list[dict] = []   # {msg, signals: [TradeSignal]}
        pro_stats = {"calls": 0, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}
        pro_t0    = _time.monotonic()

        for msg in signal_msgs:
            tok_in  = 0
            tok_out = 0
            try:
                sigs, tok_in, tok_out = await self._sp.extract_signals(
                    msg["text"],
                    sizing_strategy=sizing_strategy,
                    user_id=user_id,
                    flex=True,
                )
            except Exception as exc:
                ulog.warning("[%s] Extraction fallita msg %s: %s", run_id, msg["id"], exc)
                sigs = []

            if sigs:
                extracted.append({"msg": msg, "signals": sigs})

            pro_stats["calls"]      += 1
            pro_stats["tokens_in"]  += tok_in
            pro_stats["tokens_out"] += tok_out
            pro_stats["cost_usd"]   += (
                tok_in  / 1_000_000 * _GEMINI_PRICING["pro_in"] +
                tok_out / 1_000_000 * _GEMINI_PRICING["pro_out"]
            )

        pro_elapsed = _time.monotonic() - pro_t0
        signals_extracted = sum(len(e["signals"]) for e in extracted)
        ulog.info("[%s] TradeSignal estratti: %d", run_id, signals_extracted)
        await self._store.update_run(run_id,
            pro_calls=pro_stats["calls"],
            pro_tokens_in=pro_stats["tokens_in"],
            pro_tokens_out=pro_stats["tokens_out"],
            pro_cost_usd=round(pro_stats["cost_usd"], 4),
            pro_time_seconds=round(pro_elapsed, 1),
            signals_extracted=signals_extracted,
        )

        if not extracted:
            await self._store.finish_run(run_id, _compute_aggregate(
                [], {}, {
                    "total_messages": len(messages),
                    "period_from": period_from,
                    "period_to": period_to,
                }
            ))
            return

        # ── 4. [use_ai=True] Decisione pre-trade AI ───────────────────────────
        pretrade_cost    = 0.0
        pretrade_calls   = 0
        pretrade_tok_in  = 0
        pretrade_tok_out = 0

        if use_ai and self._se and management_strategy:
            ulog.info("[%s] Phase 4: pre-trade AI su %d gruppi segnali...", run_id, len(extracted))
            await self._store.update_run(run_id, status="running:ai_pretrade")

            for entry in extracted:
                try:
                    decisions, pt_in, pt_out = await self._se.pre_trade(
                        user_id=user_id,
                        signals=entry["signals"],
                        management_strategy=management_strategy,
                        mt5_login=mt5_login,
                        mt5_password=mt5_password,
                        mt5_server=mt5_server,
                        signal_message=entry["msg"]["text"],
                        flex=True,
                    )
                    pretrade_calls   += 1
                    pretrade_tok_in  += pt_in
                    pretrade_tok_out += pt_out
                    pretrade_cost    += (
                        pt_in  / 1_000_000 * _GEMINI_PRICING["pro_in"] +
                        pt_out / 1_000_000 * _GEMINI_PRICING["pro_out"]
                    )

                    # Applica decisioni
                    approved = []
                    for i, sig in enumerate(entry["signals"]):
                        dec = decisions[i] if i < len(decisions) else None
                        if dec is None or dec.approved:
                            sig_meta = {
                                "ai_approved": 1,
                                "ai_reason":   dec.reason if dec else "",
                            }
                            from dataclasses import replace as _dc_replace
                            if dec and (dec.modified_lots or dec.modified_sl or dec.modified_tp):
                                sig = _dc_replace(
                                    sig,
                                    lot_size    = dec.modified_lots if dec.modified_lots  else sig.lot_size,
                                    stop_loss   = dec.modified_sl   if dec.modified_sl    else sig.stop_loss,
                                    take_profit = dec.modified_tp   if dec.modified_tp    else sig.take_profit,
                                )
                                sig_meta["ai_reason"] = f"modified: {dec.reason}"
                            approved.append((sig, sig_meta))
                        else:
                            # Segnale rifiutato: lo teniamo per statistiche ma segniamo ai_approved=0
                            entry.setdefault("rejected", []).append({
                                "sig": sig, "reason": dec.reason
                            })
                    entry["approved"] = approved
                except Exception as exc:
                    ulog.warning("[%s] pre_trade fallito: %s", run_id, exc)
                    entry["approved"] = [(s, {"ai_approved": None, "ai_reason": ""})
                                         for s in entry["signals"]]
        else:
            for entry in extracted:
                entry["approved"] = [(s, {"ai_approved": None, "ai_reason": ""})
                                     for s in entry["signals"]]

        await self._store.update_run(run_id,
            pretrade_calls=pretrade_calls,
            pretrade_tokens_in=pretrade_tok_in,
            pretrade_tokens_out=pretrade_tok_out,
            pretrade_cost_usd=round(pretrade_cost, 4),
        )

        # ── 5. Download barre MT5 per simbolo ────────────────────────────────
        ulog.info("[%s] Phase 5: download barre MT5...", run_id)
        await self._store.update_run(run_id, status="running:mt5_bars")

        # Raccoglie simboli e range temporali necessari
        symbols_needed: dict[str, dict] = {}  # sym → {from_dt, to_dt}

        for entry in extracted:
            msg_dt = _parse_dt(entry["msg"]["date_iso"])
            if msg_dt is None:
                continue
            end_dt = msg_dt + timedelta(days=_MAX_TRADE_HORIZON_DAYS)
            for sig, _ in entry.get("approved", []):
                sym = sig.symbol
                cur = symbols_needed.get(sym)
                if cur is None:
                    symbols_needed[sym] = {"from_dt": msg_dt, "to_dt": end_dt}
                else:
                    if msg_dt < cur["from_dt"]:
                        cur["from_dt"] = msg_dt
                    if end_dt > cur["to_dt"]:
                        cur["to_dt"] = end_dt

        bars_cache: dict[str, list[dict]] = {}
        point_cache: dict[str, float | None] = {}
        bars_coverage: dict[str, dict] = {}

        for sym, rng in symbols_needed.items():
            ulog.info("[%s] Download barre %s...", run_id, sym)
            result = await self._mt5.get_historical_bars(
                user_id=user_id,
                mt5_login=mt5_login,
                mt5_password=mt5_password,
                mt5_server=mt5_server,
                symbol=sym,
                from_dt=rng["from_dt"],
                to_dt=rng["to_dt"],
            )
            bars_cache[sym]  = result["bars"]
            point_cache[sym] = result.get("point")
            bars_coverage[sym] = {
                "timeframe":   result.get("timeframe"),
                "count":       result.get("count", 0),
                "period_from": result.get("period_from"),
                "period_to":   result.get("period_to"),
            }
            ulog.info("[%s] %s: %d barre %s", run_id, sym,
                        result.get("count", 0), result.get("timeframe"))

        await self._store.update_run(run_id, bars_coverage_json=bars_coverage)

        # ── 6. Simulazione walk-forward ───────────────────────────────────────
        ulog.info("[%s] Phase 6: simulazione %d segnali...", run_id, signals_extracted)
        await self._store.update_run(run_id, status="running:simulation")

        trade_rows: list[dict] = []

        for entry in extracted:
            msg     = entry["msg"]
            msg_dt  = _parse_dt(msg["date_iso"])
            approved_pairs = entry.get("approved", [])

            for sig, ai_meta in approved_pairs:
                bars  = bars_cache.get(sig.symbol, [])
                point = point_cache.get(sig.symbol)
                result = _simulate_trade(sig, msg_dt or datetime.now(timezone.utc), bars, point)

                trade_rows.append({
                    "run_id":          run_id,
                    "user_id":         user_id,
                    "msg_id":          msg["id"],
                    "msg_ts":          msg["date_iso"],
                    "sender_name":     msg["sender_name"],
                    "message_text":    msg["text"],
                    "symbol":          sig.symbol,
                    "order_type":      sig.order_type,
                    "order_mode":      sig.order_mode,
                    "entry_price_raw": sig.entry_price,
                    "stop_loss":       sig.stop_loss,
                    "take_profit":     sig.take_profit,
                    "lot_size":        sig.lot_size,
                    "actual_entry":    result.actual_entry,
                    "actual_entry_ts": result.actual_entry_ts,
                    "exit_price":      result.exit_price,
                    "exit_ts":         result.exit_ts,
                    "outcome":         result.outcome,
                    "pnl_pips":        result.pnl_pips,
                    "duration_min":    result.duration_min,
                    "ai_approved":     ai_meta.get("ai_approved"),
                    "ai_reason":       ai_meta.get("ai_reason", ""),
                })

            # Segnali rifiutati: teniamoli come trade "rejected" per statistiche
            for r in entry.get("rejected", []):
                trade_rows.append({
                    "run_id":       run_id,
                    "user_id":      user_id,
                    "msg_id":       msg["id"],
                    "msg_ts":       msg["date_iso"],
                    "sender_name":  msg["sender_name"],
                    "message_text": msg["text"],
                    "symbol":       r["sig"].symbol,
                    "order_type":   r["sig"].order_type,
                    "outcome":      "ai_rejected",
                    "pnl_pips":     None,
                    "ai_approved":  0,
                    "ai_reason":    r["reason"],
                })

        await self._store.insert_trades(trade_rows)

        # ── 7. Report finale ──────────────────────────────────────────────────
        ulog.info("[%s] Phase 7: calcolo report...", run_id)

        total_elapsed = _time.monotonic() - t0
        total_ai_cost = (
            flash_stats["cost_usd"] + pro_stats["cost_usd"] + pretrade_cost
        )

        cost_info = {
            "total_ai_cost_usd":  round(total_ai_cost, 4),
            "total_ai_seconds":   round(flash_elapsed + pro_elapsed, 1),
        }
        telegram_meta = {
            "total_messages":     len(messages),
            "period_from":        period_from,
            "period_to":          period_to,
        }

        stats = _compute_aggregate(trade_rows, cost_info, telegram_meta)
        stats["status"] = "done"
        await self._store.finish_run(run_id, stats)

        ulog.info(
            "[%s] Completato in %.0fs — %d trade simulati, win rate %.1f%%, "
            "P&L %.1f pips, costo AI $%.4f",
            run_id, total_elapsed,
            stats["total_trades"], stats["win_rate"],
            stats["total_pnl_pips"], total_ai_cost,
        )

    # ── Batch detection (Flash parallelo) ─────────────────────────────────────

    async def _detect_batch(
        self, texts: list[str], user_id: str
    ) -> tuple[list[bool], dict]:
        sem      = asyncio.Semaphore(_DETECT_CONCURRENCY)
        results  = [False] * len(texts)
        stats    = {"calls": 0, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}
        lock     = asyncio.Lock()

        async def _one(i: int, text: str) -> None:
            async with sem:
                tok_in  = 0
                tok_out = 0
                try:
                    is_sig, tok_in, tok_out = await self._sp._detect(text, user_id=user_id, flex=True)
                    results[i] = is_sig
                except Exception as exc:
                    logger.warning("Flash detection msg %d: %s", i, exc)
                    results[i] = False
                finally:
                    cost = (
                        tok_in  / 1_000_000 * _GEMINI_PRICING["flash_in"] +
                        tok_out / 1_000_000 * _GEMINI_PRICING["flash_out"]
                    )
                    async with lock:
                        stats["calls"]      += 1
                        stats["tokens_in"]  += tok_in
                        stats["tokens_out"] += tok_out
                        stats["cost_usd"]   += cost

        await asyncio.gather(*(_one(i, t) for i, t in enumerate(texts)))
        stats["cost_usd"] = round(stats["cost_usd"], 4)
        return results, stats


# ── Helpers interni ───────────────────────────────────────────────────────────

def _parse_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None
