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
from vps.api.routes.dashboard import router as dashboard_router
from vps.services.telegram_manager import TelegramManager
from vps.services.user_store import UserStore
from vps.services.setup_session_store import SetupSessionStore
from vps.services.signal_processor import SignalProcessor
from vps.services.mt5_trader import MT5Trader
from vps.services.mt5_range_watcher import RangeOrderWatcher, WatchedOrder
from vps.services.mt5_position_watcher import PositionWatcher
from vps.services.signal_log_store import SignalLogStore
from vps.services.strategy_executor import StrategyExecutor, PreTradeDecision
from vps.services.strategy_log_store import StrategyLogStore
from vps.services.closed_trade_store import ClosedTradeStore
from vps.services.ai_log_store import AILogStore

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
_sessions_db     = _bot_dir / "data" / "setup_sessions.db"
_mt5_template    = _bot_dir / "mt5_template"
_mt5_users_dir   = _bot_dir / "mt5_users"


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    logger.info("Avvio Trading Bot API...")

    # Database utenti
    store = UserStore(_db_path)
    await store.init()
    app.state.user_store = store

    # Database sessioni di setup temporanee
    session_store = SetupSessionStore(_sessions_db)
    await session_store.init()
    app.state.setup_session_store = session_store

    # Log segnali (stessa users.db)
    signal_log_store = SignalLogStore(_db_path)
    await signal_log_store.init()
    app.state.signal_log_store = signal_log_store

    # Log esecuzioni strategia (stessa users.db)
    strategy_log_store = StrategyLogStore(_db_path)
    await strategy_log_store.init()
    app.state.strategy_log_store = strategy_log_store

    # Storico operazioni chiuse su MT5 (stessa users.db)
    closed_trade_store = ClosedTradeStore(_db_path)
    await closed_trade_store.init()
    app.state.closed_trade_store = closed_trade_store

    # Log chiamate AI (stessa users.db)
    ai_log_store = AILogStore(_db_path)
    await ai_log_store.init()
    app.state.ai_log_store = ai_log_store

    # Gemini signal processor (opzionale: se la chiave non è configurata
    # i messaggi vengono loggati ma non processati)
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    if gemini_key:
        signal_processor = SignalProcessor(api_key=gemini_key)
        signal_processor.set_ai_log_store(ai_log_store)
        logger.info("SignalProcessor attivo (Gemini)")
    else:
        signal_processor = None
        logger.warning(
            "GEMINI_API_KEY non configurata — i segnali non verranno processati"
        )
    app.state.signal_processor = signal_processor

    # MT5 trader
    default_lot = float(os.environ.get("DEFAULT_LOT_SIZE", "0.01"))
    mt5_trader = MT5Trader(
        mt5_template_dir=_mt5_template,
        mt5_users_dir=_mt5_users_dir,
        default_lot=default_lot,
    )
    app.state.mt5_trader = mt5_trader

    # Strategy executor (opzionale: stessa chiave Gemini del signal processor)
    if gemini_key:
        strategy_executor = StrategyExecutor(api_key=gemini_key, mt5_trader=mt5_trader)
        strategy_executor.set_ai_log_store(ai_log_store)
        logger.info("StrategyExecutor attivo (Gemini)")
    else:
        strategy_executor = None
        logger.warning("StrategyExecutor non attivo (GEMINI_API_KEY mancante)")

    # Range order watcher
    range_watcher = RangeOrderWatcher()
    range_watcher.start()

    # ── Position watcher + callback al StrategyExecutor ──────────────────────
    async def on_position_event(user_id: str, event_type: str, event_data: dict) -> None:
        """
        Callback invocato dal PositionWatcher quando rileva un cambiamento di posizione.
        Salva SEMPRE le posizioni chiuse nel DB (per le statistiche di performance),
        poi delega al StrategyExecutor se l'utente ha una management_strategy configurata.
        """
        # ── Salva sempre ogni chiusura per le statistiche ─────────────────────
        if event_type == "position_closed":
            try:
                await closed_trade_store.insert(user_id=user_id, event_data=event_data)
            except Exception as exc:
                logger.warning("closed_trade_store.insert utente %s: %s", user_id, exc)

        if strategy_executor is None:
            return

        user = await store.get_user(user_id)
        if user is None:
            return

        management_strategy = user.get("management_strategy") or ""
        if not management_strategy.strip():
            return

        mt5_login    = user.get("mt5_login")
        mt5_password = user.get("mt5_password")
        mt5_server   = user.get("mt5_server")
        if not (mt5_login and mt5_password and mt5_server):
            return

        logger.info(
            "StrategyExecutor utente %s: evento %s — avvio agent...",
            user_id, event_type,
        )

        try:
            result = await strategy_executor.on_event(
                user_id             = user_id,
                event_type          = event_type,
                event_data          = event_data,
                management_strategy = management_strategy,
                mt5_login           = int(mt5_login),
                mt5_password        = mt5_password,
                mt5_server          = mt5_server,
            )
        except Exception as exc:
            logger.error("StrategyExecutor on_event errore: %s", exc, exc_info=True)
            await strategy_log_store.insert(
                user_id             = user_id,
                event_type          = event_type,
                event_data          = event_data,
                management_strategy = management_strategy,
                error_msg           = str(exc),
            )
            return

        logger.info(
            "StrategyExecutor utente %s: %s completato — %d tool call, risposta: %.120s",
            user_id, event_type,
            len(result.tool_calls),
            result.final_response,
        )

        await strategy_log_store.insert(
            user_id             = user_id,
            event_type          = event_type,
            event_data          = event_data,
            management_strategy = management_strategy,
            tool_calls          = result.tool_calls,
            final_response      = result.final_response,
            error_msg           = result.error,
        )

    position_watcher = PositionWatcher(
        mt5_trader = mt5_trader,
        on_event   = on_position_event,
    )
    position_watcher.start()

    # Telegram manager
    async def on_message(user_id: str, message: str, raw_event, sender) -> None:
        import uuid
        from dataclasses import asdict
        sender_name = getattr(sender, "first_name", None) or getattr(sender, "title", "?")
        logger.info("[%s] messaggio da %s: %.120s", user_id, sender_name, message)
        signal_group_id = str(uuid.uuid4())[:8]   # ID univoco per correlare le posizioni del gruppo

        # Estrai il message_id Telegram per poter rilevare eliminazioni future
        telegram_message_id: int | None = None
        try:
            telegram_message_id = raw_event.message.id
        except Exception:
            pass

        # Variabili log — costruite step by step e salvate alla fine
        log_is_signal       = False
        log_flash_raw:       str | None  = None
        log_has_mt5_creds                = False
        log_sizing_strategy: str | None  = None
        log_account_info:    dict | None = None
        log_signals:         list | None = None
        log_results:         list | None = None
        log_error_step:      str | None  = None
        log_error_msg:       str | None  = None

        async def _save_log() -> None:
            await signal_log_store.insert(
                user_id              = user_id,
                sender_name          = sender_name,
                message_text         = message,
                is_signal            = log_is_signal,
                flash_raw            = log_flash_raw,
                has_mt5_creds        = log_has_mt5_creds,
                sizing_strategy      = log_sizing_strategy,
                account_info         = log_account_info,
                signals              = log_signals,
                results              = log_results,
                error_step           = log_error_step,
                error_msg            = log_error_msg,
                telegram_message_id  = telegram_message_id,
                signal_group_id      = signal_group_id if log_is_signal else None,
            )

        if signal_processor is None:
            await _save_log()
            return

        # ── Step 1: rilevamento rapido (Flash) — prima di aprire MT5 ─────────
        try:
            flash_result = await signal_processor._detect(message, user_id=user_id)
            log_flash_raw = "YES" if flash_result else "NO"
            log_is_signal = flash_result
        except Exception as exc:
            logger.error("Gemini Flash errore: %s", exc)
            log_error_step = "flash"
            log_error_msg  = str(exc)
            await _save_log()
            return

        if not log_is_signal:
            logger.debug("Messaggio classificato come non-segnale (Flash)")
            await _save_log()
            return

        logger.info("Segnale rilevato — recupero credenziali utente %s...", user_id)

        # ── Step 2: recupera credenziali MT5 dal DB ───────────────────────────
        user = await store.get_user(user_id)
        if user is None:
            logger.error("Utente %s non trovato nel DB — skip", user_id)
            log_error_step = "db_lookup"
            log_error_msg  = f"Utente {user_id} non trovato nel DB"
            await _save_log()
            return

        mt5_login           = user.get("mt5_login")
        mt5_password        = user.get("mt5_password")   # già decifrata da UserStore
        mt5_server          = user.get("mt5_server")
        log_sizing_strategy     = user.get("sizing_strategy") or None
        management_strategy     = user.get("management_strategy") or None
        extraction_instructions = user.get("extraction_instructions") or None
        range_entry_pct     = int(user.get("range_entry_pct") or 0)
        entry_if_favorable  = bool(user.get("entry_if_favorable"))
        logger.info("Utente %s: range_entry_pct=%d%%, entry_if_favorable=%s", user_id, range_entry_pct, entry_if_favorable)

        log_has_mt5_creds = bool(mt5_login and mt5_password and mt5_server)
        if not log_has_mt5_creds:
            logger.warning(
                "Utente %s: credenziali MT5 mancanti — skip esecuzione", user_id
            )
            log_error_step = "mt5_creds"
            log_error_msg  = "Credenziali MT5 mancanti (login/password/server)"
            await _save_log()
            return

        # ── Step 3: recupera info conto per il calcolo sizing ─────────────────
        if log_sizing_strategy:
            try:
                log_account_info = await mt5_trader.get_account_info(
                    user_id      = user_id,
                    mt5_login    = int(mt5_login),
                    mt5_password = mt5_password,
                    mt5_server   = mt5_server,
                )
            except Exception as exc:
                logger.warning("Utente %s: account_info fallita: %s", user_id, exc)
                log_account_info = None

            if log_account_info is None:
                logger.warning(
                    "Utente %s: account_info non disponibile — sizing senza contesto conto",
                    user_id,
                )

        # ── Step 4: extraction strutturata (Pro) con contesto sizing ──────────
        try:
            signals = await signal_processor.extract_signals(
                message,
                sizing_strategy=log_sizing_strategy,
                account_info=log_account_info,
                user_id=user_id,
                extraction_instructions=extraction_instructions,
            )
        except Exception as exc:
            logger.error("Gemini Pro errore: %s", exc)
            log_error_step = "extraction"
            log_error_msg  = str(exc)
            await _save_log()
            return

        if not signals:
            log_error_step = "extraction"
            log_error_msg  = "Gemini Pro non ha estratto segnali validi"
            await _save_log()
            return

        log_signals = [asdict(s) for s in signals]

        # ── Step 5 (opzionale): filtro pre-trade con StrategyExecutor ─────────
        if strategy_executor and management_strategy:
            try:
                decisions = await strategy_executor.pre_trade(
                    user_id             = user_id,
                    signals             = signals,
                    management_strategy = management_strategy,
                    mt5_login           = int(mt5_login),
                    mt5_password        = mt5_password,
                    mt5_server          = mt5_server,
                    signal_message      = message,
                )
                await strategy_log_store.insert(
                    user_id             = user_id,
                    event_type          = "pre_trade",
                    management_strategy = management_strategy,
                    signals             = log_signals,
                    decisions           = [
                        {
                            "signal_index":  d.signal_index,
                            "approved":      d.approved,
                            "modified_lots": d.modified_lots,
                            "modified_sl":   d.modified_sl,
                            "modified_tp":   d.modified_tp,
                            "reason":        d.reason,
                        }
                        for d in decisions
                    ],
                )
                # Applica le decisioni: rimuovi i rifiutati, applica le modifiche
                approved_signals = []
                for i, sig in enumerate(signals):
                    dec = decisions[i] if i < len(decisions) else None
                    if dec is None or dec.approved:
                        if dec and (dec.modified_lots is not None
                                    or dec.modified_sl  is not None
                                    or dec.modified_tp  is not None):
                            from dataclasses import replace as dc_replace
                            sig = dc_replace(
                                sig,
                                lot_size    = dec.modified_lots if dec.modified_lots is not None else sig.lot_size,
                                stop_loss   = dec.modified_sl   if dec.modified_sl   is not None else sig.stop_loss,
                                take_profit = dec.modified_tp   if dec.modified_tp   is not None else sig.take_profit,
                            )
                        approved_signals.append(sig)
                    else:
                        logger.info(
                            "StrategyExecutor utente %s: segnale [%d] rifiutato — %s",
                            user_id, i, dec.reason,
                        )

                if not approved_signals:
                    logger.info(
                        "StrategyExecutor utente %s: tutti i segnali rifiutati dalla strategia",
                        user_id,
                    )
                    log_error_step = "strategy_pretrade"
                    log_error_msg  = "Tutti i segnali rifiutati dalla management_strategy"
                    await _save_log()
                    return

                signals     = approved_signals
                log_signals = [asdict(s) for s in signals]

            except Exception as exc:
                logger.error("StrategyExecutor pre_trade errore: %s", exc, exc_info=True)
                # Non blocchiamo l'esecuzione se lo strategy executor fallisce

        # ── Step 6: esegui gli ordini su MT5 ─────────────────────────────────
        try:
            results = await mt5_trader.execute_signals(
                user_id         = user_id,
                signals         = signals,
                mt5_login       = int(mt5_login),
                mt5_password    = mt5_password,
                mt5_server      = mt5_server,
                signal_group_id = signal_group_id,
                range_entry_pct    = range_entry_pct,
                entry_if_favorable = entry_if_favorable,
            )
        except Exception as exc:
            logger.error("MT5 execute_signals errore: %s", exc)
            log_error_step = "mt5_execute"
            log_error_msg  = str(exc)
            await _save_log()
            return

        ok  = sum(1 for r in results if r.success)
        err = sum(1 for r in results if not r.success)
        logger.info(
            "Utente %s: %d ordini OK, %d falliti su %d segnali",
            user_id, ok, err, len(signals),
        )

        log_results = [
            {
                "success":    r.success,
                "order_id":   r.order_id,
                "error":      r.error,
                "signal":     asdict(r.signal) if r.signal else None,
            }
            for r in results
        ]

        await _save_log()

        # ── Step 7: registra ordini range nel watcher ─────────────────────────
        for result in results:
            sig = result.signal
            if (
                result.success
                and result.order_id is not None
                and sig is not None
                and isinstance(sig.entry_price, list)
            ):
                range_watcher.add(WatchedOrder(
                    ticket       = result.order_id,
                    symbol       = sig.symbol,
                    order_type   = sig.order_type,
                    sl           = sig.stop_loss,
                    tp           = sig.take_profit,
                    user_id      = user_id,
                    user_dir     = _mt5_users_dir / user_id,
                    mt5_login    = int(mt5_login),
                    mt5_password = mt5_password,
                    mt5_server   = mt5_server,
                ))

    async def on_message_deleted(user_id: str, deleted_ids: list[int]) -> None:
        """
        Callback invocato quando uno o più messaggi vengono eliminati dal gruppo.
        Per ogni message_id eliminato: verifica se era un segnale, recupera le
        posizioni correlate e delega all'AI tramite deletion_strategy.
        """
        if strategy_executor is None:
            return

        for msg_id in deleted_ids:
            # Cerca il log del messaggio eliminato
            log_entry = await signal_log_store.get_by_telegram_message_id(user_id, msg_id)
            if log_entry is None or not log_entry.get("is_signal"):
                continue  # Non era un segnale tracciato

            sig_group_id = log_entry.get("signal_group_id")
            logger.info(
                "Messaggio #%d eliminato per utente %s — era un segnale (group=%s)",
                msg_id, user_id, sig_group_id,
            )

            # Recupera la deletion_strategy dell'utente
            user = await store.get_user(user_id)
            if user is None:
                continue

            deletion_strategy = user.get("deletion_strategy") or ""
            if not deletion_strategy.strip():
                logger.debug(
                    "Utente %s: deletion_strategy non configurata — skip messaggio eliminato #%d",
                    user_id, msg_id,
                )
                continue

            mt5_login    = user.get("mt5_login")
            mt5_password = user.get("mt5_password")
            mt5_server   = user.get("mt5_server")
            if not (mt5_login and mt5_password and mt5_server):
                continue

            event_data = {
                "telegram_message_id": msg_id,
                "signal_group_id":     sig_group_id,
                "message_text":        log_entry.get("message_text"),
                "signals_json":        log_entry.get("signals_json"),
            }

            logger.info(
                "StrategyExecutor utente %s: evento message_deleted (msg #%d) — avvio agent...",
                user_id, msg_id,
            )

            try:
                result = await strategy_executor.on_event(
                    user_id             = user_id,
                    event_type          = "message_deleted",
                    event_data          = event_data,
                    management_strategy = deletion_strategy,
                    mt5_login           = int(mt5_login),
                    mt5_password        = mt5_password,
                    mt5_server          = mt5_server,
                )
            except Exception as exc:
                logger.error(
                    "StrategyExecutor on_event message_deleted errore: %s", exc, exc_info=True
                )
                await strategy_log_store.insert(
                    user_id             = user_id,
                    event_type          = "message_deleted",
                    event_data          = event_data,
                    management_strategy = deletion_strategy,
                    error_msg           = str(exc),
                )
                continue

            logger.info(
                "StrategyExecutor utente %s: message_deleted completato — %d tool call",
                user_id, len(result.tool_calls),
            )

            await strategy_log_store.insert(
                user_id             = user_id,
                event_type          = "message_deleted",
                event_data          = event_data,
                management_strategy = deletion_strategy,
                tool_calls          = result.tool_calls,
                final_response      = result.final_response,
                error_msg           = result.error,
            )

    tm = TelegramManager(
        sessions_dir = _sessions_dir,
        on_message   = on_message,
        on_delete    = on_message_deleted,
    )
    tm.start()
    app.state.telegram_manager = tm

    # Ripristina sessioni al boot
    active_users = await store.get_active_users()
    if active_users:
        logger.info("Ripristino %d utenti attivi...", len(active_users))
        tm.restore_users(active_users)
        # Registra gli utenti nel PositionWatcher (solo quelli con management_strategy)
        for u in active_users:
            position_watcher.register_user(u["user_id"], u)
    else:
        logger.info("Nessun utente da ripristinare")

    logger.info("Trading Bot API pronta")
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("Arresto in corso...")
    await range_watcher.stop()
    await position_watcher.stop()
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
app.include_router(dashboard_router)


