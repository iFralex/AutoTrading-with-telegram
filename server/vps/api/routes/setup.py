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
    symbol_specs: dict[str, float] | None = None  # symbol → contract_size override


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
            body.symbol_specs or {},
        )

    return {"is_signal": True, "extracted": extracted, "simulation": simulation}


def _sim_price_events(signals, price_path, timeline_events, default_lot, deletion_strategy,
                      symbol_specs: dict | None = None):
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
            t_norm = float(pt.get("t", i / max(n - 1, 1)))
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
                            desc += f' — AI action: “{preview}”'
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
                prev_price = float(price_path[i - 1].get("price", 0)) if i > 0 else None
                hit = (
                    prev_price is not None
                    and (prev_price - actual_entry) * (price - actual_entry) <= 0
                )
                if hit:
                    order_open_price = actual_entry
                    state = "open"
                    sig_events.append({"t": t_norm, "type": "entry", "price": actual_entry,
                                        "description": f"Limit {order_type} triggered @ {actual_entry:.5f}"})
                else:
                    # Pre-entry invalidation: SL or TP reached before entry
                    if sl is not None and (
                        (order_type == "BUY"  and price <= sl) or
                        (order_type == "SELL" and price >= sl)
                    ):
                        sig_events.append({"t": t_norm, "type": "expired", "price": sl,
                                            "description": f"Signal expired — SL {sl:.5f} hit before entry"})
                        state = "expired"
                        break
                    if tp is not None and (
                        (order_type == "BUY"  and price >= tp) or
                        (order_type == "SELL" and price <= tp)
                    ):
                        sig_events.append({"t": t_norm, "type": "expired", "price": tp,
                                            "description": f"Signal expired — TP {tp:.5f} hit before entry"})
                        state = "expired"
                        break

            if state == "open" and order_open_price is not None:
                if sl is not None:
                    sl_hit = (order_type == "BUY" and price <= sl) or (order_type == "SELL" and price >= sl)
                    if sl_hit:
                        pnl = _calc_pnl(order_type, order_open_price, sl, lot, sig.symbol, symbol_specs)
                        total_pnl += pnl
                        sig_events.append({"t": t_norm, "type": "sl", "price": sl,
                                            "pnl": round(pnl, 2),
                                            "description": f"Stop Loss @ {sl:.5f}  ({pnl:+.2f})"})
                        state = "closed"
                        break

                if tp is not None:
                    tp_hit = (order_type == "BUY" and price >= tp) or (order_type == "SELL" and price <= tp)
                    if tp_hit:
                        pnl = _calc_pnl(order_type, order_open_price, tp, lot, sig.symbol, symbol_specs)
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


def _contract_size(symbol: str, symbol_specs: dict | None = None) -> float:
    """Returns MT5 contract size for a symbol. User override wins if provided."""
    if symbol_specs:
        cs = symbol_specs.get(symbol) or symbol_specs.get(symbol.upper())
        if cs:
            return float(cs)
    s = symbol.upper()
    if any(k in s for k in ("BTC", "ETH", "LTC", "XRP", "SOL", "ADA", "BNB")):
        return 1.0
    if "XAU" in s:
        return 100.0
    if "XAG" in s:
        return 5_000.0
    if "XPD" in s or "XPT" in s:
        return 100.0
    return 100_000.0


def _calc_pnl(order_type: str, open_price: float, close_price: float, lot: float,
              symbol: str = "", symbol_specs: dict | None = None) -> float:
    diff = (close_price - open_price) if order_type == "BUY" else (open_price - close_price)
    return diff * lot * _contract_size(symbol, symbol_specs)


# ── AI strategy simulation (real agent, mock MT5 trader) ──────────────────────

class SimulatePretradeBody(BaseModel):
    signals: list[dict]                 # extracted signals (from simulate-signal)
    message: str = ""                   # original signal message
    management_strategy: str | None = None
    deletion_strategy: str | None = None
    sizing_strategy: str | None = None
    extraction_instructions: str | None = None
    event_type: str = "pretrade"        # "pretrade" | "message_deleted" | "price_level_reached"
    event_data: dict | None = None
    mock_state: dict = {}


