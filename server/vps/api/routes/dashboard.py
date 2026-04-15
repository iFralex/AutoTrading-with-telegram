"""
Dashboard API — dati di debug per utente (ricerca per numero di telefono).

Endpoints:
  GET   /api/dashboard/user?phone={phone}
        Ritorna le info dell'utente registrato + i log segnali più recenti.

  GET   /api/dashboard/logs?user_id={user_id}&limit=50&offset=0
        Paginazione dei log segnali (per infinite-scroll nel frontend).

  PATCH /api/dashboard/user/{user_id}/sizing-strategy
        Aggiorna la sizing_strategy dell'utente.

  POST  /api/dashboard/test-order
        Esegue direttamente un array di segnali (formato JSON AI) su MT5
        e ritorna i TradeResult. Utile per testare la connettività MT5.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from vps.services.signal_processor import TradeSignal

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ── Modelli request/response test-order ──────────────────────────────────────

class TestSignalInput(BaseModel):
    """Stesso schema prodotto da Gemini Pro / SignalProcessor."""
    symbol:      str
    order_type:  str
    entry_price: float | list[float] | None = None
    stop_loss:   float | None = None
    take_profit: float | None = None
    lot_size:    float | None = None
    order_mode:  str = "MARKET"


class TestOrderRequest(BaseModel):
    user_id: str
    signals: list[TestSignalInput]


class TestOrderResult(BaseModel):
    success:  bool
    order_id: int | None
    error:    str | None
    signal:   dict[str, Any] | None


@router.get("/user")
async def get_dashboard_user(
    phone: str = Query(..., description="Numero di telefono registrato"),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Cerca un utente per numero di telefono e ritorna:
    - Dati del profilo (senza password)
    - Ultimi 50 log di segnali
    - Contatore totale log
    """
    store      = request.app.state.user_store
    log_store  = request.app.state.signal_log_store

    user = await store.get_user_by_phone(phone)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Nessun utente trovato con il numero {phone}")

    # Rimuovi la password dal payload di risposta
    user_safe = {k: v for k, v in user.items() if k != "mt5_password"}

    user_id = user["user_id"]
    logs    = await log_store.get_by_user_id(user_id, limit=50, offset=0)
    total   = await log_store.count_by_user_id(user_id)

    return {
        "user":        user_safe,
        "logs":        logs,
        "total_logs":  total,
    }


class UpdateSizingStrategyBody(BaseModel):
    sizing_strategy: str | None = None


@router.patch("/user/{user_id}/sizing-strategy")
async def update_sizing_strategy(
    user_id: str,
    body: UpdateSizingStrategyBody,
    request: Request = None,  # type: ignore[assignment]
):
    """Aggiorna la sizing_strategy dell'utente."""
    store = request.app.state.user_store
    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")
    await store.update_sizing_strategy(user_id, body.sizing_strategy)
    return {"ok": True}


class UpdateManagementStrategyBody(BaseModel):
    management_strategy: str | None = None


@router.patch("/user/{user_id}/management-strategy")
async def update_management_strategy(
    user_id: str,
    body: UpdateManagementStrategyBody,
    request: Request = None,  # type: ignore[assignment]
):
    """Aggiorna la management_strategy dell'utente."""
    store = request.app.state.user_store
    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")
    await store.update_management_strategy(user_id, body.management_strategy)
    return {"ok": True}


class UpdateRangeEntryPctBody(BaseModel):
    range_entry_pct: int = Field(..., ge=0, le=100)


@router.patch("/user/{user_id}/range-entry-pct")
async def update_range_entry_pct(
    user_id: str,
    body: UpdateRangeEntryPctBody,
    request: Request = None,  # type: ignore[assignment]
):
    """Aggiorna la percentuale di posizionamento nel range di ingresso (0–100)."""
    store = request.app.state.user_store
    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")
    await store.update_range_entry_pct(user_id, body.range_entry_pct)
    return {"ok": True}


