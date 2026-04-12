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


# ── Session endpoints ────────────────────────────────────────────────────────

@router.get("/session")
async def get_session(
    phone: str,
    ss: SetupSessionStore = Depends(get_session_store),
):
    """
    Ritorna lo stato della sessione di setup per il numero di telefono.
    Se non esiste risponde {"exists": false}.
    """
    session = await ss.get(phone)
    if session is None:
        return {"exists": False}
    return {"exists": True, **session}


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


# ── MT5 endpoint ─────────────────────────────────────────────────────────────

@router.post("/mt5/verify")
async def verify_mt5(body: MT5VerifyBody):
    """
    Tenta il login a MetaTrader 5 con le credenziali fornite.

    La chiamata è bloccante (libreria MT5 sincrona) quindi viene
    eseguita in un thread pool separato.

    Returns:
        {"valid": true, "account": {"name", "server", "balance", "currency"}}

    Errors:
        503 — libreria MT5 non disponibile (non si è su Windows)
        400 — credenziali errate o MT5 non in esecuzione
    """
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            _mt5_executor,
            _mt5_login_sync,
            body.login,
            body.password,
            body.server,
        )
        return result
    except RuntimeError as exc:
        msg = str(exc)
        status = 503 if "non disponibile" in msg else 400
        raise HTTPException(status, detail=msg)
    except Exception as exc:
        logger.error("verify_mt5: %s", exc)
        raise HTTPException(400, detail=str(exc))


def _mt5_login_sync(login: int, password: str, server: str) -> dict:
    """Eseguita in ThreadPoolExecutor — può bloccare senza problemi."""
    try:
        import MetaTrader5 as mt5
    except ImportError:
        raise RuntimeError(
            "Libreria MetaTrader5 non disponibile su questo server "
            "(richiede Windows con MT5 installato)"
        )

    try:
        if not mt5.initialize():
            code, msg = mt5.last_error()
            raise RuntimeError(f"MT5 non avviabile: {msg} (codice {code})")

        ok = mt5.login(login, password=password, server=server)
        if not ok:
            code, msg = mt5.last_error()
            raise RuntimeError(f"Login fallito: {msg} (codice {code})")

        info = mt5.account_info()
        if info is None:
            raise RuntimeError("Login riuscito ma account_info() ha restituito None")

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
            "user_id":         body.user_id,
            "api_id":          body.api_id,
            "api_hash":        body.api_hash,
            "phone":           body.phone,
            "group_id":        int(body.group_id),
            "group_name":      body.group_name,
            "mt5_login":       body.mt5_login,
            "mt5_password":    mt5_password,
            "mt5_server":      body.mt5_server,
            "sizing_strategy": body.sizing_strategy,
        })

        tm.add_user(
            user_id=body.user_id,
            api_id=body.api_id,
            api_hash=body.api_hash,
            group_id=int(body.group_id),
            login_key=body.login_key,
        )

        # Pulizia della sessione temporanea
        await ss.delete(body.phone)

        logger.info("Setup completato — utente %s attivo", body.user_id)
        return {"status": "active", "user_id": body.user_id}

    except Exception as exc:
        logger.error("complete_setup (%s): %s", body.user_id, exc)
        raise HTTPException(500, detail=str(exc))
