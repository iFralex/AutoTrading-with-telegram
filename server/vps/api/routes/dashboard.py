"""
Dashboard API — dati di debug per utente (ricerca per numero di telefono).

Endpoints:
  GET /api/dashboard/user?phone={phone}
      Ritorna le info dell'utente registrato + i log segnali più recenti.

  GET /api/dashboard/logs?user_id={user_id}&limit=50&offset=0
      Paginazione dei log segnali (per infinite-scroll nel frontend).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


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
