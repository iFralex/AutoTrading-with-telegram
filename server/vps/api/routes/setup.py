"""
Route /api/setup/*

  GET  /api/setup/session                    → stato sessione per numero di telefono
  POST /api/setup/session                    → aggiorna campi della sessione
  DELETE /api/setup/session/fields           → cancella campi specifici della sessione
  DELETE /api/setup/session                  → elimina la sessione completa

  POST /api/setup/telegram/request-code     → step 2: invia OTP
  POST /api/setup/telegram/verify-code      → step 2: verifica OTP
  POST /api/setup/telegram/verify-password  → step 2: 2FA opzionale
  GET  /api/setup/telegram/groups           → step 3: lista gruppi reali
  POST /api/setup/mt5/verify                → step 4: verifica credenziali MT5
  POST /api/setup/complete                  → step 5: salva tutto e avvia listener
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from vps.services.telegram_manager import PasswordRequiredError, TelegramManager
from vps.services.user_store import UserStore
from vps.services.setup_session_store import SetupSessionStore
from vps.services.mt5_trader import (
    MT5_LOCK, MT5_INIT_RETRIES, MT5_INIT_RETRY_DELAY, MT5_INIT_TIMEOUT_MS,
    _ensure_experts_enabled, _kill_mt5_for_dir, _configure_server_via_gui,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/setup", tags=["setup"])

# Thread pool dedicato alle chiamate bloccanti MT5
_mt5_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="mt5-verify")


# ── Dependency helpers ───────────────────────────────────────────────────────

def get_telegram(request: Request) -> TelegramManager:
    return request.app.state.telegram_manager


def get_store(request: Request) -> UserStore:
    return request.app.state.user_store


def get_session_store(request: Request) -> SetupSessionStore:
    return request.app.state.setup_session_store


# ── Modelli sessione ──────────────────────────────────────────────────────────

class SaveSessionBody(BaseModel):
    phone: str = Field(..., min_length=7)
    api_id: int | None = None
    api_hash: str | None = None
    login_key: str | None = None
    user_id: str | None = None
    group_id: str | None = None
    group_name: str | None = None
    mt5_login: int | None = None
    mt5_password: str | None = None
    mt5_server: str | None = None
    sizing_strategy: str | None = None
    management_strategy: str | None = None
    deletion_strategy: str | None = None
    extraction_instructions: str | None = None
    range_entry_pct: int | None = None
    entry_if_favorable: bool | None = None
    min_confidence: int | None = None
    trading_hours_enabled: bool | None = None
    trading_hours_start: int | None = None
    trading_hours_end: int | None = None
    trading_hours_days: list[str] | None = None
    eco_calendar_enabled: bool | None = None
    eco_calendar_window: int | None = None
    eco_calendar_strategy: str | None = None
    community_visible: bool | None = None


class ClearSessionFieldsBody(BaseModel):
    phone: str = Field(..., min_length=7)
    fields: list[str]


# ── Modelli Telegram / MT5 ────────────────────────────────────────────────────

class RequestCodeBody(BaseModel):
    api_id: int = Field(..., gt=0)
    api_hash: str = Field(..., min_length=32, max_length=32)
    phone: str = Field(..., min_length=7)


class VerifyCodeBody(BaseModel):
    login_key: str
    code: str = Field(..., min_length=4, max_length=8)


class VerifyPasswordBody(BaseModel):
    login_key: str
    password: str = Field(..., min_length=1)


class MT5VerifyBody(BaseModel):
    login: int = Field(..., gt=0)
    password: str = Field(..., min_length=1)
    server: str = Field(..., min_length=1)
    phone: str | None = None  # Se fornito, usa la dir personale dell'utente invece del template


class CompleteSetupBody(BaseModel):
    login_key: str
    user_id: str
    api_id: int
    api_hash: str
    phone: str
    group_id: str
    group_name: str
    mt5_login: int | None = None
    mt5_password: str | None = None
    mt5_server: str | None = None
    sizing_strategy: str | None = None
    management_strategy: str | None = None
    deletion_strategy: str | None = None
    extraction_instructions: str | None = None
    range_entry_pct: int = 0
    entry_if_favorable: bool = False
    min_confidence: int = 0
    trading_hours_enabled: bool = False
    trading_hours_start: int = 0
    trading_hours_end: int = 22
    trading_hours_days: list[str] | None = None
    eco_calendar_enabled: bool = False
    eco_calendar_window: int = 30
    eco_calendar_strategy: str | None = None
    community_visible: bool = False


# ── Session endpoints ────────────────────────────────────────────────────────

@router.get("/session")
async def get_session(
    phone: str,
    ss: SetupSessionStore = Depends(get_session_store),
    store: UserStore = Depends(get_store),
):
    """
    Ritorna lo stato della sessione di setup per il numero di telefono.
    Controlla prima la sessione di setup in corso, poi gli utenti già registrati.
    Se non esiste risponde {"exists": false}.
    """
    # 1. Setup in corso (sessione temporanea)
    session = await ss.get(phone)
    if session is not None:
        return {"exists": True, **session}

    # 2. Utente che ha già completato il setup → redirect alla dashboard
    user = await store.get_user_by_phone(phone)
    if user is not None:
        return {"exists": True, "setup_complete": True, "user_id": user["user_id"]}

    return {"exists": False}


@router.post("/session")
async def save_session(
    body: SaveSessionBody,
    ss: SetupSessionStore = Depends(get_session_store),
):
    """
    Salva/aggiorna i campi della sessione per il numero di telefono.
    Solo i campi non-None nel body vengono aggiornati.
    """
    fields = body.model_dump(exclude_none=True, exclude={"phone"})
    await ss.upsert(body.phone, fields)
    return {"ok": True}


@router.delete("/session/fields")
async def clear_session_fields(
    body: ClearSessionFieldsBody,
    ss: SetupSessionStore = Depends(get_session_store),
):
    """
    Cancella (imposta a NULL) i campi specificati della sessione.
    Usato dal pulsante Indietro per rimuovere dati non più validi.
    """
    await ss.clear_fields(body.phone, body.fields)
    return {"ok": True}


@router.delete("/session")
async def delete_session(
    phone: str,
    ss: SetupSessionStore = Depends(get_session_store),
):
    """Elimina completamente la sessione (usato da 'Ricomincia da capo')."""
    await ss.delete(phone)
    return {"ok": True}


# ── Telegram endpoints ───────────────────────────────────────────────────────

@router.post("/telegram/request-code")
async def request_code(
    body: RequestCodeBody,
    tm: TelegramManager = Depends(get_telegram),
):
    """Invia il codice OTP al numero di telefono. Ritorna login_key."""
    try:
        return tm.request_code(body.api_id, body.api_hash, body.phone)
    except Exception as exc:
        logger.error("request_code: %s", exc)
        raise HTTPException(400, detail=str(exc))


@router.post("/telegram/verify-code")
async def verify_code(
    body: VerifyCodeBody,
    tm: TelegramManager = Depends(get_telegram),
):
    """
    Verifica il codice OTP.
    Se l'account ha 2FA attivo risponde {"error": "2fa_required", "login_key": "..."}
    e il frontend dovrà chiamare /verify-password.
    """
    try:
        return tm.verify_code(body.login_key, body.code)
    except PasswordRequiredError as exc:
        return {"error": "2fa_required", "login_key": exc.login_key}
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))
    except Exception as exc:
        logger.error("verify_code: %s", exc)
        raise HTTPException(400, detail=str(exc))


@router.post("/telegram/verify-password")
async def verify_password(
    body: VerifyPasswordBody,
    tm: TelegramManager = Depends(get_telegram),
):
    """Completa il login 2FA con la password cloud di Telegram."""
    try:
        return tm.verify_password(body.login_key, body.password)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))
    except Exception as exc:
        logger.error("verify_password: %s", exc)
        raise HTTPException(400, detail=str(exc))


@router.get("/telegram/groups")
async def get_groups(
    login_key: str,
    tm: TelegramManager = Depends(get_telegram),
):
    """Ritorna i gruppi e canali di cui è membro l'utente autenticato."""
    try:
        groups = tm.get_groups(login_key)
        return {"groups": groups}
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))
    except Exception as exc:
        logger.error("get_groups: %s", exc)
        raise HTTPException(400, detail=str(exc))


