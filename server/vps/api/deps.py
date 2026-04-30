"""Shared FastAPI dependencies."""
from __future__ import annotations

import os

import jwt
from fastapi import Depends, HTTPException, Request


def _secret() -> str:
    s = os.environ.get("JWT_SECRET", "")
    if not s:
        raise RuntimeError("JWT_SECRET env var non impostata")
    return s


async def require_auth(request: Request) -> str:
    """Verifica sf_access cookie e ritorna il phone dell'utente autenticato."""
    token = request.cookies.get("sf_access")
    if not token:
        raise HTTPException(401, "Non autenticato")
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"])
        if payload.get("type") != "access":
            raise HTTPException(401, "Tipo token non valido")
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token scaduto")
    except jwt.PyJWTError:
        raise HTTPException(401, "Token non valido")


async def get_current_user(
    request: Request,
    phone: str = Depends(require_auth),
) -> dict:
    """Ritorna il dict utente dal token JWT. Lancia 404 se non trovato."""
    store = request.app.state.user_store
    user = await store.get_user_by_phone(phone)
    if user is None:
        raise HTTPException(404, "Utente non trovato")
    return user