class MockMT5Trader:
    """
    Drop-in replacement for MT5Trader used inside simulate_pretrade_endpoint.

    READ methods return data derived from mock_state.
    WRITE methods record the action in actions_log and return a simulated-ok dict,
    so the real StrategyExecutor._dispatch() logic (including calculate_lot_for_risk)
    runs unchanged while no real MT5 order is ever sent.
    """

    _PRICE_DEFAULTS: dict[str, dict] = {
        "XAUUSD": {"bid": 2340.00, "ask": 2340.50, "spread_pips": 0.5,  "last": 2340.25},
        "XAGUSD": {"bid":   29.50, "ask":   29.51,  "spread_pips": 0.1,  "last":   29.50},
        "EURUSD": {"bid":   1.085, "ask":   1.0851, "spread_pips": 0.1,  "last":   1.085},
        "GBPUSD": {"bid":  1.2650, "ask":   1.2651, "spread_pips": 0.1,  "last":  1.2650},
        "USDJPY": {"bid": 149.50,  "ask":  149.51,  "spread_pips": 0.1,  "last": 149.50},
        "BTCUSD": {"bid": 65000.0, "ask": 65010.0,  "spread_pips": 10.0, "last": 65005.0},
        "ETHUSD": {"bid":  3500.0, "ask":  3502.0,  "spread_pips": 2.0,  "last":  3501.0},
    }

    _SPEC_DEFAULTS: dict[str, dict] = {
        "XAU": {"pip_value_per_lot": 10.0,  "contract_size":  100, "digits": 2,
                "volume_min": 0.01, "volume_max":  50.0, "volume_step": 0.01, "currency_profit": "USD"},
        "XAG": {"pip_value_per_lot": 50.0,  "contract_size": 5000, "digits": 3,
                "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "currency_profit": "USD"},
        "BTC": {"pip_value_per_lot":  1.0,  "contract_size":    1, "digits": 2,
                "volume_min": 0.01, "volume_max":  10.0, "volume_step": 0.01, "currency_profit": "USD"},
        "ETH": {"pip_value_per_lot":  1.0,  "contract_size":    1, "digits": 2,
                "volume_min": 0.01, "volume_max":  50.0, "volume_step": 0.01, "currency_profit": "USD"},
    }
    _SPEC_FOREX = {"pip_value_per_lot": 10.0, "contract_size": 100_000, "digits": 5,
                   "volume_min": 0.01, "volume_max": 100.0, "volume_step": 0.01, "currency_profit": "USD"}

    def __init__(self, mock_state: dict, actions_log: list[dict]) -> None:
        self._ms      = mock_state
        self._actions = actions_log
        self._balance     = float(mock_state.get("balance",     10_000))
        self._equity      = float(mock_state.get("equity",      self._balance))
        self._free_margin = float(mock_state.get("free_margin", self._equity))
        self._currency    = str(mock_state.get("currency",  "USD"))
        self._leverage    = int(mock_state.get("leverage",   100))
        self._open_pos    = list(mock_state.get("open_positions",  []))
        self._pending_ord = list(mock_state.get("pending_orders",  []))
        self._daily_pnl   = float(mock_state.get("daily_pnl",   0))
        self._weekly_pnl  = float(mock_state.get("weekly_pnl",  0))
        self._monthly_pnl = float(mock_state.get("monthly_pnl", 0))
        self._prices      = dict(mock_state.get("prices", {}))

    def _rec(self, tool: str, **kwargs) -> dict:
        entry = {"tool": tool, **{k: v for k, v in kwargs.items() if v is not None}}
        self._actions.append(entry)
        return {"ok": True, "simulated": True}

    # ── READ methods ──────────────────────────────────────────────────────────

    async def get_full_account_info(self, user_id, login, password, server):
        return {
            "balance":         self._balance,
            "equity":          self._equity,
            "margin":          self._balance - self._free_margin,
            "free_margin":     self._free_margin,
            "profit_floating": self._equity - self._balance,
            "leverage":        self._leverage,
            "currency":        self._currency,
            "login":           login or 0,
            "server":          self._ms.get("server", "SimBroker-Demo"),
        }

    async def get_pnl_for_period(self, user_id, login, password, server, from_, to):
        from datetime import datetime, timezone
        now   = datetime.now(timezone.utc)
        delta = now - from_
        if delta.total_seconds() <= 86_400:
            return self._daily_pnl
        if delta.total_seconds() <= 7 * 86_400:
            return self._weekly_pnl
        return self._monthly_pnl

    async def get_symbol_tick(self, user_id, login, password, server, symbol: str):
        sym = symbol.upper()
        if sym in self._prices:
            p = self._prices[sym]
            bid = float(p.get("bid", 0))
            ask = float(p.get("ask", bid))
            spread = float(p.get("spread_pips", abs(ask - bid) * 10))
            return {"bid": bid, "ask": ask, "spread_pips": spread, "last": bid}
        default = self._PRICE_DEFAULTS.get(sym)
        if default:
            return dict(default)
        return {"bid": 1.0, "ask": 1.0001, "spread_pips": 0.1, "last": 1.0}

    async def get_symbol_specs(self, user_id, login, password, server, symbol: str):
        sym = symbol.upper()
        for prefix, specs in self._SPEC_DEFAULTS.items():
            if prefix in sym:
                return dict(specs)
        return dict(self._SPEC_FOREX)

    async def get_positions(self, user_id, login, password, server, symbol=None):
        if symbol:
            return [p for p in self._open_pos if str(p.get("symbol", "")).upper() == symbol.upper()]
        return list(self._open_pos)

    async def get_pending_orders_list(self, user_id, login, password, server, symbol=None):
        if symbol:
            return [o for o in self._pending_ord if str(o.get("symbol", "")).upper() == symbol.upper()]
        return list(self._pending_ord)

    async def get_closed_deals(self, user_id, login, password, server, days=1, symbol=None):
        return []

    # ── WRITE methods (record action, return simulated-ok) ────────────────────

    async def modify_position(self, user_id, login, password, server, ticket, new_sl=None, new_tp=None):
        return self._rec("modify_position", ticket=ticket, new_sl=new_sl, new_tp=new_tp)

    async def set_breakeven(self, user_id, login, password, server, ticket, offset_pips=0.0):
        return self._rec("set_breakeven", ticket=ticket, offset_pips=offset_pips)

    async def close_position_by_ticket(self, user_id, login, password, server, ticket, lots=None):
        return self._rec("close_position", ticket=ticket, lots=lots)

    async def cancel_order_by_ticket(self, user_id, login, password, server, ticket):
        return self._rec("cancel_order", ticket=ticket)

    async def modify_order_by_ticket(self, user_id, login, password, server, ticket,
                                     new_price=None, new_sl=None, new_tp=None):
        return self._rec("modify_order", ticket=ticket, new_price=new_price, new_sl=new_sl, new_tp=new_tp)

    async def open_new_market_order(self, user_id, login, password, server,
                                    symbol, order_type, lots, sl=None, tp=None):
        return self._rec("open_market_order", symbol=symbol, order_type=order_type, lots=lots, sl=sl, tp=tp)

    async def place_new_pending_order(self, user_id, login, password, server,
                                      symbol, order_type, price, lots, sl=None, tp=None):
        return self._rec("place_pending_order", symbol=symbol, order_type=order_type,
                         price=price, lots=lots, sl=sl, tp=tp)


# ── Stateful simulation helpers ───────────────────────────────────────────────

class _SimState:
    """Mutable account state for the full stateful walk-forward simulation."""

    def __init__(self, mock_state: dict) -> None:
        self.balance      = float(mock_state.get("balance",     10_000))
        self.equity       = float(mock_state.get("equity",      self.balance))
        self.free_margin  = float(mock_state.get("free_margin", self.equity))
        self.leverage     = int(mock_state.get("leverage",   100))
        self.currency     = str(mock_state.get("currency",  "USD"))
        self._daily_pnl   = float(mock_state.get("daily_pnl",   0))
        self._weekly_pnl  = float(mock_state.get("weekly_pnl",  0))
        self._monthly_pnl = float(mock_state.get("monthly_pnl", 0))
        self.open_positions: list[dict] = list(mock_state.get("open_positions",  []))
        self.pending_orders: list[dict] = list(mock_state.get("pending_orders",  []))
        self.prices: dict[str, dict]    = dict(mock_state.get("prices", {}))
        self._next_ticket               = 1000

    def alloc_ticket(self) -> int:
        t = self._next_ticket
        self._next_ticket += 1
        return t

    def add_position(self, ticket: int, symbol: str, order_type: str, lots: float,
                     open_price: float, sl: float | None, tp: float | None) -> None:
        self.open_positions.append({
            "ticket": ticket, "symbol": symbol, "order_type": order_type,
            "lots": lots, "open_price": open_price, "sl": sl, "tp": tp, "profit": 0,
        })

    def get_position(self, ticket: int) -> dict | None:
        for p in self.open_positions:
            if p.get("ticket") == ticket:
                return p
        return None

    def remove_position(self, ticket: int) -> dict | None:
        for i, p in enumerate(self.open_positions):
            if p.get("ticket") == ticket:
                return self.open_positions.pop(i)
        return None

    def remove_pending_order(self, ticket: int) -> dict | None:
        for i, o in enumerate(self.pending_orders):
            if o.get("ticket") == ticket:
                return self.pending_orders.pop(i)
        return None

    def update_price(self, symbol: str, price: float) -> None:
        sym = symbol.upper()
        entry = self.prices.setdefault(sym, {})
        entry.update({"bid": price, "ask": price, "last": price})

    def apply_write(self, tool: str, kwargs: dict) -> None:
        if tool == "open_market_order":
            sym = str(kwargs.get("symbol", "")).upper()
            current_price = self.prices.get(sym, {}).get("bid", 0.0)
            ticket = self.alloc_ticket()
            self.add_position(
                ticket=ticket,
                symbol=kwargs.get("symbol", ""),
                order_type=kwargs.get("order_type", "BUY"),
                lots=float(kwargs.get("lots", 0.01)),
                open_price=current_price,
                sl=kwargs.get("sl"),
                tp=kwargs.get("tp"),
            )
        elif tool == "place_pending_order":
            ticket = self.alloc_ticket()
            self.pending_orders.append({
                "ticket": ticket,
                "symbol": kwargs.get("symbol", ""),
                "order_type": kwargs.get("order_type", "BUY_LIMIT"),
                "lots": float(kwargs.get("lots", 0.01)),
                "price": float(kwargs.get("price", 0)),
                "sl": kwargs.get("sl"),
                "tp": kwargs.get("tp"),
            })
        elif tool == "close_position":
            self.remove_position(int(kwargs.get("ticket", 0)))
        elif tool == "cancel_order":
            self.remove_pending_order(int(kwargs.get("ticket", 0)))
        elif tool == "modify_position":
            pos = self.get_position(int(kwargs.get("ticket", 0)))
            if pos:
                if kwargs.get("new_sl") is not None:
                    pos["sl"] = kwargs["new_sl"]
                if kwargs.get("new_tp") is not None:
                    pos["tp"] = kwargs["new_tp"]
        elif tool == "set_breakeven":
            pos = self.get_position(int(kwargs.get("ticket", 0)))
            if pos:
                offset = float(kwargs.get("offset_pips", 0)) * 0.0001
                pos["sl"] = float(pos.get("open_price", 0)) + offset


class StatefulMockMT5Trader(MockMT5Trader):
    """Like MockMT5Trader but backed by _SimState — mutates state on every write call."""

    def __init__(self, state: _SimState, actions_log: list[dict]) -> None:
        self._state       = state
        self._actions     = actions_log
        # Point mutable fields at the exact same objects in state (shared by reference)
        self._open_pos    = state.open_positions
        self._pending_ord = state.pending_orders
        self._prices      = state.prices
        # Scalar fields — copy current values
        self._balance     = state.balance
        self._equity      = state.equity
        self._free_margin = state.free_margin
        self._currency    = state.currency
        self._leverage    = state.leverage
        self._daily_pnl   = state._daily_pnl
        self._weekly_pnl  = state._weekly_pnl
        self._monthly_pnl = state._monthly_pnl
        self._ms          = {}  # unused; satisfies parent references

    def _rec(self, tool: str, **kwargs) -> dict:
        self._state.apply_write(tool, kwargs)
        entry = {"tool": tool, **{k: v for k, v in kwargs.items() if v is not None}}
        self._actions.append(entry)
        return {"ok": True, "simulated": True}


async def _fire_ai_event(
    mock_exec,
    sp,
    state: _SimState,
    event_type: str,
    event_data: dict,
    management_strategy: str,
    deletion_strategy: str,
) -> dict:
    """
    Fire a single AI event against the current _SimState.
    StatefulMockMT5Trader mutates `state` when the AI issues write calls.
    Returns {tool_calls, actions, final_response}.
    """
    import json
    from google.genai import types as _types
    from vps.services.strategy_executor import (
        _ExecCtx, PreTradeDecision,
        _build_system_prompt, _format_event_prompt, _make_tools, _compact, _PRO_MODEL,
    )

    strategy = deletion_strategy if event_type == "message_deleted" else management_strategy
    if not strategy:
        return {"tool_calls": [], "actions": [], "final_response": ""}

    actions_log: list[dict] = []
    trader  = StatefulMockMT5Trader(state, actions_log)
    ctx     = _ExecCtx(trader, "sim", 0, "", "sim")
    decisions: dict[int, PreTradeDecision] = {}

    event_prompt = _format_event_prompt(event_type, event_data)
    open_pos = state.open_positions
    if open_pos:
        pos_parts = [
            f"#{p.get('ticket','?')} {p.get('order_type')} {p.get('symbol')}"
            f" lots={p.get('lots')} profit={p.get('profit', 0)}"
            for p in open_pos
        ]
        event_prompt += (
            "\n\nPre-fetched context:\n"
            f"  open_positions ({len(open_pos)}): " + " | ".join(pos_parts)
        )

    system_prompt = _build_system_prompt(strategy)
    tools  = _make_tools(event_type)
    config = _types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=tools,  # type: ignore[arg-type]
    )
    chat = sp._client.aio.chats.create(model=_PRO_MODEL, config=config)

    try:
        response = await chat.send_message(event_prompt)
    except Exception as exc:
        logger.warning("_fire_ai_event (%s): %s", event_type, exc)
        return {"tool_calls": [], "actions": [], "final_response": f"Error: {exc}"}

    tool_calls_log: list[dict] = []
    final_text = ""

    for _ in range(8):
        fn_calls = response.function_calls or []
        if not fn_calls:
            final_text = (response.text or "").strip()
            break
        fn_parts = []
        for fc in fn_calls:
            name = fc.name
            args = dict(fc.args)
            result_data = await mock_exec._dispatch(name, args, ctx, decisions)
            tool_calls_log.append({"name": name, "args": args, "result": result_data})
            fn_parts.append(_types.Part.from_function_response(
                name=name,
                response={"result": json.dumps(_compact(result_data), separators=(",", ":"), default=str)},
            ))
        try:
            response = await chat.send_message(fn_parts)
        except Exception:
            break

    return {"tool_calls": tool_calls_log, "actions": actions_log, "final_response": final_text}