@router.get("/telegram/recent-messages")
async def get_recent_messages(
    login_key: str,
    group_id: str,
    limit: int = 15,
    tm: TelegramManager = Depends(get_telegram),
):
    """Ritorna gli ultimi N messaggi testuali dal gruppo selezionato (max 30)."""
    try:
        msgs = tm.get_recent_messages(login_key, group_id, min(limit, 30))
        return {"messages": msgs}
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))
    except Exception as exc:
        logger.error("get_recent_messages: %s", exc)
        raise HTTPException(400, detail=str(exc))


# ── Signal simulator ──────────────────────────────────────────────────────────

class SimulateSignalBody(BaseModel):
    message: str
    sizing_strategy: str | None = None
    extraction_instructions: str | None = None
    management_strategy: str | None = None
    deletion_strategy: str | None = None
    price_path: list[dict] | None = None    # [{"t": 0-1, "price": float}, ...]
    timeline_events: list[dict] | None = None  # [{"t": 0-1, "type": "signal_deleted"}, ...]
    lot_size: float = 0.1


@router.post("/simulate-signal")
async def simulate_signal_endpoint(
    body: SimulateSignalBody,
    request: Request,
):
    """
    Dry-run: estrae il segnale dal messaggio con l'AI e, se viene fornito
    un price_path, simula gli eventi (entry/SL/TP) sul percorso di prezzo disegnato.
    Non apre MT5 e non piazza ordini reali.
    """
    from vps.services.signal_processor import SignalProcessor
    sp: SignalProcessor | None = request.app.state.signal_processor
    if sp is None:
        raise HTTPException(503, detail="Signal processor not available (GEMINI_API_KEY missing)")

    try:
        is_signal = await sp.detect_signal(body.message)
        if not is_signal:
            return {"is_signal": False, "extracted": [], "simulation": None}

        signals, _, _ = await sp.extract_signals(
            body.message,
            sizing_strategy=body.sizing_strategy,
            extraction_instructions=body.extraction_instructions,
            management_strategy=body.management_strategy,
        )
    except Exception as exc:
        logger.error("simulate_signal_endpoint: %s", exc)
        raise HTTPException(500, detail=str(exc))

    from dataclasses import asdict
    extracted = [asdict(s) for s in signals]

    simulation = None
    if body.price_path and len(body.price_path) >= 2 and signals:
        simulation = _sim_price_events(
            signals,
            body.price_path,
            body.timeline_events or [],
            body.lot_size,
            body.deletion_strategy,
        )

    return {"is_signal": True, "extracted": extracted, "simulation": simulation}


