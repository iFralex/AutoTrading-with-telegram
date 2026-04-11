"""
Entry point del server VPS.

Avvio:
    python vps/api/app.py                    # sviluppo
    uvicorn vps.api.app:app --host 0.0.0.0   # produzione (alternativa)

Il Task Scheduler di Windows punta a questo file.
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Rende importabile il package vps.* indipendentemente da dove viene lanciato
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv

# Carica .env nella stessa directory di questo file
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from vps.api.routes.setup import router as setup_router
from vps.services.telegram_manager import TelegramManager
from vps.services.user_store import UserStore

# ── Logging ──────────────────────────────────────────────────────────────────

_bot_dir = Path(os.environ.get("TRADING_BOT_DIR", _ROOT)).resolve()
_log_dir = _bot_dir / "logs"
_log_dir.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(_log_dir / "bot.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

# ── Percorsi dati ─────────────────────────────────────────────────────────────

_sessions_dir = _bot_dir / "sessions"
_db_path      = _bot_dir / "data" / "users.db"

# ── Callback messaggi in arrivo ───────────────────────────────────────────────

async def on_message(
    user_id: str,
    message: str,
    raw_event,
    sender,
) -> None:
    """
    Chiamata da TelegramManager per ogni nuovo messaggio sul gruppo
    dell'utente.

    Qui in futuro verrà:
      1. Parsed dal modulo AI (chiamata a Claude API)
      2. Tradotto in operazione MT5
      3. Inviato al worker MT5 dell'utente
    """
    logger.info(
        "[%s] nuovo messaggio da %s: %s",
        user_id,
        getattr(sender, "first_name", "?"),
        message[:120],
    )
    # TODO: inviare a signal_processor


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    logger.info("Avvio Trading Bot API...")

    # Inizializza il database
    store = UserStore(_db_path)
    await store.init()
    app.state.user_store = store

    # Avvia il TelegramManager (thread dedicato con loop asyncio)
    tm = TelegramManager(sessions_dir=_sessions_dir, on_message=on_message)
    tm.start()
    app.state.telegram_manager = tm

    # Ripristina le sessioni degli utenti già configurati
    active_users = await store.get_active_users()
    if active_users:
        logger.info("Ripristino %d utenti attivi...", len(active_users))
        tm.restore_users(active_users)
    else:
        logger.info("Nessun utente da ripristinare")

    logger.info("Trading Bot API pronta")
    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info("Arresto in corso...")
    tm.stop()
    logger.info("Trading Bot API fermata")


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Trading Bot API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — permette al frontend Next.js di chiamare l'API
_allowed_origins = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(setup_router)


@app.get("/health")
async def health():
    """Endpoint di healthcheck per il monitoring."""
    tm: TelegramManager = app.state.telegram_manager
    return {
        "status": "ok",
        "active_users": len(tm.active_user_ids()),
    }


# ── Avvio diretto ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("API_HOST", "0.0.0.0")
    port = int(os.environ.get("API_PORT", "8000"))

    logger.info("Avvio uvicorn su %s:%d", host, port)
    uvicorn.run(
        "vps.api.app:app",
        host=host,
        port=port,
        reload=False,
        log_config=None,   # usa il logging già configurato sopra
    )