async def _sim_full(
    signals: list[dict],
    price_path: list[dict],
    timeline_events: list[dict],
    default_lot: float,
    management_strategy: str | None,
    deletion_strategy: str | None,
    mock_state: dict,
    symbol_specs: dict | None,
    sp,
    mock_exec,
) -> dict:
    """
    Stateful walk-forward simulation.

    Unlike _sim_price_events (pure price path), this keeps a _SimState that
    evolves as positions are opened and closed.  AI events (price_level_reached,
    message_deleted) fire against the live state so the AI sees the open
    positions that actually exist at that moment.
    """
    state      = _SimState(mock_state)
    per_signal = []
    total_pnl  = 0.0
    n          = len(price_path)

    mgmt = (management_strategy or "").strip()
    delt = (deletion_strategy   or "").strip()

    for sig_idx, sig_dict in enumerate(signals):
        symbol      = str(sig_dict.get("symbol", ""))
        order_type  = str(sig_dict.get("order_type", "BUY"))
        entry_raw   = sig_dict.get("entry_price")
        sl          = sig_dict.get("stop_loss")
        tp          = sig_dict.get("take_profit")
        lot         = float(sig_dict.get("lot_size") or default_lot)
        prices_list: list[float] = sig_dict.get("prices") or []

        if isinstance(entry_raw, list) and len(entry_raw) == 2:
            actual_entry: float | None = (float(entry_raw[0]) + float(entry_raw[1])) / 2.0
        elif entry_raw is not None:
            actual_entry = float(entry_raw)
        else:
            actual_entry = None

        trade_state     = "market_pending" if actual_entry is None else "pending"
        order_open_price: float | None = None
        position_ticket: int   | None  = None
        sig_events: list[dict]         = []

        for i, pt in enumerate(price_path):
            t_norm = float(pt.get("t", i / max(n - 1, 1)))
            price  = float(pt.get("price", 0))

            if trade_state in ("closed", "deleted"):
                break

            state.update_price(symbol, price)

            # ── Timeline events (signal deleted) ─────────────────────────────
            for te in timeline_events:
                if abs(float(te.get("t", -1)) - t_norm) < (1.5 / max(n, 1)):
                    if te.get("type") == "signal_deleted":
                        ev_data = {"symbol": symbol, "order_type": order_type,
                                   "entry": actual_entry, "sl": sl, "tp": tp}
                        ai_result = await _fire_ai_event(
                            mock_exec, sp, state, "message_deleted", ev_data, mgmt, delt,
                        )
                        desc = "Signal deleted"
                        if delt:
                            preview = delt[:60] + ("…" if len(delt) > 60 else "")
                            desc += f' — AI action: "{preview}"'
                        ev: dict = {"t": t_norm, "type": "signal_deleted",
                                    "price": price, "description": desc}
                        if ai_result["actions"] or ai_result["tool_calls"]:
                            ev["ai_result"] = ai_result
                        sig_events.append(ev)
                        # If AI closed the position during deletion, record P&L
                        if (position_ticket and trade_state == "open"
                                and state.get_position(position_ticket) is None
                                and order_open_price is not None):
                            pnl = _calc_pnl(order_type, order_open_price, price, lot, symbol, symbol_specs)
                            total_pnl += pnl
                            state.balance    += pnl
                            state.equity      = state.balance
                            state.free_margin = state.balance
                            sig_events.append({"t": t_norm, "type": "close", "price": price,
                                               "pnl": round(pnl, 2),
                                               "description": f"Position closed by AI @ {price:.5f}  ({pnl:+.2f})"})
                        trade_state = "deleted"
                        break

            if trade_state in ("closed", "deleted"):
                break

            # ── Entry ────────────────────────────────────────────────────────
            if trade_state == "market_pending":
                order_open_price = price
                position_ticket  = state.alloc_ticket()
                state.add_position(position_ticket, symbol, order_type, lot,
                                   order_open_price, sl, tp)
                trade_state = "open"
                sig_events.append({"t": t_norm, "type": "entry", "price": price,
                                   "description": f"Market {order_type} opened @ {price:.5f}"})

            elif trade_state == "pending" and actual_entry is not None:
                prev_price = float(price_path[i - 1].get("price", 0)) if i > 0 else None
                hit = (prev_price is not None
                       and (prev_price - actual_entry) * (price - actual_entry) <= 0)
                if hit:
                    order_open_price = actual_entry
                    position_ticket  = state.alloc_ticket()
                    state.add_position(position_ticket, symbol, order_type, lot,
                                       order_open_price, sl, tp)
                    trade_state = "open"
                    sig_events.append({"t": t_norm, "type": "entry", "price": actual_entry,
                                       "description": f"Limit {order_type} triggered @ {actual_entry:.5f}"})
                else:
                    # Pre-entry invalidation: SL or TP reached before entry
                    if sl is not None and (
                        (order_type == "BUY"  and price <= sl) or
                        (order_type == "SELL" and price >= sl)
                    ):
                        sig_events.append({"t": t_norm, "type": "expired", "price": sl,
                                           "description": f"Signal expired — SL {sl:.5f} hit before entry"})
                        trade_state = "expired"
                        break
                    if tp is not None and (
                        (order_type == "BUY"  and price >= tp) or
                        (order_type == "SELL" and price <= tp)
                    ):
                        sig_events.append({"t": t_norm, "type": "expired", "price": tp,
                                           "description": f"Signal expired — TP {tp:.5f} hit before entry"})
                        trade_state = "expired"
                        break

            if trade_state != "open" or order_open_price is None:
                continue

            # ── Read live SL/TP from state (AI may have modified them) ───────
            pos     = state.get_position(position_ticket) if position_ticket else None
            live_sl = pos["sl"] if pos else sl
            live_tp = pos["tp"] if pos else tp

            # SL check
            if live_sl is not None:
                sl_hit = ((order_type == "BUY"  and price <= live_sl) or
                          (order_type == "SELL" and price >= live_sl))
                if sl_hit:
                    pnl = _calc_pnl(order_type, order_open_price, live_sl, lot, symbol, symbol_specs)
                    total_pnl += pnl
                    state.remove_position(position_ticket)
                    state.balance    += pnl
                    state.equity      = state.balance
                    state.free_margin = state.balance
                    sig_events.append({"t": t_norm, "type": "sl", "price": live_sl,
                                       "pnl": round(pnl, 2),
                                       "description": f"Stop Loss @ {live_sl:.5f}  ({pnl:+.2f})"})
                    trade_state = "closed"
                    break

            # TP check
            if live_tp is not None:
                tp_hit = ((order_type == "BUY"  and price >= live_tp) or
                          (order_type == "SELL" and price <= live_tp))
                if tp_hit:
                    pnl = _calc_pnl(order_type, order_open_price, live_tp, lot, symbol, symbol_specs)
                    total_pnl += pnl
                    state.remove_position(position_ticket)
                    state.balance    += pnl
                    state.equity      = state.balance
                    state.free_margin = state.balance
                    sig_events.append({"t": t_norm, "type": "tp", "price": live_tp,
                                       "pnl": round(pnl, 2),
                                       "description": f"Take Profit @ {live_tp:.5f}  ({pnl:+.2f})"})
                    trade_state = "closed"
                    break

            # Price-level events → fire management AI with live state
            for pl in prices_list:
                already = any(e["type"] == "price_level" and e.get("trigger_price") == pl
                              for e in sig_events)
                if not already:
                    pl_hit = ((order_type == "BUY"  and price >= pl) or
                              (order_type == "SELL" and price <= pl))
                    if pl_hit:
                        ev_data = {"symbol": symbol, "order_type": order_type,
                                   "price": price, "trigger_price": pl}
                        ai_result = await _fire_ai_event(
                            mock_exec, sp, state, "price_level_reached", ev_data, mgmt, delt,
                        )
                        ev = {"t": t_norm, "type": "price_level", "price": pl,
                              "trigger_price": pl,
                              "description": f"Strategy price level reached @ {pl:.5f}"}
                        if ai_result["actions"] or ai_result["tool_calls"]:
                            ev["ai_result"] = ai_result
                        sig_events.append(ev)

            # Position closed by AI — calculate P&L at current price
            if position_ticket and state.get_position(position_ticket) is None:
                pnl = _calc_pnl(order_type, order_open_price, price, lot, symbol, symbol_specs)
                total_pnl += pnl
                state.balance     += pnl
                state.equity       = state.balance
                state.free_margin  = state.balance
                sig_events.append({"t": t_norm, "type": "close", "price": price,
                                   "pnl": round(pnl, 2),
                                   "description": f"Position closed by AI @ {price:.5f}  ({pnl:+.2f})"})
                trade_state = "closed"
                break

        per_signal.append({
            "signal_index": sig_idx,
            "symbol":       symbol,
            "order_type":   order_type,
            "entry":        actual_entry,
            "sl":           sl,
            "tp":           tp,
            "prices":       prices_list,
            "events":       sig_events,
            "state":        trade_state,
        })

    return {"per_signal": per_signal, "total_pnl": round(total_pnl, 2)}