def _sim_price_events(signals, price_path, timeline_events, default_lot, deletion_strategy):
    """Pure price-path simulation — no MT5."""
    per_signal = []
    total_pnl = 0.0
    n = len(price_path)

    for sig_idx, sig in enumerate(signals):
        sig_events: list[dict] = []
        entry = sig.entry_price
        sl = sig.stop_loss
        tp = sig.take_profit
        lot = sig.lot_size if sig.lot_size else default_lot
        order_type = sig.order_type

        if isinstance(entry, list):
            actual_entry: float | None = (entry[0] + entry[1]) / 2.0
            state = "pending"
        elif entry is not None:
            actual_entry = float(entry)
            state = "pending"
        else:
            actual_entry = None
            state = "market_pending"

        order_open_price: float | None = None

        for i, pt in enumerate(price_path):
            t_norm = i / max(n - 1, 1)
            price = float(pt.get("price", 0))

            if state in ("closed", "deleted"):
                break

            # Timeline events
            for te in timeline_events:
                te_t = float(te.get("t", -1))
                if abs(te_t - t_norm) < (1.5 / max(n, 1)):
                    if te.get("type") == "signal_deleted":
                        desc = "Signal deleted"
                        if deletion_strategy:
                            preview = deletion_strategy[:60] + ("…" if len(deletion_strategy) > 60 else "")
                            desc += f" — AI action: "{preview}""
                        sig_events.append({"t": t_norm, "type": "signal_deleted", "price": price, "description": desc})
                        state = "deleted"
                        break

            if state in ("closed", "deleted"):
                break

            if state == "market_pending":
                order_open_price = price
                state = "open"
                sig_events.append({"t": t_norm, "type": "entry", "price": price,
                                    "description": f"Market {order_type} opened @ {price:.5f}"})

            elif state == "pending" and actual_entry is not None:
                hit = (order_type == "BUY" and price <= actual_entry) or \
                      (order_type == "SELL" and price >= actual_entry)
                if hit:
                    order_open_price = actual_entry
                    state = "open"
                    sig_events.append({"t": t_norm, "type": "entry", "price": actual_entry,
                                        "description": f"Limit {order_type} triggered @ {actual_entry:.5f}"})

            if state == "open" and order_open_price is not None:
                if sl is not None:
                    sl_hit = (order_type == "BUY" and price <= sl) or (order_type == "SELL" and price >= sl)
                    if sl_hit:
                        pnl = _calc_pnl(order_type, order_open_price, sl, lot)
                        total_pnl += pnl
                        sig_events.append({"t": t_norm, "type": "sl", "price": sl,
                                            "pnl": round(pnl, 2),
                                            "description": f"Stop Loss @ {sl:.5f}  ({pnl:+.2f})"})
                        state = "closed"
                        break

                if tp is not None:
                    tp_hit = (order_type == "BUY" and price >= tp) or (order_type == "SELL" and price <= tp)
                    if tp_hit:
                        pnl = _calc_pnl(order_type, order_open_price, tp, lot)
                        total_pnl += pnl
                        sig_events.append({"t": t_norm, "type": "tp", "price": tp,
                                            "pnl": round(pnl, 2),
                                            "description": f"Take Profit @ {tp:.5f}  ({pnl:+.2f})"})
                        state = "closed"
                        break

                # Price level events (from management strategy)
                prices = getattr(sig, "prices", None) or []
                for pl in prices:
                    already = any(e["type"] == "price_level" and e.get("trigger_price") == pl for e in sig_events)
                    if not already:
                        pl_hit = (order_type == "BUY" and price >= pl) or (order_type == "SELL" and price <= pl)
                        if pl_hit:
                            sig_events.append({
                                "t": t_norm, "type": "price_level", "price": pl,
                                "trigger_price": pl,
                                "description": f"Strategy price level reached @ {pl:.5f}",
                            })

        per_signal.append({
            "signal_index": sig_idx,
            "symbol": sig.symbol,
            "order_type": sig.order_type,
            "entry": actual_entry,
            "sl": sl,
            "tp": tp,
            "prices": getattr(sig, "prices", None) or [],
            "events": sig_events,
            "state": state,
        })

    return {"per_signal": per_signal, "total_pnl": round(total_pnl, 2)}


