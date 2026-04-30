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
import time
from typing import Any

import asyncio
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from vps.api.deps import get_current_user
from fastapi.responses import StreamingResponse
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
    current_user: dict = Depends(get_current_user),
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

    user_safe = {k: v for k, v in current_user.items() if k != "mt5_password"}
    user_id = current_user["user_id"]

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
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Ritorna tutti i gruppi/canali dell'utente."""
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store = request.app.state.user_store
    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")
    groups = await store.get_user_groups(user_id)
    return {"groups": groups}


@router.get("/user/{user_id}/available-groups")
async def list_available_groups(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Ritorna i gruppi/canali Telegram a cui è iscritto l'utente,
    usando il client Telethon attivo, escludendo quelli già configurati.
    """
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
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
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Aggiunge un nuovo gruppo/canale e aggiorna il listener Telegram."""
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
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
    trading_hours_enabled:   bool | None = None
    trading_hours_start:     int | None = Field(None, ge=0, le=23)
    trading_hours_end:       int | None = Field(None, ge=0, le=23)
    trading_hours_days:      list[str] | None = None
    min_confidence:          int | None = Field(None, ge=0, le=100)
    eco_calendar_enabled:    bool | None = None
    eco_calendar_window:     int | None = Field(None, ge=5, le=120)
    eco_calendar_strategy:   str | None = None


@router.patch("/user/{user_id}/groups/{group_id}")
async def update_user_group(
    user_id:  str,
    group_id: int,
    body: UpdateGroupSettingsBody,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Aggiorna le impostazioni di un gruppo specifico."""
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
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
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Removes a group from the user's profile, closes all open follower positions,
    cleans up community follow records, and updates the Telegram listener.
    """
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store              = request.app.state.user_store
    tm                 = request.app.state.telegram_manager
    signal_log_store   = request.app.state.signal_log_store
    mt5_trader         = request.app.state.mt5_trader
    group_follow_store = request.app.state.group_follow_store

    grp = await store.get_user_group(user_id, group_id)
    if grp is None:
        raise HTTPException(status_code=404, detail=f"Gruppo {group_id} non trovato per l'utente")

    # ── Close open positions of all community followers ───────────────────────
    followers = await group_follow_store.get_followers(user_id, group_id)
    for follower_uid in followers:
        try:
            follower_user = await store.get_user(follower_uid)
            if not follower_user:
                continue
            mt5_login    = follower_user.get("mt5_login")
            mt5_password = follower_user.get("mt5_password")
            mt5_server   = follower_user.get("mt5_server")
            if not (mt5_login and mt5_password and mt5_server):
                continue
            signal_group_ids = await signal_log_store.get_signal_group_ids_by_group(
                follower_uid, group_id
            )
            if not signal_group_ids:
                continue
            sig_id_set = set(signal_group_ids)
            positions = await mt5_trader.get_positions(
                user_id=follower_uid,
                mt5_login=int(mt5_login),
                mt5_password=mt5_password,
                mt5_server=mt5_server,
            )
            for pos in positions:
                if pos.get("signal_group_id") in sig_id_set:
                    try:
                        await mt5_trader.close_position_by_ticket(
                            user_id=follower_uid,
                            ticket=pos["ticket"],
                            mt5_login=int(mt5_login),
                            mt5_password=mt5_password,
                            mt5_server=mt5_server,
                        )
                    except Exception as _close_exc:
                        logger.warning(
                            "remove_user_group: close follower %s position %s failed: %s",
                            follower_uid, pos["ticket"], _close_exc,
                        )
        except Exception as _exc:
            logger.warning(
                "remove_user_group: position cleanup for follower %s failed: %s",
                follower_uid, _exc,
            )

    # Remove follow records and shadow user_groups entries for all followers
    await group_follow_store.delete_by_source(user_id, group_id)
    for follower_uid in followers:
        await store.delete_community_follow_entry(follower_uid, group_id)

    await store.delete_user_group(user_id, group_id)
    await _restart_listener(store, tm, user_id)
    return {"ok": True}


# ── Trust Score (Feature 4) ───────────────────────────────────────────────────

def _compute_trust_score(trade_stats: dict, signal_stats: dict) -> dict:
    """
    Formula (tot. 100 punti):
      - Win Rate       (0-35): win_rate * 0.35
      - Profit Factor  (0-25): min(PF/3, 1) * 25  — penalizza PF < 1
      - Volume         (0-15): min(trades/50, 1) * 15
      - Exec Rate      (0-15): exec_success_rate * 0.15
      - Streak         (0-10): 10 * (1 - min(max_consec_losses/10, 1))
    """
    total_trades = int(trade_stats.get("total_trades") or 0)
    if total_trades == 0:
        return {"score": None, "label": "Nessun dato", "breakdown": {}}

    wins               = int(trade_stats.get("wins") or 0)
    win_rate           = wins / total_trades * 100
    pf                 = trade_stats.get("profit_factor")
    max_consec_losses  = int(trade_stats.get("max_consecutive_losses") or 0)
    exec_rate          = float(signal_stats.get("execution_success_rate") or 0)

    win_rate_score  = round(win_rate * 0.35, 1)
    pf_score        = round(min((pf or 0) / 3.0, 1.0) * 25, 1) if pf is not None else 0.0
    volume_score    = round(min(total_trades / 50.0, 1.0) * 15, 1)
    exec_score      = round(exec_rate * 0.15, 1)
    streak_score    = round(10.0 * (1.0 - min(max_consec_losses / 10.0, 1.0)), 1)

    score = max(0, min(100, round(win_rate_score + pf_score + volume_score + exec_score + streak_score)))

    if score >= 75:   label = "Eccellente"
    elif score >= 55: label = "Buono"
    elif score >= 35: label = "Discreto"
    else:             label = "Basso"

    return {
        "score": score,
        "label": label,
        "breakdown": {
            "win_rate_score":       win_rate_score,
            "profit_factor_score":  pf_score,
            "volume_score":         volume_score,
            "exec_rate_score":      exec_score,
            "streak_score":         streak_score,
        },
    }


@router.get("/trust-scores")
async def get_trust_scores(
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Trust Score per ogni gruppo dell'utente (0-100, basato su win rate, volume, exec rate)."""
    user_id = current_user["user_id"]
    store              = request.app.state.user_store
    log_store          = request.app.state.signal_log_store
    closed_trade_store = request.app.state.closed_trade_store

    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")

    groups = user.get("groups") or []
    scores = []
    for g in groups:
        gid          = g["group_id"]
        trade_stats  = await closed_trade_store.get_group_trade_stats(user_id, gid)
        signal_stats = await log_store.get_stats_by_user_id(user_id, group_id=gid)
        score_data   = _compute_trust_score(trade_stats, signal_stats)
        scores.append({
            "group_id":               gid,
            "group_name":             g["group_name"],
            "score":                  score_data["score"],
            "label":                  score_data["label"],
            "trade_count":            trade_stats.get("total_trades", 0),
            "win_rate":               trade_stats.get("win_rate", 0.0),
            "profit_factor":          trade_stats.get("profit_factor"),
            "max_consecutive_losses": trade_stats.get("max_consecutive_losses", 0),
            "breakdown":              score_data.get("breakdown", {}),
        })
    return {"scores": scores}


# ── Drawdown alert (Feature 6) ────────────────────────────────────────────────

class DrawdownSettingsBody(BaseModel):
    drawdown_alert_pct:   float | None = Field(None, ge=0, le=100)
    drawdown_period:      str | None   = Field(None, pattern="^(daily|weekly|monthly|custom)$")
    drawdown_period_days: int | None   = Field(None, ge=1, le=365)
    drawdown_strategy:    str | None   = None


@router.get("/user/{user_id}/drawdown-status")
async def get_drawdown_status(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Stato drawdown: se il trading è sospeso + configurazione completa."""
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store = request.app.state.user_store
    user  = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")
    paused = user_id in request.app.state.drawdown_paused_users
    return {
        "paused":        paused,
        "threshold":     user.get("drawdown_alert_pct"),
        "period":        user.get("drawdown_period") or "daily",
        "period_days":   user.get("drawdown_period_days") or 1,
        "strategy":      user.get("drawdown_strategy"),
    }


@router.patch("/user/{user_id}/drawdown-settings")
async def update_drawdown_settings(
    user_id: str,
    body: DrawdownSettingsBody,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Aggiorna tutte le impostazioni drawdown."""
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store = request.app.state.user_store
    user  = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")
    pct = body.drawdown_alert_pct
    await store.update_drawdown_settings_full(
        user_id,
        drawdown_alert_pct   = pct if pct and pct > 0 else None,
        drawdown_period      = body.drawdown_period or "daily",
        drawdown_period_days = body.drawdown_period_days or 1,
        drawdown_strategy    = body.drawdown_strategy or None,
    )
    return {"ok": True}


@router.post("/user/{user_id}/resume-drawdown")
async def resume_drawdown(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Riprende il trading dopo una sospensione per drawdown."""
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store = request.app.state.user_store
    user  = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")
    request.app.state.drawdown_paused_users.discard(user_id)
    return {"ok": True}


@router.post("/test-order")
async def test_order(
    body: TestOrderRequest,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Esegue direttamente i segnali forniti su MT5 per l'utente indicato.
    I segnali devono essere nel formato JSON prodotto dall'AI (vedi TestSignalInput).
    Ritorna la lista dei TradeResult senza scrivere nulla nel log.
    """
    if body.user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
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
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Simula la pipeline di elaborazione di un messaggio Telegram per un utente:
      1. Flash (Gemini): classifica il messaggio (segnale sì/no)
      2. Pro (Gemini):   estrae i segnali strutturati, usando la sizing_strategy dell'utente

    Non esegue ordini MT5 e non scrive nulla nel log.
    """
    if body.user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
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
    limit:   int  = Query(5, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Ritorna le ultime N posizioni chiuse con tutti i dati disponibili
    (ticket, symbol, direction, entry/close price, SL, TP, profit, reason, open/close time).
    Utile per diagnosticare problemi nel recupero dati da MT5.
    """
    user_id = current_user["user_id"]
    closed_trade_store = request.app.state.closed_trade_store
    trades = await closed_trade_store.get_recent_trades(user_id, limit)
    return {"trades": trades}


@router.get("/trade-stats")
async def get_trade_stats(
    current_user: dict = Depends(get_current_user),
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
    user_id = current_user["user_id"]
    closed_trade_store = request.app.state.closed_trade_store
    stats = await closed_trade_store.get_trade_stats(user_id)
    return stats


@router.get("/stats")
async def get_dashboard_stats(
    group_id: int | None = Query(None, description="Filtra per gruppo specifico (None = globale)"),
    current_user: dict = Depends(get_current_user),
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
    user_id = current_user["user_id"]
    log_store = request.app.state.signal_log_store
    stats = await log_store.get_stats_by_user_id(user_id, group_id=group_id)
    return stats


@router.get("/logs")
async def get_dashboard_logs(
    limit:    int       = Query(50,  ge=1, le=200),
    offset:   int       = Query(0,   ge=0),
    group_id: int | None = Query(None, description="Filtra per gruppo specifico"),
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Paginazione dei log segnali per un utente, opzionalmente filtrata per gruppo."""
    user_id = current_user["user_id"]
    log_store = request.app.state.signal_log_store

    logs  = await log_store.get_by_user_id(user_id, limit=limit, offset=offset, group_id=group_id)
    total = await log_store.count_by_user_id(user_id, group_id=group_id)

    return {"logs": logs, "total": total}


@router.get("/ai-logs")
async def get_ai_logs(
    limit:   int = Query(50, ge=1, le=200),
    offset:  int = Query(0,  ge=0),
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Ultimi N log di chiamate AI (Flash + Pro + Strategy) per un utente."""
    user_id = current_user["user_id"]
    ai_log_store = request.app.state.ai_log_store
    logs = await ai_log_store.get_by_user_id(user_id, limit=limit, offset=offset)
    return {"logs": logs, "total": len(logs)}


@router.get("/ai-stats")
async def get_ai_stats(
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Statistiche aggregate sull'utilizzo AI per un utente."""
    user_id = current_user["user_id"]
    ai_log_store = request.app.state.ai_log_store
    stats = await ai_log_store.get_stats(user_id)
    return stats


def _rmtree_retry(path, user_id: str, retries: int = 4, delay: float = 1.5) -> None:
    """rmtree con retry per gestire WinError 32 (file bloccato da MT5 appena chiuso)."""
    for attempt in range(retries):
        try:
            shutil.rmtree(path)
            logger.info("delete_user %s: directory MT5 eliminata", user_id)
            return
        except OSError as exc:
            if attempt < retries - 1:
                logger.debug(
                    "delete_user %s: rmtree tentativo %d fallito (%s) — riprovo tra %.1fs",
                    user_id, attempt + 1, exc, delay,
                )
                time.sleep(delay)
            else:
                logger.warning("delete_user %s: errore eliminazione directory MT5: %s", user_id, exc)


@router.delete("/user/{user_id}")
async def delete_user(
    user_id: str,
    current_user: dict = Depends(get_current_user),
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
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store                = request.app.state.user_store
    log_store            = request.app.state.signal_log_store
    ai_log_store         = request.app.state.ai_log_store
    closed_trade_store   = request.app.state.closed_trade_store
    backtest_store       = request.app.state.backtest_store
    session_store        = request.app.state.setup_session_store
    monthly_report_store = request.app.state.monthly_report_store
    group_follow_store   = request.app.state.group_follow_store
    tm                   = request.app.state.telegram_manager
    mt5_trader           = request.app.state.mt5_trader
    sessions_dir         = request.app.state.sessions_dir
    mt5_users_dir        = request.app.state.mt5_users_dir

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
        _rmtree_retry(mt5_user_dir, user_id)

    # 4. Elimina tutti i dati dal DB
    await log_store.delete_by_user_id(user_id)
    await ai_log_store.delete_by_user_id(user_id)
    await closed_trade_store.delete_by_user_id(user_id)
    await backtest_store.delete_all_runs_for_user(user_id)
    await monthly_report_store.delete_by_user_id(user_id)
    await group_follow_store.delete_by_follower(user_id)
    await group_follow_store.delete_by_source_user(user_id)
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
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Azzera le statistiche di un utente eliminando tutti i log segnali,
    i log AI e i trade chiusi. Le impostazioni (strategie, credenziali MT5)
    restano invariate.
    """
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
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


@router.post("/user/{user_id}/generate-report")
async def generate_report(
    user_id: str,
    days: int = Query(default=30, ge=1, le=365),
    send_telegram: bool = Query(default=True),
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Genera un report PDF per gli ultimi N giorni e lo restituisce come download.
    Se send_telegram=true, lo invia anche via Telegram.
    """
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store              = request.app.state.user_store
    closed_trade_store = request.app.state.closed_trade_store
    monthly_report_gen = request.app.state.monthly_report_gen

    user = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")

    if monthly_report_gen is None:
        raise HTTPException(status_code=503, detail="MonthlyReportGenerator non attivo (GEMINI_API_KEY mancante)")

    stats        = await closed_trade_store.get_period_stats(user_id, days)
    trades       = await closed_trade_store.get_period_trades(user_id, days)
    equity_curve = await closed_trade_store.get_period_equity_curve(user_id, days)
    last_6       = await closed_trade_store.get_last_n_months_summaries(user_id, 6)
    groups_stats      = await closed_trade_store.get_period_groups_stats(user_id, days)
    prev_groups_stats = await closed_trade_store.get_period_groups_stats_prev(user_id, days)

    if stats["total_trades"] == 0:
        raise HTTPException(status_code=404, detail=f"Nessun trade negli ultimi {days} giorni")

    pdf_bytes = await monthly_report_gen.generate_for_period(
        user_id, days, stats, trades, equity_curve, last_6,
        groups_stats=groups_stats,
        prev_groups_stats=prev_groups_stats,
    )
    if not pdf_bytes:
        raise HTTPException(status_code=500, detail="Generazione PDF fallita")

    if send_telegram:
        tm = request.app.state.telegram_manager
        today = date.today().strftime("%d/%m/%Y")
        caption = f"Report ultimi {days} giorni — al {today}"
        filename = f"report_{days}d_{date.today().strftime('%Y%m%d')}.pdf"
        await asyncio.get_event_loop().run_in_executor(
            None, tm.notify_user_with_file, user_id, pdf_bytes, filename, caption
        )

    filename_dl = f"report_{days}d_{date.today().strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename_dl}"'},
    )


@router.get("/user/{user_id}/reports")
async def list_saved_reports(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """
    Returns metadata for all saved monthly PDF reports for this user.
    Each entry contains: id, year, month, generated_at, size_bytes.
    """
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store = request.app.state.user_store
    user  = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")

    monthly_report_store = request.app.state.monthly_report_store
    reports = await monthly_report_store.list_for_user(user_id)
    return {"reports": reports}


@router.get("/user/{user_id}/reports/{year}/{month}")
async def download_saved_report(
    user_id: str,
    year:    int,
    month:   int,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Downloads a previously saved monthly PDF report as a file attachment."""
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store = request.app.state.user_store
    user  = await store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"Utente {user_id} non trovato")

    monthly_report_store = request.app.state.monthly_report_store
    pdf_bytes = await monthly_report_store.get(user_id, year, month)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail=f"Nessun report salvato per {year}-{month:02d}")

    filename = f"report_{year}_{month:02d}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Community Groups (Elite feature) ─────────────────────────────────────────

def _group_alias(token: str) -> str:
    return f"Channel #{token[:6].upper()}"


@router.get("/community/groups")
async def list_community_groups(
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Lists all public community groups with trust score, sorted by score descending."""
    user_id = current_user["user_id"]
    store              = request.app.state.user_store
    log_store          = request.app.state.signal_log_store
    closed_trade_store = request.app.state.closed_trade_store
    group_follow_store = request.app.state.group_follow_store

    # Pre-build the set of tokens the viewer is following (one query, O(1) lookup)
    followed_tokens: set[str] = set()
    try:
        following = await group_follow_store.get_following(user_id)
        # Build token set by looking up each source group
        for f in following:
            src_grp = await store.get_user_group(f["source_user_id"], f["source_group_id"])
            if src_grp and src_grp.get("community_token"):
                followed_tokens.add(src_grp["community_token"])
    except Exception:
        pass

    community_groups = await store.get_all_community_groups()
    results = []
    for g in community_groups:
        uid   = g["user_id"]
        gid   = g["group_id"]
        token = g["community_token"]
        try:
            trade_stats  = await closed_trade_store.get_community_group_stats(uid, gid)
            signal_stats = await log_store.get_stats_by_user_id(uid, group_id=gid)
            score_data   = _compute_trust_score(trade_stats, signal_stats)
        except Exception:
            trade_stats  = {"total_trades": 0}
            score_data   = {"score": None, "label": "No data", "breakdown": {}}
        results.append({
            "token":                  token,
            "alias":                  _group_alias(token),
            "score":                  score_data["score"],
            "label":                  score_data["label"],
            "is_following":           token in followed_tokens,
            "trade_count":            int(trade_stats.get("total_trades") or 0),
            "win_rate":               trade_stats.get("win_rate") if trade_stats.get("total_trades") else None,
            "total_profit":           trade_stats.get("total_profit", 0.0),
            "profit_factor":          trade_stats.get("profit_factor"),
            "max_consecutive_losses": trade_stats.get("max_consecutive_losses", 0),
            "breakdown":              score_data.get("breakdown", {}),
        })
    results.sort(key=lambda x: (x["score"] is None, -(x["score"] or 0)))
    return {"groups": results}


@router.get("/community/groups/{token}")
async def get_community_group_detail(
    token:   str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Detailed stats, equity curve and recent trades for a community group."""
    user_id = current_user["user_id"]
    store              = request.app.state.user_store
    log_store          = request.app.state.signal_log_store
    closed_trade_store = request.app.state.closed_trade_store
    group_follow_store = request.app.state.group_follow_store

    grp = await store.get_user_group_by_token(token)
    if grp is None or not grp.get("community_visible"):
        raise HTTPException(status_code=404, detail="Community group not found")

    src_uid = grp["user_id"]
    src_gid = grp["group_id"]

    trade_stats   = await closed_trade_store.get_community_group_stats(src_uid, src_gid)
    equity_curve  = await closed_trade_store.get_community_group_equity(src_uid, src_gid)
    recent_trades = await closed_trade_store.get_community_group_trades(src_uid, src_gid, limit=30)
    signal_stats  = await log_store.get_stats_by_user_id(src_uid, group_id=src_gid)
    score_data    = _compute_trust_score(trade_stats, signal_stats)

    is_following = await group_follow_store.is_following(user_id, src_uid, src_gid)

    return {
        "token":         token,
        "alias":         _group_alias(token),
        "score":         score_data["score"],
        "label":         score_data["label"],
        "is_following":  is_following,
        "trade_stats":   trade_stats,
        "equity_curve":  equity_curve,
        "recent_trades": recent_trades,
        "breakdown":     score_data.get("breakdown", {}),
    }


class FollowGroupBody(BaseModel):
    follower_user_id: str


@router.post("/community/groups/{token}/follow")
async def follow_community_group(
    token: str,
    body:  FollowGroupBody,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Follow a community group: creates shadow user_groups entry and group_follows record."""
    if body.follower_user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store              = request.app.state.user_store
    group_follow_store = request.app.state.group_follow_store

    grp = await store.get_user_group_by_token(token)
    if grp is None or not grp.get("community_visible"):
        raise HTTPException(status_code=404, detail="Community group not found")

    follower = await store.get_user(body.follower_user_id)
    if follower is None:
        raise HTTPException(status_code=404, detail="Follower user not found")

    if body.follower_user_id == grp["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot follow your own group")

    src_uid = grp["user_id"]
    src_gid = grp["group_id"]

    already = await group_follow_store.is_following(body.follower_user_id, src_uid, src_gid)
    if already:
        return {"ok": True, "already_following": True}

    await store.create_community_follow_entry(
        follower_user_id     = body.follower_user_id,
        source_group_id      = src_gid,
        source_group_name    = grp["group_name"],
        sizing_strategy      = grp.get("sizing_strategy"),
        management_strategy  = grp.get("management_strategy"),
        range_entry_pct      = grp.get("range_entry_pct", 0),
        entry_if_favorable   = grp.get("entry_if_favorable", False),
        deletion_strategy    = grp.get("deletion_strategy"),
        extraction_instructions = grp.get("extraction_instructions"),
    )
    await group_follow_store.add_follow(body.follower_user_id, src_uid, src_gid)
    return {"ok": True, "already_following": False}


@router.delete("/community/groups/{token}/follow")
async def unfollow_community_group(
    token:           str,
    close_positions: bool = Query(default=True),
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Unfollow: optionally closes open positions, removes shadow entry and follow record."""
    user_id = current_user["user_id"]
    store              = request.app.state.user_store
    group_follow_store = request.app.state.group_follow_store
    signal_log_store   = request.app.state.signal_log_store
    mt5_trader         = request.app.state.mt5_trader

    grp = await store.get_user_group_by_token(token)
    if grp is None:
        raise HTTPException(status_code=404, detail="Community group not found")

    src_uid = grp["user_id"]
    src_gid = grp["group_id"]

    if close_positions:
        try:
            follower_user = await store.get_user(user_id)
            if follower_user:
                mt5_login    = follower_user.get("mt5_login")
                mt5_password = follower_user.get("mt5_password")
                mt5_server   = follower_user.get("mt5_server")
                if mt5_login and mt5_password and mt5_server:
                    signal_group_ids = await signal_log_store.get_signal_group_ids_by_group(
                        user_id, src_gid
                    )
                    if signal_group_ids:
                        sig_id_set = set(signal_group_ids)
                        positions = await mt5_trader.get_positions(
                            user_id=user_id,
                            mt5_login=int(mt5_login),
                            mt5_password=mt5_password,
                            mt5_server=mt5_server,
                        )
                        for pos in positions:
                            if pos.get("signal_group_id") in sig_id_set:
                                try:
                                    await mt5_trader.close_position_by_ticket(
                                        user_id=user_id,
                                        ticket=pos["ticket"],
                                        mt5_login=int(mt5_login),
                                        mt5_password=mt5_password,
                                        mt5_server=mt5_server,
                                    )
                                except Exception as _ce:
                                    logger.warning("unfollow close pos %s failed: %s", pos["ticket"], _ce)
        except Exception as _exc:
            logger.warning("unfollow position close failed: %s", _exc)

    await store.delete_community_follow_entry(user_id, src_gid)
    await group_follow_store.remove_follow(user_id, src_uid, src_gid)
    return {"ok": True}


@router.get("/user/{user_id}/community-follows")
async def list_community_follows(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Lists all community groups the user is following, with stats and their custom settings."""
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store              = request.app.state.user_store
    group_follow_store = request.app.state.group_follow_store
    log_store          = request.app.state.signal_log_store
    closed_trade_store = request.app.state.closed_trade_store

    following = await group_follow_store.get_following(user_id)
    results   = []
    for f in following:
        src_uid = f["source_user_id"]
        src_gid = f["source_group_id"]

        grp = await store.get_user_group(src_uid, src_gid)
        if grp is None:
            continue
        token = grp.get("community_token") or ""
        alias = _group_alias(token) if token else f"Channel #{src_gid}"

        shadow = await store.get_community_follow_entry(user_id, src_gid)

        try:
            trade_stats = await closed_trade_store.get_community_group_stats(src_uid, src_gid)
            signal_stats = await log_store.get_stats_by_user_id(src_uid, group_id=src_gid)
            score_data  = _compute_trust_score(trade_stats, signal_stats)
        except Exception:
            trade_stats = {"total_trades": 0}
            score_data  = {"score": None, "label": "No data"}

        results.append({
            "token":        token,
            "alias":        alias,
            "score":        score_data["score"],
            "label":        score_data["label"],
            "trade_count":  int(trade_stats.get("total_trades") or 0),
            "win_rate":     trade_stats.get("win_rate"),
            "total_profit": trade_stats.get("total_profit"),
            "followed_at":  f["created_at"],
            "my_settings":  shadow or {},
        })
    return {"following": results}


@router.patch("/user/{user_id}/community-follows/{token}")
async def update_community_follow_settings(
    user_id: str,
    token:   str,
    body: UpdateGroupSettingsBody,
    current_user: dict = Depends(get_current_user),
    request: Request = None,  # type: ignore[assignment]
):
    """Updates the follower's personal strategies for a followed community group."""
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    store              = request.app.state.user_store
    group_follow_store = request.app.state.group_follow_store

    grp = await store.get_user_group_by_token(token)
    if grp is None:
        raise HTTPException(status_code=404, detail="Community group not found")

    src_gid = grp["group_id"]
    if not await group_follow_store.is_following(user_id, grp["user_id"], src_gid):
        raise HTTPException(status_code=404, detail="You are not following this group")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    await store.update_user_group_settings(user_id, src_gid, fields)
    return {"ok": True}