# ── Full pipeline simulation endpoint ─────────────────────────────────────────

class SimulateFullBody(BaseModel):
    message: str
    sizing_strategy: str | None = None
    extraction_instructions: str | None = None
    management_strategy: str | None = None
    deletion_strategy: str | None = None
    price_path: list[dict]
    timeline_events: list[dict] = []
    lot_size: float = 0.1
    symbol_specs: dict[str, float] | None = None
    mock_state: dict = {}


@router.post("/simulate-full")
async def simulate_full_endpoint(
    body: SimulateFullBody,
    request: Request,
):
    """
    Full stateful pipeline:
      1. Extract signals from message
      2. Run pretrade AI (if any strategy configured) — uses MockMT5Trader
      3. Apply pretrade decisions (modify lots/SL/TP, skip rejected)
      4. Walk-forward with _sim_full — fires AI events against live _SimState
    Returns {is_signal, extracted, pretrade, simulation}.
    """
    import json
    from google.genai import types as _types
    from vps.services.signal_processor import SignalProcessor
    from vps.services.strategy_executor import (
        StrategyExecutor, _ExecCtx, PreTradeDecision,
        _build_system_prompt, _make_tools, _compact, _PRO_MODEL,
    )

    sp: SignalProcessor | None = request.app.state.signal_processor
    if sp is None:
        raise HTTPException(503, detail="Signal processor not available (GEMINI_API_KEY missing)")

    try:
        is_signal = await sp.detect_signal(body.message)
        if not is_signal:
            return {"is_signal": False, "extracted": [], "pretrade": None, "simulation": None}

        signals, _, _ = await sp.extract_signals(
            body.message,
            sizing_strategy=body.sizing_strategy,
            extraction_instructions=body.extraction_instructions,
            management_strategy=body.management_strategy,
        )
    except Exception as exc:
        logger.error("simulate_full_endpoint extract: %s", exc)
        raise HTTPException(500, detail=str(exc))

    from dataclasses import asdict
    extracted = [asdict(s) for s in signals]

    if not extracted:
        return {"is_signal": True, "extracted": [], "pretrade": None, "simulation": None}

    mock_exec = StrategyExecutor.__new__(StrategyExecutor)
    mock_exec._closed_trade_store = None

    # Inject first chart price for every signal symbol so get_symbol_tick
    # returns the price the chart starts at (not a stale mock default).
    effective_mock_state = dict(body.mock_state)
    if body.price_path:
        first_price = float(body.price_path[0].get("price", 0))
        prices_override = dict(body.mock_state.get("prices", {}))
        for sig in extracted:
            sym = str(sig.get("symbol", "")).upper()
            if sym:
                prices_override[sym] = {
                    "bid":   first_price,
                    "ask":   first_price,
                    "last":  first_price,
                    "spread_pips": 0,
                }
        effective_mock_state["prices"] = prices_override

    has_strategy = bool((body.management_strategy or "").strip() or
                        (body.sizing_strategy or "").strip())

    # ── Pretrade AI ───────────────────────────────────────────────────────────
    pretrade: dict | None  = None
    signals_for_sim        = extracted

    if has_strategy:
        try:
            pt_actions: list[dict] = []
            pt_trader = MockMT5Trader(effective_mock_state, pt_actions)
            ctx       = _ExecCtx(pt_trader, "sim", 0, "", "sim")
            decisions: dict[int, PreTradeDecision] = {}

            ms       = effective_mock_state
            balance  = float(ms.get("balance",     10_000))
            equity   = float(ms.get("equity",      balance))
            free_m   = float(ms.get("free_margin", equity))
            currency = str(ms.get("currency", "USD"))
            leverage = int(ms.get("leverage", 100))
            open_pos = list(ms.get("open_positions", []))

            sigs_text = "\n".join(
                f"  [{i}] {s.get('order_type')} {s.get('symbol')}"
                f" entry={s.get('entry_price')} SL={s.get('stop_loss')} TP={s.get('take_profit')}"
                f" lots={s.get('lot_size')} mode={s.get('order_mode')}"
                for i, s in enumerate(extracted)
            )
            event_prompt = (
                "EVENT: New trading signals received. You must evaluate ALL of them.\n\n"
                f"Source message:\n{body.message}\n\n"
                f"Signals to evaluate:\n{sigs_text}\n\n"
                "For each signal call approve_signal, reject_signal or modify_signal.\n"
                "If you call no tool for a signal, it will be approved by default.\n"
                "Use read tools if your strategy requires it.\n\n"
                "Pre-fetched context (do not re-query these):\n"
                f"  account: balance={balance} equity={equity} free_margin={free_m}"
                f" currency={currency} leverage={leverage}\n"
                f"  open_positions_count: {len(open_pos)}"
            )

            strategy     = (body.management_strategy or "").strip()
            sizing       = (body.sizing_strategy or "").strip()
            system_prompt = _build_system_prompt(strategy or "No management strategy configured.")
            if sizing:
                system_prompt = (
                    "SIZING STRATEGY (use this to determine lot sizes — call "
                    "calculate_lot_for_risk or calculate_lot_for_risk_percent as needed):\n"
                    f"{sizing}\n\n"
                ) + system_prompt

            tools  = _make_tools("pretrade")
            config = _types.GenerateContentConfig(
                system_instruction=system_prompt,
                tools=tools,  # type: ignore[arg-type]
            )
            chat     = sp._client.aio.chats.create(model=_PRO_MODEL, config=config)
            response = await chat.send_message(event_prompt)

            tool_calls_log: list[dict] = []
            final_text = ""
            for _ in range(8):
                fn_calls = response.function_calls or []
                if not fn_calls:
                    final_text = (response.text or "").strip()
                    break
                fn_parts = []
                for fc in fn_calls:
                    name = fc.name
                    args = dict(fc.args)
                    result_data = await mock_exec._dispatch(name, args, ctx, decisions)
                    tool_calls_log.append({"name": name, "args": args, "result": result_data})
                    fn_parts.append(_types.Part.from_function_response(
                        name=name,
                        response={"result": json.dumps(_compact(result_data),
                                                       separators=(",", ":"), default=str)},
                    ))
                try:
                    response = await chat.send_message(fn_parts)
                except Exception:
                    break

            all_decisions = []
            for i in range(len(extracted)):
                d = decisions.get(i)
                if d is None:
                    all_decisions.append({"signal_index": i, "approved": True,
                                          "modified_lots": None, "modified_sl": None,
                                          "modified_tp": None,
                                          "reason": "Not mentioned — approved by default"})
                else:
                    all_decisions.append({
                        "signal_index":  d.signal_index, "approved": d.approved,
                        "modified_lots": d.modified_lots, "modified_sl": d.modified_sl,
                        "modified_tp":   d.modified_tp,  "reason": d.reason,
                    })

            pretrade = {
                "event_type":     "pretrade",
                "decisions":      all_decisions,
                "tool_calls":     tool_calls_log,
                "actions":        pt_actions,
                "final_response": final_text,
            }

            # Apply decisions: filter rejected, apply modified lots/sl/tp
            approved_sigs = []
            for i, sig in enumerate(extracted):
                d = all_decisions[i] if i < len(all_decisions) else None
                if d and not d["approved"]:
                    continue
                sig_copy = dict(sig)
                if d:
                    if d.get("modified_lots"): sig_copy["lot_size"]    = d["modified_lots"]
                    if d.get("modified_sl"):   sig_copy["stop_loss"]   = d["modified_sl"]
                    if d.get("modified_tp"):   sig_copy["take_profit"] = d["modified_tp"]
                approved_sigs.append(sig_copy)
            signals_for_sim = approved_sigs  # may be empty if all rejected

        except Exception as exc:
            logger.warning("simulate_full_endpoint: pretrade AI failed: %s", exc)

    # ── Stateful walk-forward simulation ──────────────────────────────────────
    simulation: dict | None = None
    if body.price_path and len(body.price_path) >= 2:
        try:
            simulation = await _sim_full(
                signals_for_sim,
                body.price_path,
                body.timeline_events,
                body.lot_size,
                body.management_strategy,
                body.deletion_strategy,
                effective_mock_state,
                body.symbol_specs,
                sp,
                mock_exec,
            )
        except Exception as exc:
            logger.warning("simulate_full_endpoint: _sim_full failed: %s", exc)

    return {
        "is_signal":  True,
        "extracted":  extracted,
        "pretrade":   pretrade,
        "simulation": simulation,
    }


