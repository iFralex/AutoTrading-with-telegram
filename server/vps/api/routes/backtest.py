"""
Route /api/backtest/*

  POST   /api/backtest/run            → avvia un run in background, ritorna run_id
  GET    /api/backtest/{run_id}       → stato + risultati completi del run
  GET    /api/backtest/{run_id}/trades → lista dei trade simulati
  GET    /api/backtest/list           → tutti i run dell'utente (sommario)
  DELETE /api/backtest/{run_id}       → elimina run e trade associati
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from vps.api.deps import get_current_user
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


# ── Modelli ───────────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    user_id:              str
    group_id:             str
    group_name:           str | None = None

    mode:                 str = Field(..., pattern="^(date_limit|message_count)$")
    limit_value:          str   # ISO date "2024-01-01" oppure numero "500"

    use_ai:               bool = False
    starting_balance_usd: float = 1000.0


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/run")
async def start_backtest(body: RunRequest, current_user: dict = Depends(get_current_user), request: Request = None):
    """
    Avvia un backtest in background.
    Ritorna immediatamente con { run_id, status: "running" }.
    """
    if body.user_id != current_user["user_id"]:
        raise HTTPException(403, "Accesso non autorizzato")
    bt_engine = getattr(request.app.state, "backtest_engine", None)
    bt_store  = getattr(request.app.state, "backtest_store",  None)
    user_store = request.app.state.user_store

    if bt_engine is None or bt_store is None:
        raise HTTPException(503, "BacktestEngine non disponibile")

    # Recupera credenziali MT5 dell'utente dal DB
    user = await user_store.get_user(body.user_id)
    if user is None:
        raise HTTPException(404, f"Utente {body.user_id} non trovato")

    mt5_login    = user.get("mt5_login")
    mt5_password = user.get("mt5_password")
    mt5_server   = user.get("mt5_server")
    if not (mt5_login and mt5_password and mt5_server):
        raise HTTPException(400, "Credenziali MT5 non configurate per questo utente")

    # Legge le impostazioni specifiche del gruppo selezionato
    group_settings = await user_store.get_user_group(body.user_id, int(body.group_id))
    if group_settings is None:
        # Fallback al primo gruppo attivo
        groups = await user_store.get_user_groups(body.user_id)
        group_settings = groups[0] if groups else {}
    sizing_strategy         = group_settings.get("sizing_strategy")
    management_strategy     = group_settings.get("management_strategy")
    extraction_instructions = group_settings.get("extraction_instructions")

    # Blocca il trading live per questo utente durante il backtest
    backtesting_users: set = request.app.state.backtesting_users
    if body.user_id in backtesting_users:
        raise HTTPException(409, "Un backtest è già in corso per questo utente")

    run_id = uuid.uuid4().hex

    # Crea la riga nel DB subito (status=running)
    await bt_store.create_run(
        run_id=run_id,
        user_id=body.user_id,
        group_id=body.group_id,
        group_name=body.group_name,
        mode=body.mode,
        limit_value=body.limit_value,
        use_ai=body.use_ai,
        starting_balance_usd=body.starting_balance_usd,
    )

    backtesting_users.add(body.user_id)
    backtest_tasks: dict = request.app.state.backtest_tasks

    async def _run_and_cleanup():
        try:
            await bt_engine.run(
                run_id=run_id,
                user_id=body.user_id,
                group_id=body.group_id,
                group_name=body.group_name,
                mode=body.mode,
                limit_value=body.limit_value,
                use_ai=body.use_ai,
                mt5_login=int(mt5_login),
                mt5_password=mt5_password,
                mt5_server=mt5_server,
                sizing_strategy=sizing_strategy,
                management_strategy=management_strategy,
                extraction_instructions=extraction_instructions,
                starting_balance_usd=body.starting_balance_usd,
            )
        finally:
            backtesting_users.discard(body.user_id)
            backtest_tasks.pop(run_id, None)

    task = asyncio.create_task(_run_and_cleanup())
    backtest_tasks[run_id] = task

    return {"run_id": run_id, "status": "running"}


@router.get("/list")
async def list_backtests(current_user: dict = Depends(get_current_user), request: Request = None):
    """Lista di tutti i run per l'utente, dal più recente al più vecchio."""
    user_id = current_user["user_id"]
    bt_store = getattr(request.app.state, "backtest_store", None)
    if bt_store is None:
        raise HTTPException(503, "BacktestStore non disponibile")
    runs = await bt_store.list_runs(user_id)
    return {"runs": runs, "total": len(runs)}


@router.get("/{run_id}")
async def get_backtest(run_id: str, current_user: dict = Depends(get_current_user), request: Request = None):
    """Ritorna lo stato e tutti i risultati aggregati di un run."""
    bt_store = getattr(request.app.state, "backtest_store", None)
    if bt_store is None:
        raise HTTPException(503, "BacktestStore non disponibile")
    run = await bt_store.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"Run {run_id} non trovato")
    if run["user_id"] != current_user["user_id"]:
        raise HTTPException(403, "Accesso non autorizzato")
    return run


@router.get("/{run_id}/trades")
async def get_backtest_trades(run_id: str, current_user: dict = Depends(get_current_user), request: Request = None):
    """Ritorna tutti i trade simulati del run con dettagli completi."""
    bt_store = getattr(request.app.state, "backtest_store", None)
    if bt_store is None:
        raise HTTPException(503, "BacktestStore non disponibile")
    run = await bt_store.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"Run {run_id} non trovato")
    if run["user_id"] != current_user["user_id"]:
        raise HTTPException(403, "Accesso non autorizzato")
    trades = await bt_store.get_trades(run_id)
    return {"run_id": run_id, "trades": trades, "total": len(trades)}


@router.post("/{run_id}/cancel")
async def cancel_backtest(run_id: str, current_user: dict = Depends(get_current_user), request: Request = None):
    """Interrompe un backtest in corso."""
    user_id = current_user["user_id"]
    bt_store = getattr(request.app.state, "backtest_store", None)
    if bt_store is None:
        raise HTTPException(503, "BacktestStore non disponibile")
    run = await bt_store.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"Run {run_id} non trovato")
    if run["user_id"] != user_id:
        raise HTTPException(403, "Non autorizzato")
    if not run["status"].startswith("running"):
        raise HTTPException(409, "Il backtest non è in esecuzione")

    task = request.app.state.backtest_tasks.get(run_id)
    if task:
        task.cancel()
    else:
        # Task non trovato (riavvio server?): segna comunque come cancellato
        await bt_store.update_run(run_id, status="cancelled",
                                  completed_at=datetime.now(timezone.utc).isoformat())
    return {"cancelled": run_id}


@router.delete("/{run_id}")
async def delete_backtest(run_id: str, current_user: dict = Depends(get_current_user), request: Request = None):
    """Elimina un run e tutti i suoi trade. Richiede user_id per sicurezza."""
    user_id = current_user["user_id"]
    bt_store = getattr(request.app.state, "backtest_store", None)
    if bt_store is None:
        raise HTTPException(503, "BacktestStore non disponibile")
    run = await bt_store.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"Run {run_id} non trovato")
    if run["user_id"] != user_id:
        raise HTTPException(403, "Non autorizzato")
    # Non si può eliminare un run ancora in esecuzione
    backtesting_users: set = request.app.state.backtesting_users
    if user_id in backtesting_users and run["status"] == "running":
        raise HTTPException(409, "Impossibile eliminare un backtest in corso")
    await bt_store.delete_run(run_id)
    return {"deleted": run_id}