def _calc_pnl(order_type: str, open_price: float, close_price: float, lot: float) -> float:
    diff = (close_price - open_price) if order_type == "BUY" else (open_price - close_price)
    return diff * lot * 100000  # approximate; pip value varies by instrument


# ── AI strategy mock simulation ───────────────────────────────────────────────

class SimulatePretradeBody(BaseModel):
    signals: list[dict]         # extracted signals (from simulate-signal)
    message: str = ""           # original signal message (for pretrade prompt)
    management_strategy: str | None = None
    deletion_strategy: str | None = None
    event_type: str = "pretrade"   # "pretrade" | "message_deleted" | "price_level_reached"
    event_data: dict | None = None # for non-pretrade events
    mock_state: dict = {}


@router.post("/simulate-pretrade")
async def simulate_pretrade_endpoint(
    body: SimulatePretradeBody,
    request: Request,
):
    """
    Simula pre_trade / on_event con un agente Gemini reale ma con tool MT5 mockati.
    Il mock_state (account, P&L, posizioni) è fornito dall'utente ed è editabile.
    Non apre MT5, non piazza ordini reali.
    """
    from vps.services.signal_processor import SignalProcessor
    sp: SignalProcessor | None = request.app.state.signal_processor
    if sp is None:
        raise HTTPException(503, detail="Signal processor not available (GEMINI_API_KEY missing)")

    strategy = (body.management_strategy or "").strip()
    if body.event_type == "message_deleted":
        strategy = (body.deletion_strategy or "").strip()

    if not strategy:
        return {"decisions": [], "tool_calls": [], "final_response": "No strategy configured.", "event_type": body.event_type}

    try:
        result = await _run_mock_agent(
            client=sp._client,
            management_strategy=strategy,
            signals=body.signals,
            message=body.message,
            event_type=body.event_type,
            event_data=body.event_data or {},
            mock_state=body.mock_state,
        )
    except Exception as exc:
        logger.error("simulate_pretrade_endpoint: %s", exc)
        raise HTTPException(500, detail=str(exc))

    return result


