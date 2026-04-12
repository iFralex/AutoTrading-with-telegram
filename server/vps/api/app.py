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
from vps.services.signal_processor import SignalProcessor
from vps.services.mt5_trader import MT5Trader

# ── Logging ───────────────────────────────────────────────────────────────────

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

_sessions_dir    = _bot_dir / "sessions"
_db_path         = _bot_dir / "data" / "users.db"
_mt5_template    = _bot_dir / "mt5_template"
_mt5_users_dir   = _bot_dir / "mt5_users"


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    logger.info("Avvio Trading Bot API...")

    # Database
    store = UserStore(_db_path)
    await store.init()
    app.state.user_store = store

    # Gemini signal processor (opzionale: se la chiave non è configurata
    # i messaggi vengono loggati ma non processati)
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    if gemini_key:
        signal_processor = SignalProcessor(api_key=gemini_key)
        logger.info("SignalProcessor attivo (Gemini)")
    else:
        signal_processor = None
        logger.warning(
            "GEMINI_API_KEY non configurata — i segnali non verranno processati"
        )

    # MT5 trader
    default_lot = float(os.environ.get("DEFAULT_LOT_SIZE", "0.01"))
    mt5_trader = MT5Trader(
        mt5_template_dir=_mt5_template,
        mt5_users_dir=_mt5_users_dir,
        default_lot=default_lot,
    )

    # Telegram manager
    async def on_message(user_id: str, message: str, raw_event, sender) -> None:
        sender_name = getattr(sender, "first_name", None) or getattr(sender, "title", "?")
        logger.info("[%s] messaggio da %s: %.120s", user_id, sender_name, message)

        if signal_processor is None:
            return

        # ── Step 1+2: classifica ed estrae segnali ────────────────────────────
        signals = await signal_processor.process(message)
        if not signals:
            return

        # ── Step 3: recupera credenziali MT5 dal DB ───────────────────────────
        user = await store.get_user(user_id)
        if user is None:
            logger.error("Utente %s non trovato nel DB — skip", user_id)
            return

        mt5_login    = user.get("mt5_login")
        mt5_password = user.get("mt5_password")   # già decifrata da UserStore
        mt5_server   = user.get("mt5_server")

        if not all([mt5_login, mt5_password, mt5_server]):
            logger.warning(
                "Utente %s: credenziali MT5 mancanti — skip esecuzione", user_id
            )
            return

        # ── Step 4: esegui gli ordini su MT5 ─────────────────────────────────
        results = await mt5_trader.execute_signals(
            user_id      = user_id,
            signals      = signals,
            mt5_login    = int(mt5_login),
            mt5_password = mt5_password,
            mt5_server   = mt5_server,
        )

        ok  = sum(1 for r in results if r.success)
        err = sum(1 for r in results if not r.success)
        logger.info(
            "Utente %s: %d ordini OK, %d falliti su %d segnali",
            user_id, ok, err, len(signals),
        )

    tm = TelegramManager(sessions_dir=_sessions_dir, on_message=on_message)
    tm.start()
    app.state.telegram_manager = tm

    # Ripristina sessioni al boot
    active_users = await store.get_active_users()
    if active_users:
        logger.info("Ripristino %d utenti attivi...", len(active_users))
        tm.restore_users(active_users)
    else:
        logger.info("Nessun utente da ripristinare")

    logger.info("Trading Bot API pronta")
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("Arresto in corso...")
    tm.stop()
    logger.info("Trading Bot API fermata")


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Trading Bot API",
    version="0.1.0",
    lifespan=lifespan,
)

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
        log_config=None,
    )