@app.get("/health")
async def health():
    tm: TelegramManager = app.state.telegram_manager
    return {
        "status": "ok",
        "active_users": len(tm.active_user_ids()),
    }


# ── Utilità avvio ─────────────────────────────────────────────────────────────

def _free_port_if_occupied(host: str, port: int) -> None:
    """
    Controlla se la porta è già occupata e, in caso, termina il processo
    che la sta usando (utile quando il Task Scheduler rilancia il bot
    mentre un'istanza precedente è ancora in esecuzione).
    """
    import socket
    import subprocess
    import sys

    check_host = "127.0.0.1" if host == "0.0.0.0" else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        if sock.connect_ex((check_host, port)) != 0:
            return  # porta libera

    logger.warning("Porta %d già in uso — cerco il processo da terminare...", port)

    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                ["netstat", "-ano"], text=True, errors="replace"
            )
            pid = None
            for line in out.splitlines():
                cols = line.split()
                # formato: Proto  Indirizzo_locale  Indirizzo_remoto  Stato  PID
                if len(cols) >= 5 and f":{port}" in cols[1] and cols[3] == "LISTENING":
                    candidate = int(cols[-1])
                    if candidate != os.getpid():
                        pid = candidate
                        break
            if pid:
                subprocess.run(["taskkill", "/PID", str(pid), "/F"], check=True)
                logger.info("Processo %d terminato — porta %d liberata", pid, port)
            else:
                logger.warning(
                    "Nessun processo esterno trovato in ascolto sulla porta %d", port
                )
        except Exception as exc:
            logger.error("Impossibile liberare la porta %d: %s", port, exc)
    else:
        try:
            import signal as _signal
            out = subprocess.check_output(
                ["lsof", "-t", f"-i:{port}"], text=True, errors="replace"
            ).strip()
            for pid_str in out.splitlines():
                pid = int(pid_str.strip())
                if pid != os.getpid():
                    os.kill(pid, _signal.SIGTERM)
                    logger.info("Processo %d terminato — porta %d liberata", pid, port)
        except Exception as exc:
            logger.error("Impossibile liberare la porta %d: %s", port, exc)


# ── Avvio diretto ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("API_HOST", "0.0.0.0")
    port = int(os.environ.get("API_PORT", "8000"))

    _free_port_if_occupied(host, port)

    logger.info("Avvio uvicorn su %s:%d", host, port)
    uvicorn.run(
        "vps.api.app:app",
        host=host,
        port=port,
        reload=False,
        log_config=None,
    )