async def _run_mock_agent(
    client,
    management_strategy: str,
    signals: list[dict],
    message: str,
    event_type: str,
    event_data: dict,
    mock_state: dict,
) -> dict:
    """
    Esegue il vero agente Gemini con tool MT5 mockati.
    Restituisce: decisions, tool_calls, final_response.
    """
    import json
    from datetime import datetime, timezone

    from google.genai import types as _types
    from vps.services.strategy_executor import (
        _make_tools, _build_system_prompt, _PRO_MODEL, _compact, _format_event_prompt,
    )

    decisions: dict[int, dict] = {}
    tool_calls_log: list[dict] = []

    # ── Mock account values ───────────────────────────────────────────────────
    balance      = float(mock_state.get("balance", 10000))
    equity       = float(mock_state.get("equity", balance))
    free_margin  = float(mock_state.get("free_margin", equity))
    currency     = str(mock_state.get("currency", "USD"))
    leverage     = int(mock_state.get("leverage", 100))
    open_pos     = list(mock_state.get("open_positions", []))
    pending_ord  = list(mock_state.get("pending_orders", []))
    daily_pnl    = float(mock_state.get("daily_pnl", 0))
    weekly_pnl   = float(mock_state.get("weekly_pnl", 0))
    monthly_pnl  = float(mock_state.get("monthly_pnl", 0))
    mock_prices  = dict(mock_state.get("prices", {}))

    _SYMBOL_DEFAULTS: dict[str, dict] = {
        "XAUUSD":  {"bid": 2340.0,  "ask": 2340.5,  "spread_pips": 0.5,  "last": 2340.25},
        "EURUSD":  {"bid": 1.0850,  "ask": 1.0851,  "spread_pips": 0.1,  "last": 1.0850},
        "GBPUSD":  {"bid": 1.2650,  "ask": 1.2651,  "spread_pips": 0.1,  "last": 1.2650},
        "USDJPY":  {"bid": 149.50,  "ask": 149.51,  "spread_pips": 0.1,  "last": 149.50},
        "BTCUSD":  {"bid": 65000.0, "ask": 65010.0, "spread_pips": 10.0, "last": 65005.0},
        "XAGUSD":  {"bid": 29.50,   "ask": 29.51,   "spread_pips": 0.1,  "last": 29.50},
    }

    def _mock_dispatch(name: str, args: dict) -> dict:
        if name == "get_account_info":
            return {"balance": balance, "equity": equity, "margin": balance - free_margin,
                    "free_margin": free_margin, "profit_floating": equity - balance,
                    "leverage": leverage, "currency": currency,
                    "login": 12345678, "server": mock_state.get("server", "SimBroker-Demo")}
        if name == "get_open_positions":
            return {"positions": open_pos}
        if name == "get_pending_orders":
            return {"orders": pending_ord}
        if name == "count_open_positions":
            return {"count": len(open_pos)}
        if name == "count_pending_orders":
            return {"count": len(pending_ord)}
        if name == "get_position_history":
            return {"positions": []}
        if name == "get_daily_pnl":
            return {"pnl": daily_pnl, "currency": currency}
        if name == "get_weekly_pnl":
            return {"pnl": weekly_pnl}
        if name == "get_monthly_pnl":
            return {"pnl": monthly_pnl}
        if name == "get_current_datetime":
            now = datetime.now(timezone.utc)
            return {"date": now.strftime("%Y-%m-%d"), "time": now.strftime("%H:%M:%S"),
                    "weekday_name": now.strftime("%A"), "weekday_number": now.weekday(),
                    "hour": now.hour, "minute": now.minute, "is_weekend": now.weekday() >= 5}
        if name == "get_current_price":
            sym = str(args.get("symbol", ""))
            return mock_prices.get(sym) or _SYMBOL_DEFAULTS.get(sym) or {"bid": 1.0, "ask": 1.0001, "spread_pips": 0.1, "last": 1.0}
        if name == "get_symbol_info":
            sym = str(args.get("symbol", ""))
            if "XAU" in sym or "GOLD" in sym.upper():
                return {"pip_value_per_lot": 10.0, "contract_size": 100, "digits": 2,
                        "volume_min": 0.01, "volume_max": 50.0, "volume_step": 0.01, "currency_profit": "USD"}
            return {"pip_value_per_lot": 10.0, "contract_size": 100000, "digits": 5,
                    "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "currency_profit": "USD"}
        if name == "calculate_lot_for_risk":
            risk_amount = float(args.get("risk_amount", 100))
            sl_pips = max(0.001, float(args.get("sl_pips", 20)))
            return {"lot_size": max(0.01, round(risk_amount / (sl_pips * 10), 2))}
        if name == "calculate_lot_for_risk_percent":
            pct = float(args.get("risk_percent", 1))
            sl_pips = max(0.001, float(args.get("sl_pips", 20)))
            return {"lot_size": max(0.01, round(balance * pct / 100 / (sl_pips * 10), 2))}
        # Decision tools
        if name == "approve_signal":
            idx = int(args.get("signal_index", 0))
            decisions[idx] = {"approved": True, "reason": str(args.get("reason", ""))}
            return {"ok": True}
        if name == "reject_signal":
            idx = int(args.get("signal_index", 0))
            decisions[idx] = {"approved": False, "reason": str(args.get("reason", "rejected by strategy"))}
            return {"ok": True}
        if name == "modify_signal":
            idx = int(args.get("signal_index", 0))
            decisions[idx] = {
                "approved": True,
                "modified_lots": args.get("new_lots"),
                "modified_sl":   args.get("new_sl"),
                "modified_tp":   args.get("new_tp"),
                "reason":        str(args.get("reason", "modified by strategy")),
            }
            return {"ok": True}
        # Action tools for on_event (simulated — no real MT5)
        return {"ok": True, "simulated": True, "note": f"Mock: {name} would execute in production"}

    # ── Build event prompt ────────────────────────────────────────────────────
    if event_type == "pretrade":
        sigs_text = "\n".join(
            f"  [{i}] {s.get('order_type')} {s.get('symbol')}"
            f" entry={s.get('entry_price')} SL={s.get('stop_loss')} TP={s.get('take_profit')}"
            f" lots={s.get('lot_size')} mode={s.get('order_mode')}"
            for i, s in enumerate(signals)
        )
        event_prompt = (
            "EVENT: New trading signals received. You must evaluate ALL of them.\n\n"
            f"Source message:\n{message}\n\n"
            f"Signals to evaluate:\n{sigs_text}\n\n"
            "For each signal call approve_signal, reject_signal or modify_signal.\n"
            "If you call no tool for a signal, it will be approved by default.\n"
            "Use read tools (get_account_info, get_daily_pnl, etc.) if your strategy requires it."
        )
        # Pre-fetch context (mirrors production behaviour)
        event_prompt += (
            f"\n\nPre-fetched context (do not re-query these):\n"
            f"  account: balance={balance} equity={equity} free_margin={free_margin}"
            f" currency={currency} leverage={leverage}\n"
            f"  open_positions_count: {len(open_pos)}"
        )
    else:
        event_prompt = _format_event_prompt(event_type, event_data)
        if open_pos:
            pos_parts = [
                f"#{p.get('ticket','?')} {p.get('order_type')} {p.get('symbol')}"
                f" lots={p.get('lots')} profit={p.get('profit', 0)}"
                for p in open_pos
            ]
            event_prompt += (
                f"\n\nPre-fetched context:\n"
                f"  open_positions ({len(open_pos)}): " + " | ".join(pos_parts)
            )

    # ── Run Gemini agent loop with mock tools ─────────────────────────────────
    tools        = _make_tools(event_type)
    system_prompt = _build_system_prompt(management_strategy)
    config = _types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=tools,  # type: ignore[arg-type]
    )
    chat = client.aio.chats.create(model=_PRO_MODEL, config=config)

    try:
        response = await chat.send_message(event_prompt)
    except Exception as exc:
        return {"decisions": [], "tool_calls": [], "final_response": f"AI error: {exc}", "event_type": event_type}

    final_text = ""
    for _ in range(8):
        fn_calls = response.function_calls or []
        if not fn_calls:
            final_text = (response.text or "").strip()
            break

        fn_response_parts = []
        for fc in fn_calls:
            name = fc.name
            args = dict(fc.args)
            result_data = _mock_dispatch(name, args)
            tool_calls_log.append({"name": name, "args": args, "result": result_data})
            fn_response_parts.append(
                _types.Part.from_function_response(
                    name=name,
                    response={"result": json.dumps(_compact(result_data), separators=(",", ":"), default=str)},
                )
            )

        try:
            response = await chat.send_message(fn_response_parts)
        except Exception as exc:
            return {"decisions": list(decisions.values()), "tool_calls": tool_calls_log,
                    "final_response": f"AI error mid-loop: {exc}", "event_type": event_type}

    # Default approval for any signal not explicitly handled
    all_decisions = [
        decisions.get(i, {"approved": True, "reason": "Not mentioned — approved by default"})
        for i in range(len(signals))
    ]
    for i, d in enumerate(all_decisions):
        d["signal_index"] = i

    return {
        "event_type":     event_type,
        "decisions":      all_decisions,
        "tool_calls":     tool_calls_log,
        "final_response": final_text,
    }


