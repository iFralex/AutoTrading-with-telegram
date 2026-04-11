"""
Route /api/setup/*

Corrispondono passo-passo al wizard Next.js:

  POST /api/setup/telegram/request-code   → step 3a: invia OTP
  POST /api/setup/telegram/verify-code    → step 3b: verifica OTP
  POST /api/setup/telegram/verify-password → step 3b 2FA
  GET  /api/setup/telegram/groups         → step 4:  lista gruppi
  POST /api/setup/complete                → step 5:  salva tutto e avvia listener
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from vps.services.telegram_manager import PasswordRequiredError, TelegramManager
from vps.services.user_store import UserStore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/setup", tags=["setup"])


# ── Dependency helpers ───────────────────────────────────────────────────────

def get_telegram(request: Request) -> TelegramManager:
    return request.app.state.telegram_manager


def get_store(request: Request) -> UserStore:
    return request.app.state.user_store


# ── Modelli request/response ─────────────────────────────────────────────────

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


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/telegram/request-code")
async def request_code(
    body: RequestCodeBody,
    tm: TelegramManager = Depends(get_telegram),
):
    """
    Invia il codice OTP al numero di telefono fornito.
    Ritorna un login_key da usare nei passi successivi.
    """
    try:
        result = tm.request_code(body.api_id, body.api_hash, body.phone)
        return result
    except Exception as exc:
        logger.error("request_code fallito: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/telegram/verify-code")
async def verify_code(
    body: VerifyCodeBody,
    tm: TelegramManager = Depends(get_telegram),
):
    """
    Verifica il codice OTP.

    In caso di 2FA ritorna {"error": "2fa_required", "login_key": "..."}
    con status 202 (il client deve chiamare /verify-password).
    """
    try:
        result = tm.verify_code(body.login_key, body.code)
        return result
    except PasswordRequiredError as exc:
        return {"error": "2fa_required", "login_key": exc.login_key}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.error("verify_code fallito: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/telegram/verify-password")
async def verify_password(
    body: VerifyPasswordBody,
    tm: TelegramManager = Depends(get_telegram),
):
    """Completa il login 2FA con la password cloud di Telegram."""
    try:
        result = tm.verify_password(body.login_key, body.password)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.error("verify_password fallito: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/telegram/groups")
async def get_groups(
    login_key: str,
    tm: TelegramManager = Depends(get_telegram),
):
    """
    Ritorna i gruppi e canali dell'utente autenticato.
    Richiede che verify_code abbia avuto successo con questo login_key.
    """
    try:
        groups = tm.get_groups(login_key)
        return {"groups": groups}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.error("get_groups fallito: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/complete")
async def complete_setup(
    body: CompleteSetupBody,
    tm: TelegramManager = Depends(get_telegram),
    store: UserStore = Depends(get_store),
):
    """
    Finalizza il setup:
    1. Salva l'utente nel database
    2. Avvia il listener Telegram sul gruppo selezionato
    """
    try:
        # Salva nel DB
        await store.upsert(
            {
                "user_id":      body.user_id,
                "api_id":       body.api_id,
                "api_hash":     body.api_hash,
                "phone":        body.phone,
                "group_id":     int(body.group_id),
                "group_name":   body.group_name,
                "mt5_login":    body.mt5_login,
                "mt5_password": body.mt5_password,
                "mt5_server":   body.mt5_server,
            }
        )

        # Avvia il listener
        tm.add_user(
            user_id=body.user_id,
            api_id=body.api_id,
            api_hash=body.api_hash,
            group_id=int(body.group_id),
            login_key=body.login_key,
        )

        logger.info("Setup completato per utente %s", body.user_id)
        return {"status": "active", "user_id": body.user_id}

    except Exception as exc:
        logger.error("complete_setup fallito per %s: %s", body.user_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))
