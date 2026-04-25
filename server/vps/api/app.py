"""
Entry point del server VPS.

Avvio:
    python vps/api/app.py                    # sviluppo
    uvicorn vps.api.app:app --host 0.0.0.0   # produzione (alternativa)

Il Task Scheduler di Windows punta a questo file.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
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
from vps.api.routes.backtest import router as backtest_router
from vps.services.telegram_manager import TelegramManager
from vps.services.user_store import UserStore
from vps.services.setup_session_store import SetupSessionStore
from vps.services.signal_processor import SignalProcessor
from vps.services.mt5_trader import MT5Trader
from vps.services.mt5_range_watcher import RangeOrderWatcher, WatchedOrder
from vps.services.mt5_position_watcher import PositionWatcher
from vps.services.mt5_price_watcher import PriceLevelWatcher, WatchedPriceLevel
from vps.services.signal_log_store import SignalLogStore
from vps.services.strategy_executor import StrategyExecutor, PreTradeDecision
from vps.services.strategy_log_store import StrategyLogStore
from vps.services.closed_trade_store import ClosedTradeStore
from vps.services.ai_log_store import AILogStore
from vps.services.backtest_store import BacktestStore
from vps.services.backtest_engine import BacktestEngine
from vps.services.vps_monitor import VpsMonitor
from vps.services.economic_calendar import EconomicCalendarService

# ── Logging ───────────────────────────────────────────────────────────────────

# ── Helper: filtro orari di trading ──────────────────────────────────────────

_WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def _is_trading_allowed(
    now: "datetime",
    start_h: "int | None",
    end_h: "int | None",
    days: "list[str] | None",
) -> bool:
    """Ritorna True se il trading è permesso nell'orario e giorno correnti (UTC)."""
    current_day = _WEEKDAYS[now.weekday()]
    if days and current_day not in days:
        return False
    if start_h is None or end_h is None:
        return True
    h = now.hour
    if start_h <= end_h:
        return start_h <= h < end_h
    # overnight (es. 22–06)
    return h >= start_h or h < end_h

_bot_dir = Path(os.environ.get("TRADING_BOT_DIR", _ROOT)).resolve()
_log_dir = _bot_dir / "logs"
_log_dir.mkdir(parents=True, exist_ok=True)