# ── MT5 endpoint ─────────────────────────────────────────────────────────────

@router.post("/mt5/verify")
async def verify_mt5(
    body: MT5VerifyBody,
    ss: SetupSessionStore = Depends(get_session_store),
):
    """
    Tenta il login a MetaTrader 5 con le credenziali fornite.

    Se il body include phone, recupera user_id dalla sessione di setup e usa
    la directory MT5 personale dell'utente (creata dal template se non esiste):
      1. Copia template → <mt5_users>/<user_id>/
      2. Avvia MT5 + invia il server tramite SendKeys (configura la GUI di login)
      3. mt5.initialize() si aggancia all'MT5 in esecuzione e fa login
      4. Ritorna le info del conto; chiude API e termina MT5

    Senza phone (fallback): usa il template direttamente con kill+restart.

    Returns:
        {"valid": true, "account": {"name", "server", "balance", "currency"}}

    Errors:
        503 — libreria MT5 non disponibile (non si è su Windows)
        400 — credenziali errate o MT5 non in esecuzione
    """
    # Recupera user_id dalla sessione se il telefono è fornito
    user_id: str | None = None
    if body.phone:
        session = await ss.get(body.phone)
        if session:
            user_id = session.get("user_id")

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            _mt5_executor,
            _mt5_login_sync,
            body.login,
            body.password,
            body.server,
            user_id,
        )
        return result
    except RuntimeError as exc:
        msg = str(exc)
        status = 503 if "non disponibile" in msg else 400
        raise HTTPException(status, detail=msg)
    except Exception as exc:
        logger.error("verify_mt5: %s", exc)
        raise HTTPException(400, detail=str(exc))


