"""
Auth routes — gestione password e JWT.

POST /api/auth/set-password  — imposta password dopo setup completato
POST /api/auth/login         — phone + password → cookie JWT
POST /api/auth/refresh       — refresh cookie → nuovo access token (sliding window)
POST /api/auth/logout        — cancella cookie + invalida refresh token
GET  /api/auth/me            — ritorna utente corrente dal token
POST /api/auth/forgot        — invia OTP Telegram per recupero password
POST /api/auth/recover       — verifica OTP + imposta nuova password → cookie JWT
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from vps.api.deps import require_auth
from vps.services.auth_store import AuthStore
from vps.services.user_store import UserStore
from vps.services.signal_log_store import SignalLogStore
from vps.services.telegram_manager import TelegramManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

ACCESS_TTL  = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=7)   # sliding window: ogni refresh lo rinnova


# ── Helpers JWT ───────────────────────────────────────────────────────────────

def _secret() -> str:
    s = os.environ.get("JWT_SECRET", "")
    if not s:
        raise RuntimeError("JWT_SECRET env var non impostata")
    return s


def _make_access(phone: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": phone, "type": "access", "iat": now, "exp": now + ACCESS_TTL},
        _secret(),
        algorithm="HS256",
    )


def _make_refresh(phone: str) -> tuple[str, str]:
    """Ritorna (token_str, jti)."""
    jti = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": phone, "jti": jti, "type": "refresh", "iat": now, "exp": now + REFRESH_TTL},
        _secret(),
        algorithm="HS256",
    )
    return token, jti


def _cookie_secure() -> bool:
    return os.environ.get("COOKIE_SECURE", "false").lower() == "true"


def _set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    secure = _cookie_secure()
    kw = dict(httponly=True, secure=secure, samesite="lax", path="/")
    response.set_cookie("sf_access",  access,  max_age=int(ACCESS_TTL.total_seconds()),  **kw)
    response.set_cookie("sf_refresh", refresh, max_age=int(REFRESH_TTL.total_seconds()), **kw)
    # Cookie non-httpOnly: letto dal middleware Next.js per redirect UX
    response.set_cookie(
        "sf_logged_in", "1",
        max_age=int(REFRESH_TTL.total_seconds()),
        httponly=False, secure=secure, samesite="lax", path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    for name in ("sf_access", "sf_refresh", "sf_logged_in"):
        response.delete_cookie(name, path="/")


# ── Dipendenze FastAPI ────────────────────────────────────────────────────────

def _get_auth(request: Request) -> AuthStore:
    return request.app.state.auth_store

def _get_store(request: Request) -> UserStore:
    return request.app.state.user_store

def _get_logs(request: Request) -> SignalLogStore:
    return request.app.state.signal_log_store

def _get_telegram(request: Request) -> TelegramManager:
    return request.app.state.telegram_manager


# require_auth è definito in vps.api.deps e importato sopra


# ── Endpoint: set-password ────────────────────────────────────────────────────

class SetPasswordBody(BaseModel):
    phone: str
    password: str
    user_id: str  # prova che il setup è stato completato

@router.post("/set-password")
async def set_password(
    body: SetPasswordBody,
    response: Response,
    auth: AuthStore = Depends(_get_auth),
    store: UserStore = Depends(_get_store),
) -> dict:
    if len(body.password) < 8:
        raise HTTPException(400, "La password deve essere di almeno 8 caratteri")
    user = await store.get_user_by_phone(body.phone)
    if user is None or user["user_id"] != body.user_id:
        raise HTTPException(403, "Setup non completato o dati non corrispondenti")
    await auth.set_password(body.phone, body.password)
    access = _make_access(body.phone)
    refresh, jti = _make_refresh(body.phone)
    await auth.store_refresh_jti(body.phone, jti)
    _set_auth_cookies(response, access, refresh)
    return {"status": "ok"}


# ── Endpoint: login ───────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    phone: str
    password: str

@router.post("/login")
async def login(
    body: LoginBody,
    response: Response,
    auth: AuthStore = Depends(_get_auth),
) -> dict:
    ok = await auth.verify_password(body.phone, body.password)
    if not ok:
        raise HTTPException(401, "Numero di telefono o password errati")
    access = _make_access(body.phone)
    refresh, jti = _make_refresh(body.phone)
    await auth.store_refresh_jti(body.phone, jti)
    _set_auth_cookies(response, access, refresh)
    return {"status": "ok"}


# ── Endpoint: refresh ─────────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh_token(
    request: Request,
    response: Response,
    auth: AuthStore = Depends(_get_auth),
) -> dict:
    token = request.cookies.get("sf_refresh")
    if not token:
        raise HTTPException(401, "Nessun refresh token")
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"])
        if payload.get("type") != "refresh":
            raise HTTPException(401, "Tipo token non valido")
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Refresh token scaduto")
    except jwt.PyJWTError:
        raise HTTPException(401, "Refresh token non valido")

    phone = payload["sub"]
    jti   = payload["jti"]
    stored = await auth.get_refresh_jti(phone)
    if stored != jti:
        raise HTTPException(401, "Refresh token revocato")

    # Sliding window: emetti nuovi token e ruota il refresh JTI
    access = _make_access(phone)
    new_refresh, new_jti = _make_refresh(phone)
    await auth.store_refresh_jti(phone, new_jti)
    _set_auth_cookies(response, access, new_refresh)
    return {"status": "ok"}


# ── Endpoint: logout ──────────────────────────────────────────────────────────

@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    auth: AuthStore = Depends(_get_auth),
) -> dict:
    token = request.cookies.get("sf_refresh")
    if token:
        try:
            payload = jwt.decode(token, _secret(), algorithms=["HS256"])
            await auth.clear_refresh_jti(payload.get("sub", ""))
        except Exception:
            pass
    _clear_auth_cookies(response)
    return {"status": "ok"}


# ── Endpoint: me ──────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(
    phone: str = Depends(require_auth),
    store: UserStore = Depends(_get_store),
    log_store: SignalLogStore = Depends(_get_logs),
) -> dict:
    user = await store.get_user_by_phone(phone)
    if user is None:
        raise HTTPException(404, "Utente non trovato")
    user_safe = {k: v for k, v in user.items() if k != "mt5_password"}
    logs  = await log_store.get_by_user_id(user["user_id"], limit=50, offset=0)
    total = await log_store.count_by_user_id(user["user_id"])
    return {"user": user_safe, "logs": logs, "total_logs": total}


# ── Endpoint: forgot ──────────────────────────────────────────────────────────

class ForgotBody(BaseModel):
    phone: str

@router.post("/forgot")
async def forgot_password(
    body: ForgotBody,
    auth: AuthStore = Depends(_get_auth),
    store: UserStore = Depends(_get_store),
    tm: TelegramManager = Depends(_get_telegram),
) -> dict:
    if not await auth.has_password(body.phone):
        raise HTTPException(404, "Nessun account trovato per questo numero")
    user = await store.get_user_by_phone(body.phone)
    if user is None:
        raise HTTPException(404, "Nessun account trovato per questo numero")
    try:
        result = tm.request_code(user["api_id"], user["api_hash"], body.phone)
        return {"login_key": result["login_key"]}
    except Exception as exc:
        logger.error("forgot_password (%s): %s", body.phone, exc)
        raise HTTPException(500, "Impossibile inviare il codice Telegram")


# ── Endpoint: recover ─────────────────────────────────────────────────────────

class RecoverBody(BaseModel):
    phone: str
    otp: str
    new_password: str
    login_key: str

@router.post("/recover")
async def recover_password(
    body: RecoverBody,
    response: Response,
    auth: AuthStore = Depends(_get_auth),
    tm: TelegramManager = Depends(_get_telegram),
) -> dict:
    if len(body.new_password) < 8:
        raise HTTPException(400, "La password deve essere di almeno 8 caratteri")
    try:
        tm.verify_code(body.login_key, body.otp)
    except Exception as exc:
        raise HTTPException(400, f"Codice non valido: {exc}")
    await auth.set_password(body.phone, body.new_password)
    await auth.clear_refresh_jti(body.phone)  # invalida tutte le sessioni esistenti
    access = _make_access(body.phone)
    refresh, jti = _make_refresh(body.phone)
    await auth.store_refresh_jti(body.phone, jti)
    _set_auth_cookies(response, access, refresh)
    return {"status": "ok"}