from vps.logging_setup import setup_logging
setup_logging(_log_dir)
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

    # Percorsi esposti per gli endpoint che ne hanno bisogno
    app.state.sessions_dir  = _sessions_dir
    app.state.mt5_users_dir = _mt5_users_dir

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
        strategy_executor.set_closed_trade_store(closed_trade_store)
        logger.info("StrategyExecutor attivo (Gemini)")
    else:
        strategy_executor = None
        logger.warning("StrategyExecutor non attivo (GEMINI_API_KEY mancante)")

    # Backtest store + engine
    backtest_store = BacktestStore(_db_path)
    await backtest_store.init()
    app.state.backtest_store = backtest_store

    if signal_processor is not None:
        backtest_engine = BacktestEngine(
            telegram_manager=None,   # verrà sostituito dopo la creazione del TelegramManager
            signal_processor=signal_processor,
            mt5_trader=mt5_trader,
            backtest_store=backtest_store,
            strategy_executor=strategy_executor,
        )
        app.state.backtest_engine = backtest_engine
        logger.info("BacktestEngine attivo")
    else:
        app.state.backtest_engine = None
        logger.warning("BacktestEngine non attivo (GEMINI_API_KEY mancante)")

    # Utenti attualmente in backtest: blocca il trading live durante la simulazione
    app.state.backtesting_users: set[str] = set()
    # Task asyncio attivi per run_id (usato per la cancellazione)
    app.state.backtest_tasks: dict[str, object] = {}

    # Utenti con trading sospeso per drawdown alert (reset a mezzanotte UTC)
    app.state.drawdown_paused_users: set[str] = set()

    # Calendario economico ForexFactory (Feature 7)
    eco_calendar = EconomicCalendarService(refresh_hours=6)

    # Range order watcher
    range_watcher = RangeOrderWatcher()
    range_watcher.start()

    # ── Price level watcher + callback al StrategyExecutor ───────────────────
    async def on_price_level_event(
        user_id: str,
        event_data: dict,
        management_strategy: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
    ) -> None:
        """
        Callback invocato dal PriceLevelWatcher quando un livello prezzo viene raggiunto.
        Delega direttamente al StrategyExecutor con la management_strategy memorizzata
        al momento dell'estrazione del segnale.
        """
        if strategy_executor is None:
            return
        ulog = logging.LoggerAdapter(logger, {"user_id": user_id})
        ulog.info(
            "StrategyExecutor utente %s: price_level_reached (ticket #%s, prezzo %s) — avvio agent...",
            user_id, event_data.get("ticket"), event_data.get("trigger_price"),
        )
        try:
            result = await strategy_executor.on_event(
                user_id             = user_id,
                event_type          = "price_level_reached",
                event_data          = event_data,
                management_strategy = management_strategy,
                mt5_login           = mt5_login,
                mt5_password        = mt5_password,
                mt5_server          = mt5_server,
            )
        except Exception as exc:
            ulog.error("StrategyExecutor on_event price_level_reached errore: %s", exc, exc_info=True)
            await strategy_log_store.insert(
                user_id             = user_id,
                event_type          = "price_level_reached",
                event_data          = event_data,
                management_strategy = management_strategy,
                error_msg           = str(exc),
            )
            return

        ulog.info(
            "StrategyExecutor utente %s: price_level_reached completato — %d tool call, risposta: %.120s",
            user_id, len(result.tool_calls), result.final_response,
        )
        await strategy_log_store.insert(
            user_id             = user_id,
            event_type          = "price_level_reached",
            event_data          = event_data,
            management_strategy = management_strategy,
            tool_calls          = result.tool_calls,
            final_response      = result.final_response,
            error_msg           = result.error,
        )

    price_level_watcher = PriceLevelWatcher(on_event=on_price_level_event)
    price_level_watcher.start()

    # ── Position watcher + callback al StrategyExecutor ──────────────────────
    async def on_position_event(user_id: str, event_type: str, event_data: dict) -> None:
        """
        Callback invocato dal PositionWatcher quando rileva un cambiamento di posizione.
        Salva SEMPRE le posizioni chiuse nel DB (per le statistiche di performance),
        poi delega al StrategyExecutor se l'utente ha una management_strategy configurata.
        """
        ulog = logging.LoggerAdapter(logger, {"user_id": user_id})
        # ── Salva sempre ogni chiusura per le statistiche ─────────────────────
        if event_type == "position_closed":
            try:
                await closed_trade_store.insert(user_id=user_id, event_data=event_data)
            except Exception as exc:
                ulog.warning("closed_trade_store.insert utente %s: %s", user_id, exc)
            # Rimuove i livelli prezzo pendenti per questa posizione
            ticket = event_data.get("ticket")
            if ticket:
                price_level_watcher.remove_by_ticket(user_id, int(ticket))

            # ── Drawdown alert check ──────────────────────────────────────────
            if user_id not in app.state.drawdown_paused_users:
                try:
                    dd_user = await store.get_user(user_id)
                    threshold_pct = dd_user.get("drawdown_alert_pct") if dd_user else None
                    if threshold_pct and threshold_pct > 0:
                        today_pnl = await closed_trade_store.get_today_pnl(user_id)
                        if today_pnl < 0:
                            mt5_l = dd_user.get("mt5_login")
                            mt5_p = dd_user.get("mt5_password")
                            mt5_s = dd_user.get("mt5_server")
                            if mt5_l and mt5_p and mt5_s:
                                acc = await mt5_trader.get_account_info(
                                    user_id=user_id,
                                    mt5_login=int(mt5_l),
                                    mt5_password=mt5_p,
                                    mt5_server=mt5_s,
                                )
                                if acc:
                                    balance   = acc.get("balance", 0)
                                    loss_pct  = abs(today_pnl) / balance * 100 if balance > 0 else 0
                                    if loss_pct >= threshold_pct:
                                        app.state.drawdown_paused_users.add(user_id)
                                        ulog.warning(
                                            "Utente %s: drawdown %.1f%% >= soglia %.1f%% — trading sospeso",
                                            user_id, loss_pct, threshold_pct,
                                        )
                                        await tm.send_to_user(
                                            user_id,
                                            f"⛔ Trading sospeso\n\n"
                                            f"📉 Drawdown giornaliero: {loss_pct:.1f}%\n"
                                            f"🔴 Soglia: {threshold_pct}%\n\n"
                                            f"Riprendi manualmente dal dashboard quando sei pronto.",
                                        )
                except Exception as dd_exc:
                    ulog.warning("Drawdown check utente %s fallito: %s", user_id, dd_exc)

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

        ulog.info(
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
            ulog.error("StrategyExecutor on_event errore: %s", exc, exc_info=True)
            await strategy_log_store.insert(
                user_id             = user_id,
                event_type          = event_type,
                event_data          = event_data,
                management_strategy = management_strategy,
                error_msg           = str(exc),
            )
            return

        ulog.info(
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
    async def on_message(
        user_id: str,
        group_id: int | None,
        message: str,
        raw_event,
        sender,
        *,
        _is_forwarded: bool = False,
    ) -> None:
        import asyncio
        import uuid
        from dataclasses import asdict
        ulog = logging.LoggerAdapter(logger, {"user_id": user_id})
        sender_name = getattr(sender, "first_name", None) or getattr(sender, "title", "?")

        # Blocca il trading live se l'utente è in backtest
        if user_id in app.state.backtesting_users:
            ulog.info(
                "Utente %s in backtest — messaggio live ignorato per evitare ordini reali",
                user_id,
            )
            return

        # Blocca il trading se l'utente è sospeso per drawdown alert
        if user_id in app.state.drawdown_paused_users:
            ulog.info(
                "Utente %s: trading sospeso per drawdown alert — messaggio ignorato",
                user_id,
            )
            return

        # Se il messaggio arriva dalla sessione Telegram propria dell'utente (non da un link),
        # e l'utente è target di qualche link, lo ignoriamo: riceverà solo i messaggi propagati.
        if not _is_forwarded:
            try:
                if await store.is_link_target(user_id):
                    ulog.debug(
                        "Utente %s è link-target — messaggio organico ignorato (arriverà via propagazione)",
                        user_id,
                    )
                    return
            except Exception as exc:
                ulog.warning("Errore controllo is_link_target per utente %s: %s", user_id, exc)

        # Propaga il messaggio agli utenti collegati (ciascuno processerà con le proprie impostazioni)
        if not _is_forwarded:
            try:
                linked_ids = await store.get_linked_users(user_id)
                for linked_id in linked_ids:
                    ulog.info("Propagazione segnale da %s a utente collegato %s", user_id, linked_id)
                    asyncio.get_event_loop().create_task(
                        on_message(linked_id, None, message, raw_event, sender, _is_forwarded=True)
                    )
            except Exception as exc:
                ulog.warning("Errore propagazione link segnali per utente %s: %s", user_id, exc)
        ulog.info("[%s] messaggio da %s: %.120s", user_id, sender_name, message)
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
        log_group_name:      str | None  = None

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
                group_id             = group_id,
                group_name           = log_group_name,
            )

        if signal_processor is None:
            await _save_log()
            return

        # ── Step 1: rilevamento rapido (Flash) — prima di aprire MT5 ─────────
        try:
            flash_result, _, _ = await signal_processor._detect(message, user_id=user_id)
            log_flash_raw = "YES" if flash_result else "NO"
            log_is_signal = flash_result
        except Exception as exc:
            ulog.error("Gemini Flash errore: %s", exc)
            log_error_step = "flash"
            log_error_msg  = str(exc)
            await _save_log()
            return

        if not log_is_signal:
            ulog.debug("Messaggio classificato come non-segnale (Flash)")
            await _save_log()
            return

        ulog.info("Segnale rilevato — recupero credenziali utente %s...", user_id)

        # ── Step 2: recupera credenziali MT5 dal DB ───────────────────────────
        user = await store.get_user(user_id)
        if user is None:
            ulog.error("Utente %s non trovato nel DB — skip", user_id)
            log_error_step = "db_lookup"
            log_error_msg  = f"Utente {user_id} non trovato nel DB"
            await _save_log()
            return

        mt5_login    = user.get("mt5_login")
        mt5_password = user.get("mt5_password")   # già decifrata da UserStore
        mt5_server   = user.get("mt5_server")

        # Impostazioni per-gruppo: usa group_id del messaggio, altrimenti primo gruppo
        group_settings: dict | None = None
        if group_id is not None:
            group_settings = await store.get_user_group(user_id, group_id)
        if group_settings is None:
            groups = user.get("groups") or []
            group_settings = groups[0] if groups else {}
        log_group_name          = (group_settings or {}).get("group_name")
        log_sizing_strategy     = (group_settings or {}).get("sizing_strategy") or None
        management_strategy     = (group_settings or {}).get("management_strategy") or None
        extraction_instructions = (group_settings or {}).get("extraction_instructions") or None
        range_entry_pct     = int((group_settings or {}).get("range_entry_pct") or 0)
        entry_if_favorable  = bool((group_settings or {}).get("entry_if_favorable"))
        ulog.info("Utente %s: gruppo=%s range_entry_pct=%d%% entry_if_favorable=%s",
                  user_id, group_id, range_entry_pct, entry_if_favorable)

        # ── Step 2.5: verifica filtro orari di trading ────────────────────────
        if group_settings and group_settings.get("trading_hours_enabled"):
            if not _is_trading_allowed(
                datetime.now(timezone.utc),
                group_settings.get("trading_hours_start"),
                group_settings.get("trading_hours_end"),
                group_settings.get("trading_hours_days"),
            ):
                ulog.info(
                    "Utente %s: segnale ignorato — fuori dagli orari di trading (gruppo %s)",
                    user_id, group_id,
                )
                log_error_step = "trading_hours"
                log_error_msg  = "Segnale ricevuto fuori dagli orari di trading configurati"
                await _save_log()
                return

        # ── Step 2.6: verifica calendario economico ──────────────────────────
        if group_settings and group_settings.get("eco_calendar_enabled"):
            try:
                await eco_calendar.refresh_if_needed()
                window = int((group_settings or {}).get("eco_calendar_window") or 30)
                blocked, event_str = eco_calendar.is_blocked(
                    datetime.now(timezone.utc), window
                )
                if blocked:
                    ulog.info(
                        "Utente %s: segnale ignorato — evento macroeconomico (%s, finestra %dm)",
                        user_id, event_str, window,
                    )
                    log_error_step = "eco_calendar"
                    log_error_msg  = f"Segnale bloccato: evento macroeconomico ({event_str})"
                    await _save_log()
                    return
            except Exception as _eco_exc:
                ulog.warning("Controllo calendario economico fallito: %s", _eco_exc)

        log_has_mt5_creds = bool(mt5_login and mt5_password and mt5_server)
        if not log_has_mt5_creds:
            ulog.warning(
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
                ulog.warning("Utente %s: account_info fallita: %s", user_id, exc)
                log_account_info = None

            if log_account_info is None:
                ulog.warning(
                    "Utente %s: account_info non disponibile — sizing senza contesto conto",
                    user_id,
                )

        # ── Step 4: extraction strutturata (Pro) con contesto sizing ──────────
        try:
            signals, _, _ = await signal_processor.extract_signals(
                message,
                sizing_strategy=log_sizing_strategy,
                account_info=log_account_info,
                user_id=user_id,
                extraction_instructions=extraction_instructions,
                management_strategy=management_strategy,
            )
        except Exception as exc:
            ulog.error("Gemini Pro errore: %s", exc)
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

        # ── Step 4.5: filtro confidenza AI ────────────────────────────────────
        min_confidence = int((group_settings or {}).get("min_confidence") or 0)
        if min_confidence > 0:
            filtered = [s for s in signals if s.confidence is None or s.confidence >= min_confidence]
            if len(filtered) < len(signals):
                ulog.info(
                    "Utente %s: %d segnali filtrati per confidenza AI < %d",
                    user_id, len(signals) - len(filtered), min_confidence,
                )
            if not filtered:
                log_error_step = "confidence_filter"
                log_error_msg  = f"Tutti i segnali filtrati (confidenza AI < {min_confidence})"
                await _save_log()
                return
            signals     = filtered
            log_signals = [asdict(s) for s in signals]

        # ── Step 5 (opzionale): filtro pre-trade con StrategyExecutor ─────────
        if strategy_executor and management_strategy:
            try:
                decisions, _, _ = await strategy_executor.pre_trade(
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
                        ulog.info(
                            "StrategyExecutor utente %s: segnale [%d] rifiutato — %s",
                            user_id, i, dec.reason,
                        )

                if not approved_signals:
                    ulog.info(
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
                ulog.error("StrategyExecutor pre_trade errore: %s", exc, exc_info=True)
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
            ulog.error("MT5 execute_signals errore: %s", exc)
            log_error_step = "mt5_execute"
            log_error_msg  = str(exc)
            await _save_log()
            return

        ok  = sum(1 for r in results if r.success)
        err = sum(1 for r in results if not r.success)
        ulog.info(
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

        # ── Step 6.5: notifica Telegram per ogni ordine eseguito/fallito ──────
        for res in results:
            if res.signal is None:
                continue
            sig = res.signal
            if res.success:
                entry_str = (
                    f"{sig.entry_price[0]:.5f}–{sig.entry_price[1]:.5f}"
                    if isinstance(sig.entry_price, list)
                    else f"{sig.entry_price:.5f}"
                ) if sig.entry_price is not None else "market"
                lines = [
                    "🔔 Ordine eseguito",
                    "",
                    f"📍 {sig.order_type} {sig.symbol}"
                    + (f" | Lotto: {sig.lot_size}" if sig.lot_size else ""),
                    f"🎯 Entry: {entry_str}",
                ]
                if sig.stop_loss or sig.take_profit:
                    lines.append(
                        f"🛡️ SL: {sig.stop_loss or '—'} → TP: {sig.take_profit or '—'}"
                    )
                if res.order_id:
                    lines.append(f"🆔 Ticket: #{res.order_id}")
            else:
                lines = [
                    "⚠️ Ordine fallito",
                    "",
                    f"📍 {sig.order_type} {sig.symbol}",
                    f"❌ {res.error or 'Errore sconosciuto'}",
                ]
            try:
                await tm.send_to_user(user_id, "\n".join(lines))
            except Exception as _notify_exc:
                ulog.warning("Alert trade fallito: %s", _notify_exc)

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

        # ── Step 8: registra price levels della management strategy ───────────
        if management_strategy:
            for result in results:
                sig = result.signal
                if (
                    result.success
                    and result.order_id is not None
                    and sig is not None
                    and sig.prices
                ):
                    for price in sig.prices:
                        price_level_watcher.add(WatchedPriceLevel(
                            ticket              = result.order_id,
                            symbol              = sig.symbol,
                            order_type          = sig.order_type,
                            price               = price,
                            management_strategy = management_strategy,
                            user_id             = user_id,
                            user_dir            = _mt5_users_dir / user_id,
                            mt5_login           = int(mt5_login),
                            mt5_password        = mt5_password,
                            mt5_server          = mt5_server,
                            signal_group_id     = signal_group_id,
                        ))

    async def on_message_deleted(
        user_id: str,
        group_id: int | None,
        deleted_ids: list[int],
        *,
        _is_forwarded: bool = False,
    ) -> None:
        """
        Callback invocato quando uno o più messaggi vengono eliminati dal gruppo.
        Per ogni message_id eliminato: verifica se era un segnale, recupera le
        posizioni correlate e delega all'AI tramite deletion_strategy.
        """
        ulog = logging.LoggerAdapter(logger, {"user_id": user_id})
        # Ignora eventi di eliminazione organici per gli utenti che sono link-target
        if not _is_forwarded:
            try:
                if await store.is_link_target(user_id):
                    return
            except Exception as exc:
                ulog.warning("Errore controllo is_link_target (delete) per utente %s: %s", user_id, exc)

        # Propaga l'eliminazione agli utenti collegati
        if not _is_forwarded:
            try:
                import asyncio
                linked_ids = await store.get_linked_users(user_id)
                for linked_id in linked_ids:
                    ulog.info("Propagazione eliminazione da %s a utente collegato %s", user_id, linked_id)
                    asyncio.get_event_loop().create_task(
                        on_message_deleted(linked_id, None, deleted_ids, _is_forwarded=True)
                    )
            except Exception as exc:
                ulog.warning("Errore propagazione eliminazione link per utente %s: %s", user_id, exc)

        if strategy_executor is None:
            return

        for msg_id in deleted_ids:
            # Cerca il log del messaggio eliminato
            log_entry = await signal_log_store.get_by_telegram_message_id(
                user_id, msg_id, group_id=group_id
            )
            if log_entry is None or not log_entry.get("is_signal"):
                continue  # Non era un segnale tracciato

            sig_group_id = log_entry.get("signal_group_id")
            ulog.info(
                "Messaggio #%d eliminato per utente %s — era un segnale (group=%s)",
                msg_id, user_id, sig_group_id,
            )

            # Recupera le impostazioni del gruppo sorgente
            user = await store.get_user(user_id)
            if user is None:
                continue

            del_group_settings: dict | None = None
            if group_id is not None:
                del_group_settings = await store.get_user_group(user_id, group_id)
            if del_group_settings is None:
                groups = user.get("groups") or []
                del_group_settings = groups[0] if groups else {}
            deletion_strategy = (del_group_settings or {}).get("deletion_strategy") or ""
            if not deletion_strategy.strip():
                ulog.debug(
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

            ulog.info(
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
                ulog.error(
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

            ulog.info(
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
    # Inietta il TelegramManager nel BacktestEngine ora che è disponibile
    if app.state.backtest_engine is not None:
        app.state.backtest_engine._tm = tm

    active_users = await store.get_active_users()
    if active_users:
        logger.info("Ripristino %d utenti attivi...", len(active_users))
        tm.restore_users(active_users)
        # Registra gli utenti nel PositionWatcher (solo quelli con management_strategy)
        for u in active_users:
            position_watcher.register_user(u["user_id"], u)
    else:
        logger.info("Nessun utente da ripristinare")

    # VPS monitor (intervallo e top-N configurabili via env)
    vps_monitor = VpsMonitor(
        interval=int(os.environ.get("VPS_MONITOR_INTERVAL", "60")),
        top_n=int(os.environ.get("VPS_MONITOR_TOP_N", "5")),
    )
    vps_monitor.start()
    app.state.vps_monitor = vps_monitor

    # ── Report settimanale (ogni lunedì alle 08:00 UTC) ──────────────────────

    async def _send_weekly_reports() -> None:
        users = await store.get_active_users()
        for u in users:
            uid = u["user_id"]
            try:
                summary = await closed_trade_store.get_last_week_summary(uid)
                if summary["total_trades"] == 0:
                    continue
                pnl     = summary["total_profit"]
                pnl_str = f"+{pnl:.2f}" if pnl >= 0 else f"{pnl:.2f}"
                now_utc    = datetime.now(timezone.utc)
                week_start = (now_utc - timedelta(days=7)).strftime("%d/%m")
                week_end   = (now_utc - timedelta(days=1)).strftime("%d/%m")
                text = (
                    f"📊 Report settimanale ({week_start}–{week_end})\n\n"
                    f"📈 Operazioni: {summary['total_trades']} "
                    f"({summary['wins']} win / {summary['losses']} loss)\n"
                    f"🎯 Win rate: {summary['win_rate']}%\n"
                    f"💰 P&L: {pnl_str}"
                )
                await asyncio.get_event_loop().run_in_executor(
                    None, tm.notify_user, uid, text
                )
                logger.info("Report settimanale inviato a utente %s", uid)
            except Exception as exc:
                logger.warning("Report settimanale utente %s fallito: %s", uid, exc)

    async def _weekly_report_loop() -> None:
        while True:
            try:
                now        = datetime.now(timezone.utc)
                days_ahead = (7 - now.weekday()) % 7
                if days_ahead == 0 and now.hour >= 8:
                    days_ahead = 7
                next_run   = now.replace(hour=8, minute=0, second=0, microsecond=0) + timedelta(days=days_ahead)
                wait_secs  = (next_run - now).total_seconds()
                logger.info(
                    "Report settimanale: prossimo invio tra %.1f ore (%s UTC)",
                    wait_secs / 3600, next_run.strftime("%a %Y-%m-%d %H:%M"),
                )
                await asyncio.sleep(wait_secs)
                await _send_weekly_reports()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Errore loop report settimanale: %s", exc, exc_info=True)
                await asyncio.sleep(3600)

    weekly_report_task = asyncio.create_task(_weekly_report_loop())
    app.state.weekly_report_task = weekly_report_task

    # ── Reset mezzanotte: svuota drawdown_paused_users ogni 00:00 UTC ────────

    async def _midnight_reset_loop() -> None:
        while True:
            try:
                now      = datetime.now(timezone.utc)
                tomorrow = (now + timedelta(days=1)).replace(
                    hour=0, minute=0, second=0, microsecond=0
                )
                await asyncio.sleep((tomorrow - now).total_seconds())
                cleared = len(app.state.drawdown_paused_users)
                app.state.drawdown_paused_users.clear()
                if cleared:
                    logger.info("Midnight reset: %d utenti rimossi da drawdown_paused", cleared)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Midnight reset loop errore: %s", exc, exc_info=True)
                await asyncio.sleep(3600)

    midnight_reset_task = asyncio.create_task(_midnight_reset_loop())
    app.state.midnight_reset_task = midnight_reset_task

    # ── Report mensile (primo del mese alle 09:00 UTC) ────────────────────────

    async def _fetch_btc_monthly_return() -> float | None:
        """Rendimento % BTC del mese precedente via Binance public API."""
        import urllib.request as _urllib_req
        import json as _json
        try:
            def _fetch_sync():
                url = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1M&limit=3"
                req = _urllib_req.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with _urllib_req.urlopen(req, timeout=10) as resp:
                    return _json.loads(resp.read())
            klines = await asyncio.get_event_loop().run_in_executor(None, _fetch_sync)
            if len(klines) >= 2:
                prev_close = float(klines[-2][4])
                curr_close = float(klines[-1][4])
                if prev_close > 0:
                    return round((curr_close - prev_close) / prev_close * 100, 2)
        except Exception as exc:
            logger.warning("BTC monthly return fetch fallito: %s", exc)
        return None

    async def _send_monthly_reports() -> None:
        now     = datetime.now(timezone.utc)
        month   = now.month - 1 if now.month > 1 else 12
        year_m  = now.year if now.month > 1 else now.year - 1
        btc_ret = await _fetch_btc_monthly_return()
        month_names = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"]
        users   = await store.get_active_users()
        for u in users:
            uid = u["user_id"]
            try:
                summary = await closed_trade_store.get_monthly_summary(uid, year_m, month)
                if summary["total_trades"] == 0:
                    continue
                pnl     = summary["total_profit"]
                pnl_str = f"+{pnl:.2f}" if pnl >= 0 else f"{pnl:.2f}"
                lines   = [
                    f"📅 Report mensile — {month_names[month-1]} {year_m}",
                    "",
                    f"📈 Operazioni: {summary['total_trades']} "
                    f"({summary['wins']} win / {summary['losses']} loss)",
                    f"🎯 Win rate: {summary['win_rate']}%",
                    f"💰 P&L: {pnl_str}",
                ]
                if btc_ret is not None:
                    btc_str = f"+{btc_ret:.2f}%" if btc_ret >= 0 else f"{btc_ret:.2f}%"
                    lines.append(f"₿  BTC mese: {btc_str}")
                text = "\n".join(lines)
                await asyncio.get_event_loop().run_in_executor(
                    None, tm.notify_user, uid, text
                )
                logger.info("Report mensile inviato a utente %s", uid)
            except Exception as exc:
                logger.warning("Report mensile utente %s fallito: %s", uid, exc)

    async def _monthly_report_loop() -> None:
        while True:
            try:
                now = datetime.now(timezone.utc)
                if now.month == 12:
                    next_run = now.replace(
                        year=now.year + 1, month=1, day=1,
                        hour=9, minute=0, second=0, microsecond=0,
                    )
                else:
                    next_run = now.replace(
                        month=now.month + 1, day=1,
                        hour=9, minute=0, second=0, microsecond=0,
                    )
                wait_secs = (next_run - now).total_seconds()
                logger.info(
                    "Report mensile: prossimo invio tra %.1f ore (%s UTC)",
                    wait_secs / 3600, next_run.strftime("%Y-%m-%d %H:%M"),
                )
                await asyncio.sleep(wait_secs)
                await _send_monthly_reports()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Errore loop report mensile: %s", exc, exc_info=True)
                await asyncio.sleep(3600)

    monthly_report_task = asyncio.create_task(_monthly_report_loop())
    app.state.monthly_report_task = monthly_report_task

    logger.info("Trading Bot API pronta")
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("Arresto in corso...")
    weekly_report_task.cancel()
    midnight_reset_task.cancel()
    monthly_report_task.cancel()
    await vps_monitor.stop()
    await range_watcher.stop()
    await price_level_watcher.stop()
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
app.include_router(backtest_router)


@app.get("/health")
async def health():
    tm: TelegramManager = app.state.telegram_manager
    monitor: VpsMonitor = app.state.vps_monitor
    return {
        "status":       "ok",
        "active_users": len(tm.active_user_ids()),
        "vps":          monitor.get_snapshot(),
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
