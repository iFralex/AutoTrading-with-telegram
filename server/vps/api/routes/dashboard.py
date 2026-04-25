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

import logging
import shutil
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from vps.services.signal_processor import TradeSignal

logger = logging.getLogger(__name__)

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


# ── Gestione gruppi (multi-gruppo) ───────────────────────────────────────────

async def _restart_listener(store, tm, user_id: str) -> None:
    """Riavvia il listener Telegram con la lista aggiornata dei gruppi attivi."""
    user = await store.get_user(user_id)
    if user is None:
        return
    groups = await store.get_user_groups(user_id)
    active_ids = [g["group_id"] for g in groups if g["active"]]
    try:
        tm.update_user_groups(
            user_id=user_id,
            api_id=user["api_id"],
            api_hash=user["api_hash"],
            group_ids=active_ids,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"DB aggiornato ma errore nel listener Telegram: {exc}",
        )


@router.get("/user/{user_id}/groups")
async def list_user_groups(
    user_id: str,
    request: Request = None,  # type: ignore[assignment]
):
    """Ritorna tutti i gruppi/canali dell'utente."""
    store = request.app.state.user_store
    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")
    groups = await store.get_user_groups(user_id)
    return {"groups": groups}


@router.get("/user/{user_id}/available-groups")
async def list_available_groups(
    user_id: str,
    request: Request = None,  # type: ignore[assignment]
):
    """
    Ritorna i gruppi/canali Telegram a cui è iscritto l'utente,
    usando il client Telethon attivo, escludendo quelli già configurati.
    """
    store = request.app.state.user_store
    tm    = request.app.state.telegram_manager

    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")

    try:
        all_groups = tm.get_groups_for_user(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    configured_ids = {str(g["group_id"]) for g in (user.get("groups") or [])}
    available = [g for g in all_groups if g["id"] not in configured_ids]
    return {"groups": available}


class AddGroupBody(BaseModel):
    group_id:   int
    group_name: str = Field(..., min_length=1)


@router.post("/user/{user_id}/groups")
async def add_user_group(
    user_id: str,
    body: AddGroupBody,
    request: Request = None,  # type: ignore[assignment]
):
    """Aggiunge un nuovo gruppo/canale e aggiorna il listener Telegram."""
    store = request.app.state.user_store
    tm    = request.app.state.telegram_manager
    user  = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")
    await store.upsert_user_group(user_id, body.group_id, body.group_name)
    await _restart_listener(store, tm, user_id)
    return {"ok": True}


class UpdateGroupSettingsBody(BaseModel):
    group_name:              str | None = None
    sizing_strategy:         str | None = None
    management_strategy:     str | None = None
    range_entry_pct:         int | None = Field(None, ge=0, le=100)
    entry_if_favorable:      bool | None = None
    deletion_strategy:       str | None = None
    extraction_instructions: str | None = None


@router.patch("/user/{user_id}/groups/{group_id}")
async def update_user_group(
    user_id:  str,
    group_id: int,
    body: UpdateGroupSettingsBody,
    request: Request = None,  # type: ignore[assignment]
):
    """Aggiorna le impostazioni di un gruppo specifico."""
    store = request.app.state.user_store
    grp = await store.get_user_group(user_id, group_id)
    if grp is None:
        raise HTTPException(status_code=404, detail=f"Gruppo {group_id} non trovato per l'utente")
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    await store.update_user_group_settings(user_id, group_id, fields)
    return {"ok": True}


@router.delete("/user/{user_id}/groups/{group_id}")
async def remove_user_group(
    user_id:  str,
    group_id: int,
    request: Request = None,  # type: ignore[assignment]
):
    """Rimuove un gruppo dal profilo e aggiorna il listener Telegram."""
    store = request.app.state.user_store
    tm    = request.app.state.telegram_manager
    grp = await store.get_user_group(user_id, group_id)
    if grp is None:
        raise HTTPException(status_code=404, detail=f"Gruppo {group_id} non trovato per l'utente")
    await store.delete_user_group(user_id, group_id)
    await _restart_listener(store, tm, user_id)
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

    mt5_login    = user.get("mt5_login")
    mt5_password = user.get("mt5_password")
    mt5_server   = user.get("mt5_server")
    first_group  = (user.get("groups") or [{}])[0]
    range_entry_pct    = int(first_group.get("range_entry_pct") or 0)
    entry_if_favorable = bool(first_group.get("entry_if_favorable"))

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
        user_id            = body.user_id,
        signals            = signals,
        mt5_login          = int(mt5_login),
        mt5_password       = mt5_password,
        mt5_server         = mt5_server,
        range_entry_pct    = range_entry_pct,
        entry_if_favorable = entry_if_favorable,
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
    extraction_instructions: str | None = user.get("extraction_instructions") or None

    # ── Step 1: Flash detection ───────────────────────────────────────────────
    try:
        is_signal, _, _ = await signal_processor._detect(body.message)
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
        signals, _, _ = await signal_processor.extract_signals(
            body.message,
            sizing_strategy=sizing_strategy,
            account_info=None,   # non apriamo MT5 durante la simulazione
            extraction_instructions=extraction_instructions,
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


@router.get("/recent-trades")
async def get_recent_trades(
    user_id: str  = Query(..., description="Telegram user_id"),
    limit:   int  = Query(5, ge=1, le=50),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Ritorna le ultime N posizioni chiuse con tutti i dati disponibili
    (ticket, symbol, direction, entry/close price, SL, TP, profit, reason, open/close time).
    Utile per diagnosticare problemi nel recupero dati da MT5.
    """
    closed_trade_store = request.app.state.closed_trade_store
    trades = await closed_trade_store.get_recent_trades(user_id, limit)
    return {"trades": trades}


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
    user_id:  str       = Query(..., description="Telegram user_id"),
    group_id: int | None = Query(None, description="Filtra per gruppo specifico (None = globale)"),
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
    stats = await log_store.get_stats_by_user_id(user_id, group_id=group_id)
    return stats


@router.get("/logs")
async def get_dashboard_logs(
    user_id:  str       = Query(..., description="Telegram user_id"),
    limit:    int       = Query(50,  ge=1, le=200),
    offset:   int       = Query(0,   ge=0),
    group_id: int | None = Query(None, description="Filtra per gruppo specifico"),
    request: Request = None,  # type: ignore[assignment]
):
    """Paginazione dei log segnali per un utente, opzionalmente filtrata per gruppo."""
    log_store = request.app.state.signal_log_store

    logs  = await log_store.get_by_user_id(user_id, limit=limit, offset=offset, group_id=group_id)
    total = await log_store.count_by_user_id(user_id, group_id=group_id)

    return {"logs": logs, "total": total}


@router.get("/ai-logs")
async def get_ai_logs(
    user_id: str = Query(..., description="Telegram user_id"),
    limit:   int = Query(50, ge=1, le=200),
    offset:  int = Query(0,  ge=0),
    request: Request = None,  # type: ignore[assignment]
):
    """Ultimi N log di chiamate AI (Flash + Pro + Strategy) per un utente."""
    ai_log_store = request.app.state.ai_log_store
    logs = await ai_log_store.get_by_user_id(user_id, limit=limit, offset=offset)
    return {"logs": logs, "total": len(logs)}


@router.get("/ai-stats")
async def get_ai_stats(
    user_id: str = Query(..., description="Telegram user_id"),
    request: Request = None,  # type: ignore[assignment]
):
    """Statistiche aggregate sull'utilizzo AI per un utente."""
    ai_log_store = request.app.state.ai_log_store
    stats = await ai_log_store.get_stats(user_id)
    return stats


@router.delete("/user/{user_id}")
async def delete_user(
    user_id: str,
    request: Request = None,  # type: ignore[assignment]
):
    """
    Eliminazione completa dell'account utente e di tutti i dati associati:
      - Disconnette e rimuove il listener Telegram attivo
      - Elimina il file di sessione Telegram (.session) dal filesystem
      - Elimina la directory MT5 dell'utente (istanza locale)
      - Elimina tutti i log segnali, log AI, trade chiusi, backtest
      - Elimina la voce utente e i gruppi dal DB
      - Elimina eventuali signal_links
      - Elimina la sessione di setup temporanea (setup_sessions.db)
    """
    store              = request.app.state.user_store
    log_store          = request.app.state.signal_log_store
    ai_log_store       = request.app.state.ai_log_store
    closed_trade_store = request.app.state.closed_trade_store
    backtest_store     = request.app.state.backtest_store
    session_store      = request.app.state.setup_session_store
    tm                 = request.app.state.telegram_manager
    mt5_trader         = request.app.state.mt5_trader
    sessions_dir       = request.app.state.sessions_dir
    mt5_users_dir      = request.app.state.mt5_users_dir

    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")

    phone = user.get("phone", "")

    # 1. Ferma e disconnette il client Telegram attivo
    try:
        tm.remove_user(user_id)
        logger.info("delete_user %s: listener Telegram fermato", user_id)
    except Exception as exc:
        logger.warning("delete_user %s: errore rimozione listener Telegram: %s", user_id, exc)

    # 2. Elimina il file di sessione Telegram dal filesystem
    session_file = sessions_dir / f"{user_id}.session"
    if session_file.exists():
        try:
            session_file.unlink()
            logger.info("delete_user %s: file sessione Telegram eliminato", user_id)
        except Exception as exc:
            logger.warning("delete_user %s: errore eliminazione file sessione: %s", user_id, exc)

    # 3. Termina il processo MT5 dell'utente (se aperto) e poi elimina la directory
    mt5_user_dir = mt5_users_dir / user_id
    if mt5_user_dir.exists():
        try:
            killed = mt5_trader.kill_user_process(user_id)
            if killed:
                logger.info("delete_user %s: processo MT5 terminato", user_id)
        except Exception as exc:
            logger.warning("delete_user %s: errore chiusura processo MT5: %s", user_id, exc)
        try:
            shutil.rmtree(mt5_user_dir)
            logger.info("delete_user %s: directory MT5 eliminata", user_id)
        except Exception as exc:
            logger.warning("delete_user %s: errore eliminazione directory MT5: %s", user_id, exc)

    # 4. Elimina tutti i dati dal DB
    await log_store.delete_by_user_id(user_id)
    await ai_log_store.delete_by_user_id(user_id)
    await closed_trade_store.delete_by_user_id(user_id)
    await backtest_store.delete_all_runs_for_user(user_id)
    await store.delete_all_links_for_user(user_id)
    await store.delete_all_user_groups(user_id)
    await store.delete(user_id)
    logger.info("delete_user %s: tutti i record DB eliminati", user_id)

    # 5. Elimina la sessione di setup temporanea (best-effort)
    if phone:
        try:
            await session_store.delete(phone)
            logger.info("delete_user %s: sessione setup eliminata (phone=%s)", user_id, phone)
        except Exception as exc:
            logger.warning("delete_user %s: errore eliminazione sessione setup: %s", user_id, exc)

    return {"ok": True}


@router.delete("/user/{user_id}/stats")
async def reset_user_stats(
    user_id: str,
    request: Request = None,  # type: ignore[assignment]
):
    """
    Azzera le statistiche di un utente eliminando tutti i log segnali,
    i log AI e i trade chiusi. Le impostazioni (strategie, credenziali MT5)
    restano invariate.
    """
    store              = request.app.state.user_store
    log_store          = request.app.state.signal_log_store
    ai_log_store       = request.app.state.ai_log_store
    closed_trade_store = request.app.state.closed_trade_store

    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")

    deleted_logs   = await log_store.delete_by_user_id(user_id)
    deleted_ai     = await ai_log_store.delete_by_user_id(user_id)
    deleted_trades = await closed_trade_store.delete_by_user_id(user_id)

    return {
        "ok": True,
        "deleted_signal_logs": deleted_logs,
        "deleted_ai_logs":     deleted_ai,
        "deleted_trades":      deleted_trades,
    }