@router.post("/test-order")
async def test_order(
    body: TestOrderRequest,
    request: Request = None,  # type: ignore[assignment]
):
    """
    Esegue direttamente i segnali forniti su MT5 per l'utente indicato.
    I segnali devono essere nel formato JSON prodotto dall'AI (vedi TestSignalInput).
    Ritorna la lista dei TradeResult senza scrivere nulla nel log.
    """
    store      = request.app.state.user_store
    mt5_trader = request.app.state.mt5_trader

    user = await store.get_user(body.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {body.user_id} non trovato")

    mt5_login       = user.get("mt5_login")
    mt5_password    = user.get("mt5_password")
    mt5_server      = user.get("mt5_server")
    range_entry_pct = int(user.get("range_entry_pct") or 0)

    if not (mt5_login and mt5_password and mt5_server):
        raise HTTPException(
            status_code=422,
            detail="Credenziali MT5 mancanti per questo utente (login / password / server)"
        )

    if not body.signals:
        raise HTTPException(status_code=422, detail="Lista segnali vuota")

    signals = [
        TradeSignal(
            symbol      = s.symbol.strip(),
            order_type  = s.order_type.upper().strip(),
            entry_price = s.entry_price,
            stop_loss   = s.stop_loss,
            take_profit = s.take_profit,
            lot_size    = s.lot_size,
            order_mode  = s.order_mode.upper().strip(),
        )
        for s in body.signals
    ]

    results = await mt5_trader.execute_signals(
        user_id         = body.user_id,
        signals         = signals,
        mt5_login       = int(mt5_login),
        mt5_password    = mt5_password,
        mt5_server      = mt5_server,
        range_entry_pct = range_entry_pct,
    )

    from dataclasses import asdict
    return {
        "results": [
            {
                "success":  r.success,
                "order_id": r.order_id,
                "error":    r.error,
                "signal":   asdict(r.signal) if r.signal else None,
            }
            for r in results
        ]
    }


class SimulateMessageBody(BaseModel):
    user_id: str
    message: str = Field(..., min_length=1)


@router.post("/simulate-message")
async def simulate_message(
    body: SimulateMessageBody,
    request: Request = None,  # type: ignore[assignment]
):
    """
    Simula la pipeline di elaborazione di un messaggio Telegram per un utente:
      1. Flash (Gemini): classifica il messaggio (segnale sì/no)
      2. Pro (Gemini):   estrae i segnali strutturati, usando la sizing_strategy dell'utente

    Non esegue ordini MT5 e non scrive nulla nel log.
    """
    signal_processor = getattr(request.app.state, "signal_processor", None)
    if signal_processor is None:
        raise HTTPException(
            status_code=503,
            detail="SignalProcessor non disponibile (GEMINI_API_KEY non configurata sul server)",
        )

    store = request.app.state.user_store
    user = await store.get_user(body.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {body.user_id} non trovato")

    sizing_strategy: str | None = user.get("sizing_strategy") or None

    # ── Step 1: Flash detection ───────────────────────────────────────────────
    try:
        is_signal = await signal_processor._detect(body.message)
        flash_raw = "YES" if is_signal else "NO"
    except Exception as exc:
        return {
            "flash_raw":  None,
            "is_signal":  False,
            "signals":    [],
            "sizing_strategy": sizing_strategy,
            "error_step": "flash",
            "error":      str(exc),
        }

    if not is_signal:
        return {
            "flash_raw":  "NO",
            "is_signal":  False,
            "signals":    [],
            "sizing_strategy": sizing_strategy,
            "error_step": None,
            "error":      None,
        }

    # ── Step 2: Pro extraction ────────────────────────────────────────────────
    from dataclasses import asdict
    try:
        signals = await signal_processor.extract_signals(
            body.message,
            sizing_strategy=sizing_strategy,
            account_info=None,   # non apriamo MT5 durante la simulazione
        )
        if not signals:
            return {
                "flash_raw":  "YES",
                "is_signal":  True,
                "signals":    [],
                "sizing_strategy": sizing_strategy,
                "error_step": "extraction",
                "error":      "Gemini Pro non ha estratto segnali validi dal messaggio",
            }
        return {
            "flash_raw":  "YES",
            "is_signal":  True,
            "signals":    [asdict(s) for s in signals],
            "sizing_strategy": sizing_strategy,
            "error_step": None,
            "error":      None,
        }
    except Exception as exc:
        return {
            "flash_raw":  "YES",
            "is_signal":  True,
            "signals":    [],
            "sizing_strategy": sizing_strategy,
            "error_step": "extraction",
            "error":      str(exc),
        }


@router.get("/trade-stats")
async def get_trade_stats(
    user_id: str  = Query(..., description="Telegram user_id"),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Statistiche di performance sulle operazioni MT5 chiuse:
    - Win rate, P&L medio/mediano/totale
    - Guadagno medio per TP, perdita media per SL
    - Profit factor, best/worst trade
    - Breakdown per motivo chiusura (TP / SL / CLIENT / ...)
    - P&L giornaliero e settimanale
    - Per simbolo: win rate, P&L totale/medio
    - P&L cumulativo (per grafico)
    - Consecutivi massimi vincite/perdite
    """
    closed_trade_store = request.app.state.closed_trade_store
    stats = await closed_trade_store.get_trade_stats(user_id)
    return stats


@router.get("/stats")
async def get_dashboard_stats(
    user_id: str  = Query(..., description="Telegram user_id"),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Calcola statistiche aggregate complete per un utente:
    - Contatori base (messaggi, segnali, ordini, errori)
    - Trend giornaliero (ultimi 90 giorni)
    - Distribuzione oraria dei segnali
    - Analisi per simbolo (successi, fallimenti, BUY/SELL, lotto medio)
    - Distribuzione BUY vs SELL e modalità ordine
    - Top mittenti Telegram
    - Errori per step della pipeline
    - Andamento balance/equity nel tempo
    """
    log_store = request.app.state.signal_log_store
    stats = await log_store.get_stats_by_user_id(user_id)
    return stats


@router.get("/logs")
async def get_dashboard_logs(
    user_id: str  = Query(..., description="Telegram user_id"),
    limit:   int  = Query(50,  ge=1, le=200),
    offset:  int  = Query(0,   ge=0),
    request: Request = None,  # type: ignore[assignment]
):
    """Paginazione dei log segnali per un utente già identificato."""
    log_store = request.app.state.signal_log_store

    logs  = await log_store.get_by_user_id(user_id, limit=limit, offset=offset)
    total = await log_store.count_by_user_id(user_id)

    return {"logs": logs, "total": total}