def _mt5_login_sync(
    login: int, password: str, server: str, user_id: str | None = None
) -> dict:
    """Eseguita in ThreadPoolExecutor — può bloccare senza problemi.

    Se user_id è fornito (flusso utente reale):
      1. Copia template → <mt5_users>/<user_id>/ (se la dir non esiste ancora)
      2. Avvia MT5 + invia il server tramite SendKeys (configura la GUI di login)
         Lascia MT5 in esecuzione (senza chiuderlo)
      3. mt5.initialize() si aggancia all'istanza MT5 in esecuzione e fa login
      4. Ritorna le info del conto
      5. mt5.shutdown() + kill del processo MT5

    Se user_id è None (fallback al template):
      Kill + restart del template con credenziali passate direttamente a initialize().
    """
    import os
    import shutil
    import time
    from pathlib import Path

    try:
        import MetaTrader5 as mt5
    except ImportError:
        raise RuntimeError(
            "Libreria MetaTrader5 non disponibile su questo server "
            "(richiede Windows con MT5 installato)"
        )

    bot_dir = Path(os.environ.get("TRADING_BOT_DIR", r"C:\TradingBot"))
    template_dir = bot_dir / "mt5_template"

    if not (template_dir / "terminal64.exe").exists():
        raise RuntimeError(
            f"MT5 template non trovato in {template_dir}. "
            "Eseguire setup.ps1 prima di usare il bot."
        )

    if user_id:
        # ── Flusso utente reale ───────────────────────────────────────────────
        user_dir = bot_dir / "mt5_users" / user_id

        # STEP 2 (diagnostica): copia template → directory utente se non esiste
        if not (user_dir / "terminal64.exe").exists():
            logger.info("verify_mt5 — copia template → %s", user_dir)
            shutil.copytree(str(template_dir), str(user_dir), dirs_exist_ok=True)

        terminal_exe = user_dir / "terminal64.exe"

        with MT5_LOCK:
            # Fix ExpertsEnabled=1 prima che MT5 parta
            _ensure_experts_enabled(user_dir)
            # Kill eventuali residui dalla dir utente
            _kill_mt5_for_dir(user_dir)

            # STEP 3 (diagnostica): avvia MT5 + invia server via SendKeys
            logger.info(
                "verify_mt5 — avvio MT5 utente %s + configurazione server '%s' via GUI...",
                user_id, server,
            )
            _configure_server_via_gui(user_dir, server)
            time.sleep(3.0)  # Breve attesa dopo SendKeys

            # STEP 4 (diagnostica): mt5.initialize() si aggancia all'MT5 in esecuzione
            init_ok = mt5.initialize(
                path=str(terminal_exe),
                portable=True,
                login=login,
                password=password,
                server=server,
                timeout=MT5_INIT_TIMEOUT_MS,
            )
            if not init_ok:
                code, msg = mt5.last_error()
                mt5.shutdown()
                _kill_mt5_for_dir(user_dir)
                raise RuntimeError(f"MT5 non avviabile: {msg} (codice {code})")

            try:
                info = mt5.account_info()
                if info is None:
                    raise RuntimeError(
                        "initialize() OK ma login non riuscito (account_info None)"
                    )
                return {
                    "valid": True,
                    "account": {
                        "name":     info.name,
                        "server":   info.server,
                        "balance":  round(info.balance, 2),
                        "currency": info.currency,
                    },
                }
            finally:
                mt5.shutdown()
                # Termina MT5 dopo la verifica; la dir utente rimane configurata
                # e sarà pronta per l'esecuzione degli ordini.
                _kill_mt5_for_dir(user_dir)

    else:
        # ── Fallback: usa il template direttamente ────────────────────────────
        terminal_exe = template_dir / "terminal64.exe"

        with MT5_LOCK:
            _ensure_experts_enabled(template_dir)
            _kill_mt5_for_dir(template_dir)

            init_ok = False
            last_err = ""
            for attempt in range(1, MT5_INIT_RETRIES + 1):
                if attempt > 1:
                    mt5.shutdown()
                    _kill_mt5_for_dir(template_dir)
                    _ensure_experts_enabled(template_dir)
                    time.sleep(MT5_INIT_RETRY_DELAY)
                if mt5.initialize(
                    path=str(terminal_exe),
                    portable=True,
                    login=login,
                    password=password,
                    server=server,
                    timeout=MT5_INIT_TIMEOUT_MS,
                ):
                    init_ok = True
                    break
                code, msg = mt5.last_error()
                last_err = f"MT5 non avviabile: {msg} (codice {code})"
                logger.warning(
                    "verify_mt5 tentativo %d/%d: %s", attempt, MT5_INIT_RETRIES, last_err
                )

            if not init_ok:
                raise RuntimeError(last_err)

            try:
                info = mt5.account_info()
                if info is None:
                    raise RuntimeError(
                        "initialize() OK ma login non riuscito (account_info None)"
                    )
                return {
                    "valid": True,
                    "account": {
                        "name":     info.name,
                        "server":   info.server,
                        "balance":  round(info.balance, 2),
                        "currency": info.currency,
                    },
                }
            finally:
                mt5.shutdown()