@router.post("/simulate-pretrade")
async def simulate_pretrade_endpoint(
    body: SimulatePretradeBody,
    request: Request,
):
    """
    Simula pre_trade / on_event usando il vero StrategyExecutor._dispatch() con un
    MockMT5Trader al posto del vero MT5Trader.  I tool di lettura restituiscono i
    dati di mock_state; i tool di scrittura registrano l'azione senza aprire MT5.
    Il calcolo dei lot (calculate_lot_for_risk / _percent) usa la stessa logica
    esatta della produzione, alimentata dai dati del conto mock.
    """
    import json
    from google.genai import types as _types
    from vps.services.signal_processor import SignalProcessor
    from vps.services.strategy_executor import (
        StrategyExecutor, _ExecCtx, PreTradeDecision,
        _build_system_prompt, _format_event_prompt, _make_tools, _compact, _PRO_MODEL,
    )

    sp: SignalProcessor | None = request.app.state.signal_processor
    if sp is None:
        raise HTTPException(503, detail="Signal processor not available (GEMINI_API_KEY missing)")

    strategy = (body.management_strategy or "").strip()
    if body.event_type == "message_deleted":
        strategy = (body.deletion_strategy or "").strip()
    sizing = (body.sizing_strategy or "").strip()

    if not strategy and not sizing:
        return {
            "event_type": body.event_type, "decisions": [],
            "tool_calls": [], "actions": [], "final_response": "No strategy configured.",
        }

    # ── Build mock infrastructure ─────────────────────────────────────────────
    actions_log: list[dict] = []
    mock_trader = MockMT5Trader(body.mock_state, actions_log)

    # Minimal StrategyExecutor shell — reuses the Gemini client from SignalProcessor
    mock_exec = StrategyExecutor.__new__(StrategyExecutor)
    mock_exec._closed_trade_store = None

    ctx = _ExecCtx(mock_trader, "sim", 0, "", "sim")
    decisions: dict[int, PreTradeDecision] = {}

    # ── Build event prompt (mirrors production pre_trade / on_event) ──────────
    ms       = body.mock_state
    balance  = float(ms.get("balance",     10_000))
    equity   = float(ms.get("equity",      balance))
    free_m   = float(ms.get("free_margin", equity))
    currency = str(ms.get("currency", "USD"))
    leverage = int(ms.get("leverage", 100))
    open_pos = list(ms.get("open_positions", []))

    if body.event_type == "pretrade":
        sigs_text = "\n".join(
            f"  [{i}] {s.get('order_type')} {s.get('symbol')}"
            f" entry={s.get('entry_price')} SL={s.get('stop_loss')} TP={s.get('take_profit')}"
            f" lots={s.get('lot_size')} mode={s.get('order_mode')}"
            for i, s in enumerate(body.signals)
        )
        event_prompt = (
            "EVENT: New trading signals received. You must evaluate ALL of them.\n\n"
            f"Source message:\n{body.message}\n\n"
            f"Signals to evaluate:\n{sigs_text}\n\n"
            "For each signal call approve_signal, reject_signal or modify_signal.\n"
            "If you call no tool for a signal, it will be approved by default.\n"
            "Use read tools (get_account_info, get_daily_pnl, etc.) if your strategy requires it.\n\n"
            "Pre-fetched context (do not re-query these):\n"
            f"  account: balance={balance} equity={equity} free_margin={free_m}"
            f" currency={currency} leverage={leverage}\n"
            f"  open_positions_count: {len(open_pos)}"
        )
    else:
        event_prompt = _format_event_prompt(body.event_type, body.event_data or {})
        if open_pos:
            pos_parts = [
                f"#{p.get('ticket','?')} {p.get('order_type')} {p.get('symbol')}"
                f" lots={p.get('lots')} profit={p.get('profit', 0)}"
                for p in open_pos
            ]
            event_prompt += (
                "\n\nPre-fetched context:\n"
                f"  open_positions ({len(open_pos)}): " + " | ".join(pos_parts)
            )

    # ── System prompt (sizing strategy prepended for pretrade) ────────────────
    system_prompt = _build_system_prompt(strategy or "No management strategy configured.")
    if sizing and body.event_type == "pretrade":
        system_prompt = (
            "SIZING STRATEGY (use this to determine lot sizes — call "
            "calculate_lot_for_risk or calculate_lot_for_risk_percent as needed):\n"
            f"{sizing}\n\n"
        ) + system_prompt

    # ── Gemini agent loop — real _dispatch(), mock trader ────────────────────
    tools  = _make_tools(body.event_type)
    config = _types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=tools,  # type: ignore[arg-type]
    )
    chat = sp._client.aio.chats.create(model=_PRO_MODEL, config=config)

    try:
        response = await chat.send_message(event_prompt)
    except Exception as exc:
        logger.error("simulate_pretrade_endpoint: initial send: %s", exc)
        raise HTTPException(500, detail=str(exc))

    tool_calls_log: list[dict] = []
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
            result_data = await mock_exec._dispatch(name, args, ctx, decisions)
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
            logger.error("simulate_pretrade_endpoint: mid-loop: %s", exc)
            break

    # ── Build final decisions list (pretrade only) ────────────────────────────
    if body.event_type == "pretrade":
        all_decisions = []
        for i in range(len(body.signals)):
            d = decisions.get(i)
            if d is None:
                all_decisions.append({"signal_index": i, "approved": True,
                                      "modified_lots": None, "modified_sl": None,
                                      "modified_tp": None,
                                      "reason": "Not mentioned — approved by default"})
            else:
                all_decisions.append({
                    "signal_index":  d.signal_index,
                    "approved":      d.approved,
                    "modified_lots": d.modified_lots,
                    "modified_sl":   d.modified_sl,
                    "modified_tp":   d.modified_tp,
                    "reason":        d.reason,
                })
    else:
        all_decisions = []

    return {
        "event_type":     body.event_type,
        "decisions":      all_decisions,
        "tool_calls":     tool_calls_log,
        "actions":        actions_log,
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


# ── Nova Chat endpoint ────────────────────────────────────────────────────────

class NovaChatBody(BaseModel):
    step: str                            # "tg_help" | "mt5_help" | "ai_rules" | "sim_analysis"
    history: list[dict] | None = None   # [{role: "user"|"model", text: str}, ...]
    message: str | None = None          # user's latest message
    context: dict | None = None         # extra context (sim results etc.)


@router.post("/nova-chat")
async def nova_chat(body: NovaChatBody, request: Request):
    """
    AI assistant endpoint for the Nova chat setup interface.

    step=tg_help      → short Telegram setup Q&A (≤3 sentences)
    step=mt5_help     → short MT5 setup Q&A (≤3 sentences)
    step=ai_rules     → strategy elicitation conversation; outputs <strategies>{...}</strategies>
    step=sim_analysis → brief post-simulation analysis
    """
    import re
    from google.genai import types as _types
    from vps.services.signal_processor import SignalProcessor

    sp: SignalProcessor | None = request.app.state.signal_processor
    if sp is None:
        raise HTTPException(503, detail="AI not available (GEMINI_API_KEY missing)")

    step = body.step
    history = body.history or []
    user_msg = (body.message or "").strip()
    ctx = body.context or {}

    # ── tg_help ──────────────────────────────────────────────────────────────
    if step == "tg_help":
        phone = ctx.get("phone", "")
        phone_note = f" The user has already provided their phone number ({phone}) in a previous step, so do NOT ask for it again or mention re-entering it." if phone else ""
        system = (
            "You are Nova, a concise AI assistant embedded in a web setup wizard for a Telegram trading bot. "
            "The user is currently looking at a web form with two fields: 'API ID' (a number) and 'API Hash' "
            "(a 32-character string). They need to retrieve these from my.telegram.org → API development tools."
            f"{phone_note} "
            "Answer the user's question in at most 3 sentences. "
            "NEVER start your reply with a greeting such as 'Ciao!', 'Hello!', 'Hi!' or any other salutation — "
            "go straight to the answer. "
            "Do NOT mention scripts, the command line, or copying credentials anywhere other than the form fields shown on screen. "
            "Respond in the same language the user writes in."
        )
        try:
            from vps.services.strategy_executor import _PRO_MODEL
            resp = await sp._client.aio.models.generate_content(
                model=_PRO_MODEL,
                contents=user_msg,
                config=_types.GenerateContentConfig(system_instruction=system),
            )
            return {"reply": (resp.text or "").strip(), "actions": []}
        except Exception as exc:
            raise HTTPException(500, detail=str(exc))

    # ── mt5_help ─────────────────────────────────────────────────────────────
    if step == "mt5_help":
        system = (
            "You are Nova, a concise AI assistant embedded in a web setup wizard for a trading bot. "
            "The user is filling a form with three fields: 'Login' (their MT5 account number), "
            "'Password' (their MT5 password), and 'Server' (the broker's server name, e.g. ICMarkets-Live). "
            "Answer the user's question in at most 3 sentences. "
            "NEVER start your reply with a greeting such as 'Ciao!', 'Hello!', 'Hi!' or any other salutation — "
            "go straight to the answer. "
            "Do NOT mention scripts, the command line, or any steps outside this form. "
            "Respond in the same language the user writes in."
        )
        try:
            from vps.services.strategy_executor import _PRO_MODEL
            resp = await sp._client.aio.models.generate_content(
                model=_PRO_MODEL,
                contents=user_msg,
                config=_types.GenerateContentConfig(system_instruction=system),
            )
            return {"reply": (resp.text or "").strip(), "actions": []}
        except Exception as exc:
            raise HTTPException(500, detail=str(exc))

    # ── ai_rules ─────────────────────────────────────────────────────────────
    if step == "ai_rules":
        system = """You are Nova, a friendly AI trading assistant. Your goal is to understand how the user wants \
to manage their trades and produce a set of structured trading strategies.

You are gathering information about THREE strategies:
1. sizing_strategy — how to size lots (fixed lot, % of balance, risk per trade, etc.)
2. management_strategy — how to manage open positions (move SL to breakeven, trail SL, partial close, etc.)
3. deletion_strategy — what to do when a signal message is deleted (close immediately, close if in loss, ignore, etc.)

Ask natural follow-up questions to understand the user's preferences. Once you have enough information \
(you may ask up to 4 questions max), output the strategies as a structured block EXACTLY in this format — \
it MUST appear at the end of your message, after your conversational text:

<strategies>
{"sizing_strategy": "...", "management_strategy": "...", "deletion_strategy": "..."}
</strategies>

Each value is a free-text description (1-3 sentences) that will be given verbatim to an AI agent as its trading rule.
Write "null" (the string) if the user doesn't want a rule for that strategy.
NEVER start a reply with a greeting like "Ciao!", "Hello!" or "Hi!" — go straight to the point.
Respond in the same language the user writes in. Be warm, concise, and practical."""

        try:
            from vps.services.strategy_executor import _PRO_MODEL

            # Build conversation history for multi-turn
            contents: list = []
            for turn in history:
                role = "user" if turn.get("role") == "user" else "model"
                contents.append(_types.Content(role=role, parts=[_types.Part(text=turn.get("text", ""))]))
            if user_msg:
                contents.append(_types.Content(role="user", parts=[_types.Part(text=user_msg)]))

            resp = await sp._client.aio.models.generate_content(
                model=_PRO_MODEL,
                contents=contents,
                config=_types.GenerateContentConfig(system_instruction=system),
            )
            reply_text = (resp.text or "").strip()

            # Parse <strategies> block if present
            actions: list[dict] = []
            m = re.search(r"<strategies>(.*?)</strategies>", reply_text, re.DOTALL)
            if m:
                import json as _json
                try:
                    strats = _json.loads(m.group(1).strip())
                    actions.append({"type": "set_strategies", "strategies": strats})
                except Exception:
                    pass

            return {"reply": reply_text, "actions": actions}
        except Exception as exc:
            raise HTTPException(500, detail=str(exc))

    # ── sim_analysis ─────────────────────────────────────────────────────────
    if step == "sim_analysis":
        sim_result = ctx.get("sim_result", {})
        strategies = ctx.get("strategies", {})
        system = (
            "You are Nova, a friendly AI trading assistant. "
            "The user just ran a simulation of their trading setup. Analyse the result in 2-4 sentences: "
            "mention the outcome (total P&L, events that happened) and any notable observations. "
            "Be encouraging but honest. Respond in the same language the user writes in."
        )
        import json as _json
        prompt = (
            f"Simulation result:\n{_json.dumps(sim_result, indent=2)}\n\n"
            f"Strategies configured:\n{_json.dumps(strategies, indent=2)}"
        )
        try:
            from vps.services.strategy_executor import _PRO_MODEL
            resp = await sp._client.aio.models.generate_content(
                model=_PRO_MODEL,
                contents=prompt,
                config=_types.GenerateContentConfig(system_instruction=system),
            )
            return {"reply": (resp.text or "").strip(), "actions": []}
        except Exception as exc:
            raise HTTPException(500, detail=str(exc))

    raise HTTPException(400, detail=f"Unknown step: {step}")