# ── Complete endpoint ─────────────────────────────────────────────────────────

@router.post("/complete")
async def complete_setup(
    body: CompleteSetupBody,
    tm: TelegramManager = Depends(get_telegram),
    store: UserStore = Depends(get_store),
    ss: SetupSessionStore = Depends(get_session_store),
):
    """
    Finalizza il setup:
    1. Se mt5_password non è fornita nel body, la recupera dalla sessione di setup
    2. Salva l'utente nel database (password MT5 cifrata)
    3. Promuove la sessione Telegram a definitiva e avvia il listener
    4. Elimina la sessione di setup temporanea
    """
    try:
        mt5_password = body.mt5_password
        if not mt5_password:
            mt5_password = await ss.get_mt5_password(body.phone)

        await store.upsert({
            "user_id":      body.user_id,
            "api_id":       body.api_id,
            "api_hash":     body.api_hash,
            "phone":        body.phone,
            "group_id":     int(body.group_id),
            "group_name":   body.group_name,
            "mt5_login":    body.mt5_login,
            "mt5_password": mt5_password,
            "mt5_server":   body.mt5_server,
        })

        # Popola il primo gruppo nella tabella multi-gruppo
        await store.upsert_user_group(
            user_id=body.user_id,
            group_id=int(body.group_id),
            group_name=body.group_name,
            sizing_strategy=body.sizing_strategy,
            management_strategy=body.management_strategy,
            deletion_strategy=body.deletion_strategy,
            extraction_instructions=body.extraction_instructions,
            range_entry_pct=body.range_entry_pct,
            entry_if_favorable=body.entry_if_favorable,
            min_confidence=body.min_confidence,
            trading_hours_enabled=body.trading_hours_enabled,
            trading_hours_start=body.trading_hours_start,
            trading_hours_end=body.trading_hours_end,
            trading_hours_days=body.trading_hours_days,
            eco_calendar_enabled=body.eco_calendar_enabled,
            eco_calendar_window=body.eco_calendar_window,
            eco_calendar_strategy=body.eco_calendar_strategy,
            community_visible=body.community_visible,
        )

        tm.add_user(
            user_id=body.user_id,
            api_id=body.api_id,
            api_hash=body.api_hash,
            group_ids=[int(body.group_id)],
            login_key=body.login_key,
        )

        # Pulizia della sessione temporanea
        await ss.delete(body.phone)

        logger.info("Setup completato — utente %s attivo", body.user_id)
        return {"status": "active", "user_id": body.user_id}

    except Exception as exc:
        logger.error("complete_setup (%s): %s", body.user_id, exc)
        raise HTTPException(500, detail=str(exc))
