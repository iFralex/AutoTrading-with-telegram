"""
MT5Trader — esegue ordini su MetaTrader 5 in modalità portable.

Ogni utente ha una copia dell'installazione MT5 in:
    <mt5_users_dir>/<user_id>/terminal64.exe

Al primo ordine di un utente, la directory viene creata copiando il template.
L'esecuzione è sincrona (libreria MT5) e avviene in ThreadPoolExecutor
per non bloccare l'event loop asyncio.

Un singolo blocco initialize/login/order_send/shutdown per ogni chiamata
a execute_signals(), così MT5 non rimane aperto tra un segnale e l'altro.

Metodi estesi per il StrategyExecutor:
  - modify_position         : sposta SL/TP di una posizione aperta
  - close_position_by_ticket: chiude parzialmente o totalmente una posizione
  - cancel_order_by_ticket  : cancella un ordine pendente
  - modify_order_by_ticket  : modifica prezzo/SL/TP di un ordine pendente
  - open_new_market_order   : apre un nuovo ordine a mercato
  - place_new_pending_order : piazza un nuovo ordine pendente
  - get_positions           : lista posizioni aperte (opz. filtro per simbolo)
  - get_pending_orders_list : lista ordini pendenti
  - get_closed_deals        : storico deal chiusi (N giorni, opz. simbolo)
  - get_pnl_for_period      : P&L aggregato per un intervallo di date
  - get_symbol_tick         : bid/ask/spread attuali di un simbolo
  - get_symbol_specs        : specifiche del simbolo (pip, lotti, ecc.)
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from vps.services.signal_processor import TradeSignal

logger = logging.getLogger(__name__)

# Pool dedicato: una thread per utente alla volta va bene, max 8 paralleli
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="mt5-trade")

# Lock globale di processo: la libreria MetaTrader5 è un singleton IPC —
# una sola connessione per volta in tutta l'applicazione.
# Importato anche da setup.py per le chiamate di verifica credenziali.
MT5_LOCK = threading.Lock()

# Parametri retry per mt5.initialize() — usati anche da setup.py
MT5_INIT_RETRIES         = 3
MT5_INIT_RETRY_DELAY     = 10.0   # secondi tra un tentativo e l'altro
MT5_INIT_TIMEOUT_MS      = 30_000  # 30 secondi per tentativo
MT5_FIRST_BOOT_DELAY     = 15.0   # attesa dopo copia template (primo avvio)


# ── Risultato di ogni ordine ──────────────────────────────────────────────────

@dataclass
class TradeResult:
    success:  bool
    order_id: int | None        = None
    error:    str | None        = None
    signal:   TradeSignal | None = None

    def __str__(self) -> str:
        if self.success:
            return f"OK ordine #{self.order_id} ({self.signal})"
        return f"FAIL {self.error} ({self.signal})"


# ── Classe principale ─────────────────────────────────────────────────────────

class MT5Trader:
    """
    Uso:
        trader = MT5Trader(mt5_template_dir=..., mt5_users_dir=..., default_lot=0.01)
        results = await trader.execute_signals(
            user_id, signals, mt5_login, mt5_password, mt5_server
        )
    """

    def __init__(
        self,
        mt5_template_dir: Path,
        mt5_users_dir: Path,
        default_lot: float = 0.01,
    ) -> None:
        self._template    = mt5_template_dir
        self._users_dir   = mt5_users_dir
        self._default_lot = default_lot

    async def get_account_info(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
    ) -> dict | None:
        """
        Ritorna le info del conto MT5 utili per il calcolo del lot size:
            {"balance", "equity", "free_margin", "currency", "leverage"}
        Ritorna None se MT5 non è disponibile o il login fallisce.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            _executor,
            self._get_account_info_sync,
            user_id, mt5_login, mt5_password, mt5_server,
        )

    def _get_account_info_sync(
        self,
        user_id: str,
        login: int,
        password: str,
        server: str,
    ) -> dict | None:
        try:
            import MetaTrader5 as mt5
        except ImportError:
            return None

        try:
            user_dir, is_first_boot = self._ensure_user_dir(user_id)
        except Exception:
            return None

        terminal_path = str(user_dir / "terminal64.exe")

        if is_first_boot:
            time.sleep(MT5_FIRST_BOOT_DELAY)

        with MT5_LOCK:
            init_ok = False
            for attempt in range(1, MT5_INIT_RETRIES + 1):
                if attempt > 1:
                    mt5.shutdown()
                    time.sleep(MT5_INIT_RETRY_DELAY)
                if mt5.initialize(
                    path=terminal_path,
                    portable=True,
                    login=login,
                    password=password,
                    server=server,
                    timeout=MT5_INIT_TIMEOUT_MS,
                ):
                    init_ok = True
                    break
                code, msg = mt5.last_error()
                logger.warning(
                    "Utente %s — get_account_info tentativo %d/%d: %s (codice %s)",
                    user_id, attempt, MT5_INIT_RETRIES, msg, code,
                )

            if not init_ok:
                return None

            try:
                info_check = mt5.account_info()
                if info_check is None:
                    return None

                info = mt5.account_info()
                if info is None:
                    return None

                return {
                    "balance":     round(info.balance, 2),
                    "equity":      round(info.equity, 2),
                    "free_margin": round(info.margin_free, 2),
                    "currency":    info.currency,
                    "leverage":    info.leverage,
                }
            finally:
                mt5.shutdown()

    async def execute_signals(
        self,
        user_id: str,
        signals: list[TradeSignal],
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        signal_group_id: str | None = None,
    ) -> list[TradeResult]:
        """
        Esegue tutti i segnali per l'utente in un unico blocco MT5
        (una sola initialize/shutdown per tutti gli ordini del batch).

        signal_group_id: identificatore del gruppo di segnali (es. UUID[:8]).
            Viene codificato nel campo comment dell'ordine MT5 come "TgBot:<id>"
            per permettere al PositionWatcher di correlare le posizioni.
        """
        if not signals:
            return []

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            _executor,
            self._execute_block,
            user_id, signals, mt5_login, mt5_password, mt5_server, signal_group_id,
        )

    # ── Sync — gira in ThreadPoolExecutor ─────────────────────────────────────

    def _ensure_user_dir(self, user_id: str) -> tuple[Path, bool]:
        """Crea la directory MT5 dell'utente dal template se non esiste ancora.

        Returns:
            (user_dir, is_first_boot) — is_first_boot=True se la directory
            è stata appena creata e il terminale non è mai stato avviato.
        """
        user_dir = self._users_dir / user_id
        first_boot = not (user_dir / "terminal64.exe").exists()
        if first_boot:
            if not (self._template / "terminal64.exe").exists():
                raise RuntimeError(
                    f"MT5 template non trovato in {self._template}. "
                    "Eseguire setup.ps1 prima di avviare il bot."
                )
            logger.info(
                "Prima operazione utente %s: creazione directory MT5 dal template...",
                user_id,
            )
            shutil.copytree(self._template, user_dir, dirs_exist_ok=True)
        return user_dir, first_boot

    def _execute_block(
        self,
        user_id: str,
        signals: list[TradeSignal],
        login: int,
        password: str,
        server: str,
        signal_group_id: str | None = None,
    ) -> list[TradeResult]:
        """Apre MT5, esegue tutti gli ordini, chiude MT5."""
        try:
            import MetaTrader5 as mt5
        except ImportError:
            msg = "Libreria MetaTrader5 non disponibile su questo server"
            logger.error(msg)
            return [TradeResult(success=False, error=msg, signal=s) for s in signals]

        # Prepara directory utente
        try:
            user_dir, is_first_boot = self._ensure_user_dir(user_id)
        except Exception as exc:
            msg = str(exc)
            logger.error("Utente %s — setup MT5: %s", user_id, msg)
            return [TradeResult(success=False, error=msg, signal=s) for s in signals]

        terminal_path = str(user_dir / "terminal64.exe")
        results: list[TradeResult] = []

        # Al primo avvio MT5 deve inizializzare la sua configurazione e
        # connettersi al broker: aspetta prima di acquisire il lock.
        if is_first_boot:
            logger.info(
                "Utente %s — primo avvio MT5, attesa %ss per inizializzazione...",
                user_id, MT5_FIRST_BOOT_DELAY,
            )
            time.sleep(MT5_FIRST_BOOT_DELAY)

        with MT5_LOCK:
            try:
                # ── Inizializza (con retry su IPC timeout) ────────────────────
                init_ok = False
                last_err = ""
                for attempt in range(1, MT5_INIT_RETRIES + 1):
                    if attempt > 1:
                        mt5.shutdown()
                        time.sleep(MT5_INIT_RETRY_DELAY)
                    if mt5.initialize(
                        path=terminal_path,
                        portable=True,
                        login=login,
                        password=password,
                        server=server,
                        timeout=MT5_INIT_TIMEOUT_MS,
                    ):
                        init_ok = True
                        break
                    code, msg = mt5.last_error()
                    last_err = f"MT5 non avviabile: {msg} (codice {code})"
                    logger.warning(
                        "Utente %s — tentativo %d/%d fallito: %s",
                        user_id, attempt, MT5_INIT_RETRIES, last_err,
                    )

                if not init_ok:
                    logger.error("Utente %s — %s", user_id, last_err)
                    return [TradeResult(success=False, error=last_err, signal=s) for s in signals]

                # Verifica che il login sia avvenuto correttamente
                acc = mt5.account_info()
                if acc is None:
                    err = "MT5 avviato ma login non riuscito (account_info None)"
                    logger.error("Utente %s — %s", user_id, err)
                    return [TradeResult(success=False, error=err, signal=s) for s in signals]

                logger.info(
                    "Utente %s — MT5 connesso a %s, invio %d ordini...",
                    user_id, server, len(signals),
                )

                # ── Ordini ────────────────────────────────────────────────────
                for sig in signals:
                    results.append(self._send_order(mt5, sig, user_id, signal_group_id))

            finally:
                mt5.shutdown()

        return results

    def _send_order(
        self,
        mt5,
        sig: TradeSignal,
        user_id: str,
        signal_group_id: str | None = None,
    ) -> TradeResult:
        """Costruisce e invia un singolo ordine MT5."""

        # ── Abilita il simbolo se non è nel Market Watch ──────────────────────
        if mt5.symbol_info(sig.symbol) is None:
            mt5.symbol_select(sig.symbol, True)

        sym_info = mt5.symbol_info(sig.symbol)
        if sym_info is None:
            return TradeResult(
                success=False,
                error=f"Simbolo {sig.symbol!r} non trovato o non disponibile",
                signal=sig,
            )

        tick = mt5.symbol_info_tick(sig.symbol)
        if tick is None:
            return TradeResult(
                success=False,
                error=f"Impossibile ottenere il tick per {sig.symbol}",
                signal=sig,
            )

        # ── Tipo ordine e prezzo ──────────────────────────────────────────────
        if sig.order_mode == "MARKET" or sig.entry_price is None:
            # Ordine a mercato
            action = mt5.TRADE_ACTION_DEAL
            price  = tick.ask if sig.order_type == "BUY" else tick.bid
            order_type = (
                mt5.ORDER_TYPE_BUY if sig.order_type == "BUY"
                else mt5.ORDER_TYPE_SELL
            )
        else:
            # Ordine pendente: LIMIT (prezzo migliore) o STOP (prezzo peggiore)
            action = mt5.TRADE_ACTION_PENDING

            if isinstance(sig.entry_price, list):
                # Range: piazza al bordo più favorevole
                #   BUY  → bordo basso (prezzo minimo del range)
                #   SELL → bordo alto  (prezzo massimo del range)
                low   = min(sig.entry_price)
                high  = max(sig.entry_price)
                price = low if sig.order_type == "BUY" else high
            else:
                price = sig.entry_price

            if sig.order_type == "BUY":
                order_type = (
                    mt5.ORDER_TYPE_BUY_LIMIT if price < tick.ask
                    else mt5.ORDER_TYPE_BUY_STOP
                )
            else:
                order_type = (
                    mt5.ORDER_TYPE_SELL_LIMIT if price > tick.bid
                    else mt5.ORDER_TYPE_SELL_STOP
                )

        # ── Volume: arrotonda al passo minimo del broker ──────────────────────
        lot = sig.lot_size or self._default_lot
        lot = max(
            sym_info.volume_min,
            round(lot / sym_info.volume_step) * sym_info.volume_step,
        )

        comment = f"TgBot:{signal_group_id}" if signal_group_id else "TgBot"

        request = {
            "action":       action,
            "symbol":       sig.symbol,
            "volume":       lot,
            "type":         order_type,
            "price":        price,
            "sl":           sig.stop_loss   or 0.0,
            "tp":           sig.take_profit or 0.0,
            "deviation":    20,
            "magic":        234000,
            "comment":      comment,
            "type_time":    mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_RETURN,
        }

        res = mt5.order_send(request)

        if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
            comment = getattr(res, "comment", "?")
            retcode = getattr(res, "retcode", -1)
            err = f"Ordine rifiutato: {comment} (retcode {retcode})"
            logger.error(
                "Utente %s | %s %s @%.5f SL=%.5f TP=%.5f | %s",
                user_id, sig.order_type, sig.symbol,
                price,
                sig.stop_loss   or 0.0,
                sig.take_profit or 0.0,
                err,
            )
            return TradeResult(success=False, error=err, signal=sig)

        logger.info(
            "Utente %s | %s %s @%.5f SL=%.5f TP=%.5f | Ordine #%d OK",
            user_id, sig.order_type, sig.symbol,
            price,
            sig.stop_loss   or 0.0,
            sig.take_profit or 0.0,
            res.order,
        )
        return TradeResult(success=True, order_id=res.order, signal=sig)


    # ══════════════════════════════════════════════════════════════════════════
    # Operazioni estese — usate dal StrategyExecutor e dal PositionWatcher
    # ══════════════════════════════════════════════════════════════════════════

    def _run_mt5(
        self,
        user_id: str,
        login: int,
        password: str,
        server: str,
        fn: Callable,
    ) -> Any:
        """
        Helper interno: apre una sessione MT5, esegue fn(mt5), chiude la sessione.
        Propaga le eccezioni al chiamante.
        """
        try:
            import MetaTrader5 as mt5
        except ImportError:
            raise RuntimeError("Libreria MetaTrader5 non disponibile su questo server")

        user_dir, is_first_boot = self._ensure_user_dir(user_id)
        terminal_path = str(user_dir / "terminal64.exe")

        if is_first_boot:
            time.sleep(MT5_FIRST_BOOT_DELAY)

        init_ok = False
        last_err = ""
        for attempt in range(1, MT5_INIT_RETRIES + 1):
            if attempt > 1:
                mt5.shutdown()
                time.sleep(MT5_INIT_RETRY_DELAY)
            if mt5.initialize(
                path=terminal_path,
                portable=True,
                login=login,
                password=password,
                server=server,
                timeout=MT5_INIT_TIMEOUT_MS,
            ):
                init_ok = True
                break
            code, msg = mt5.last_error()
            last_err = f"MT5 init fallito: {msg} (cod.{code})"
        if not init_ok:
            raise RuntimeError(last_err)

        try:
            if mt5.account_info() is None:
                raise RuntimeError("MT5 avviato ma login non riuscito")
            return fn(mt5)
        finally:
            mt5.shutdown()

    async def _run_mt5_async(
        self,
        user_id: str,
        login: int,
        password: str,
        server: str,
        fn: Callable,
    ) -> Any:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            _executor,
            lambda: self._run_mt5(user_id, login, password, server, fn),
        )

    # ── Lettura stato account ─────────────────────────────────────────────────

    async def get_full_account_info(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
    ) -> dict:
        """
        Restituisce le informazioni complete del conto MT5:
        balance, equity, margin, free_margin, profit_floating,
        leverage, currency, server, login, name.
        """
        def _fn(mt5):
            info = mt5.account_info()
            if info is None:
                raise RuntimeError("account_info() ha restituito None")
            return {
                "login":          info.login,
                "name":           info.name,
                "server":         info.server,
                "currency":       info.currency,
                "leverage":       info.leverage,
                "balance":        round(info.balance,     2),
                "equity":         round(info.equity,      2),
                "margin":         round(info.margin,      2),
                "free_margin":    round(info.margin_free, 2),
                "profit_floating":round(info.profit,      2),
            }
        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            logger.error("get_full_account_info utente %s: %s", user_id, exc)
            return {"error": str(exc)}

    async def get_pnl_for_period(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        date_from: datetime,
        date_to: datetime,
    ) -> float:
        """
        Restituisce il P&L realizzato (deal chiusi, esclusi depositi/prelievi)
        nel periodo [date_from, date_to].
        """
        def _fn(mt5):
            deals = mt5.history_deals_get(date_from, date_to)
            if deals is None:
                return 0.0
            total = 0.0
            for d in deals:
                # DEAL_TYPE_BUY=0, DEAL_TYPE_SELL=1  → operazioni normali
                # Escludiamo DEAL_TYPE_BALANCE(2), DEAL_TYPE_CREDIT(3), ecc.
                if d.type in (0, 1):
                    total += d.profit
            return round(total, 2)
        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            logger.error("get_pnl_for_period utente %s: %s", user_id, exc)
            return 0.0

    async def get_symbol_tick(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        symbol: str,
    ) -> dict:
        """Restituisce bid, ask, spread_pips e last per il simbolo."""
        def _fn(mt5):
            if mt5.symbol_info(symbol) is None:
                mt5.symbol_select(symbol, True)
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                raise RuntimeError(f"Tick non disponibile per {symbol}")
            sym = mt5.symbol_info(symbol)
            digits  = sym.digits if sym else 5
            pip_pos = digits - 1 if digits >= 3 else digits  # es. 5 digit → pip al 4°
            pip_mul = 10 ** pip_pos
            spread_pips = round((tick.ask - tick.bid) * pip_mul, 2)
            return {
                "symbol":      symbol,
                "bid":         tick.bid,
                "ask":         tick.ask,
                "last":        tick.last,
                "spread_pips": spread_pips,
            }
        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            logger.error("get_symbol_tick %s utente %s: %s", symbol, user_id, exc)
            return {"error": str(exc)}

    async def get_symbol_specs(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        symbol: str,
    ) -> dict:
        """
        Restituisce le specifiche del simbolo: dimensione contratto, pip value,
        digits, lotto minimo/massimo/step.
        """
        def _fn(mt5):
            if mt5.symbol_info(symbol) is None:
                mt5.symbol_select(symbol, True)
            sym = mt5.symbol_info(symbol)
            if sym is None:
                raise RuntimeError(f"Simbolo {symbol!r} non trovato")
            # pip value = valore di 1 pip in valuta conto per 1 lotto
            # Approssimazione: contract_size * point * (1 pip / point) / exchange_rate
            # Usiamo trade_tick_value che MT5 già normalizza in valuta conto
            pip_value_per_lot = round(sym.trade_tick_value * (10 if sym.digits >= 3 else 1), 6)
            return {
                "symbol":            symbol,
                "digits":            sym.digits,
                "contract_size":     sym.trade_contract_size,
                "pip_value_per_lot": pip_value_per_lot,
                "volume_min":        sym.volume_min,
                "volume_max":        sym.volume_max,
                "volume_step":       sym.volume_step,
                "currency_profit":   sym.currency_profit,
                "currency_base":     sym.currency_base,
                "spread":            sym.spread,
            }
        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            logger.error("get_symbol_specs %s utente %s: %s", symbol, user_id, exc)
            return {"error": str(exc)}

    # ── Lettura posizioni e ordini ────────────────────────────────────────────

    async def get_positions(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        symbol: str | None = None,
    ) -> list[dict]:
        """
        Restituisce le posizioni aperte. Se symbol è specificato, filtra per simbolo.
        Ogni dict contiene: ticket, symbol, order_type, lots, entry_price,
        current_price, sl, tp, profit, pips, open_time, signal_group_id.
        """
        def _fn(mt5):
            if symbol:
                positions = mt5.positions_get(symbol=symbol) or []
            else:
                positions = mt5.positions_get() or []

            result = []
            for p in positions:
                # signal_group_id codificato nel comment come "TgBot:<id>"
                sig_group = None
                if p.comment and ":" in p.comment:
                    sig_group = p.comment.split(":", 1)[1]

                # Calcolo pips
                sym_info = mt5.symbol_info(p.symbol)
                digits   = sym_info.digits if sym_info else 5
                pip_pos  = digits - 1 if digits >= 3 else digits
                pip_mul  = 10 ** pip_pos
                pips = round(
                    (p.price_current - p.price_open) * pip_mul
                    if p.type == 0  # POSITION_TYPE_BUY
                    else (p.price_open - p.price_current) * pip_mul,
                    2,
                )

                result.append({
                    "ticket":          p.ticket,
                    "symbol":          p.symbol,
                    "order_type":      "BUY" if p.type == 0 else "SELL",
                    "lots":            p.volume,
                    "entry_price":     p.price_open,
                    "current_price":   p.price_current,
                    "sl":              p.sl   if p.sl   != 0.0 else None,
                    "tp":              p.tp   if p.tp   != 0.0 else None,
                    "profit":          round(p.profit, 2),
                    "swap":            round(p.swap,   2),
                    "pips":            pips,
                    "open_time":       datetime.fromtimestamp(p.time, tz=timezone.utc).isoformat(),
                    "magic":           p.magic,
                    "comment":         p.comment,
                    "signal_group_id": sig_group,
                })
            return result

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            logger.error("get_positions utente %s: %s", user_id, exc)
            return []

    async def get_pending_orders_list(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        symbol: str | None = None,
    ) -> list[dict]:
        """Restituisce gli ordini pendenti."""
        def _fn(mt5):
            if symbol:
                orders = mt5.orders_get(symbol=symbol) or []
            else:
                orders = mt5.orders_get() or []

            _type_map = {
                2: "BUY_LIMIT", 3: "SELL_LIMIT",
                4: "BUY_STOP",  5: "SELL_STOP",
                6: "BUY_STOP_LIMIT", 7: "SELL_STOP_LIMIT",
            }
            result = []
            for o in orders:
                sig_group = None
                if o.comment and ":" in o.comment:
                    sig_group = o.comment.split(":", 1)[1]
                result.append({
                    "ticket":          o.ticket,
                    "symbol":          o.symbol,
                    "order_type":      _type_map.get(o.type, str(o.type)),
                    "lots":            o.volume_current,
                    "price":           o.price_open,
                    "sl":              o.sl if o.sl != 0.0 else None,
                    "tp":              o.tp if o.tp != 0.0 else None,
                    "created_time":    datetime.fromtimestamp(o.time_setup, tz=timezone.utc).isoformat(),
                    "magic":           o.magic,
                    "comment":         o.comment,
                    "signal_group_id": sig_group,
                })
            return result

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            logger.error("get_pending_orders_list utente %s: %s", user_id, exc)
            return []

    async def get_closed_deals(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        days: int = 1,
        symbol: str | None = None,
    ) -> list[dict]:
        """
        Restituisce i deal di chiusura degli ultimi N giorni.
        Ogni dict contiene: ticket, position_id, symbol, order_type,
        lots, price, profit, reason, close_time.
        """
        def _fn(mt5):
            date_from = datetime.now(timezone.utc) - timedelta(days=days)
            date_to   = datetime.now(timezone.utc) + timedelta(hours=1)

            if symbol:
                deals = mt5.history_deals_get(date_from, date_to, group=symbol) or []
            else:
                deals = mt5.history_deals_get(date_from, date_to) or []

            _reason_map = {
                0: "CLIENT",   1: "MOBILE", 2: "WEB",
                3: "EXPERT",   4: "SL",     5: "TP",
                6: "SO",       8: "ROLLOVER",
            }
            result = []
            for d in deals:
                if d.type not in (0, 1):   # solo BUY/SELL, no balance/credit
                    continue
                # entry=1 → deal di apertura, entry=2 → deal di chiusura
                # Includiamo entrambi per avere storico completo
                result.append({
                    "ticket":      d.ticket,
                    "position_id": d.position_id,
                    "symbol":      d.symbol,
                    "order_type":  "BUY" if d.type == 0 else "SELL",
                    "lots":        d.volume,
                    "price":       d.price,
                    "profit":      round(d.profit, 2),
                    "swap":        round(d.swap,   2),
                    "commission":  round(d.commission, 2),
                    "reason":      _reason_map.get(d.reason, str(d.reason)),
                    "entry":       "IN" if d.entry == 0 else ("OUT" if d.entry == 1 else "INOUT"),
                    "close_time":  datetime.fromtimestamp(d.time, tz=timezone.utc).isoformat(),
                    "comment":     d.comment,
                })
            return result

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            logger.error("get_closed_deals utente %s: %s", user_id, exc)
            return []

    # ── Modifica posizioni aperte ─────────────────────────────────────────────

    async def modify_position(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        ticket: int,
        new_sl: float | None = None,
        new_tp: float | None = None,
    ) -> dict:
        """
        Modifica SL e/o TP di una posizione aperta.
        I valori None lasciano invariato il valore attuale.
        Ritorna {"success": bool, "error": str | None}.
        """
        def _fn(mt5):
            pos = mt5.positions_get(ticket=ticket)
            if not pos:
                return {"success": False, "error": f"Posizione #{ticket} non trovata"}
            p = pos[0]
            sl = new_sl if new_sl is not None else p.sl
            tp = new_tp if new_tp is not None else p.tp
            request = {
                "action":   mt5.TRADE_ACTION_SLTP,
                "position": ticket,
                "symbol":   p.symbol,
                "sl":       sl,
                "tp":       tp,
            }
            res = mt5.order_send(request)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                comment = getattr(res, "comment", "?")
                retcode = getattr(res, "retcode", -1)
                return {"success": False, "error": f"{comment} (retcode {retcode})"}
            logger.info(
                "Utente %s | modify_position #%d SL=%.5f TP=%.5f OK",
                user_id, ticket, sl, tp,
            )
            return {"success": True, "error": None}

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def set_breakeven(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        ticket: int,
        offset_pips: float = 0.0,
    ) -> dict:
        """
        Sposta lo SL al prezzo di entry + offset_pips (in direzione del profitto).
        offset_pips=0 → SL esattamente al break even.
        offset_pips=2 → SL 2 pips oltre il break even (garantisce piccolo profitto).
        """
        def _fn(mt5):
            pos = mt5.positions_get(ticket=ticket)
            if not pos:
                return {"success": False, "error": f"Posizione #{ticket} non trovata"}
            p = pos[0]

            sym = mt5.symbol_info(p.symbol)
            digits  = sym.digits if sym else 5
            pip_pos = digits - 1 if digits >= 3 else digits
            pip_size = 10 ** -pip_pos  # es. 0.0001 per EURUSD

            if p.type == 0:  # BUY → SL deve stare sopra entry
                new_sl = p.price_open + offset_pips * pip_size
            else:            # SELL → SL deve stare sotto entry
                new_sl = p.price_open - offset_pips * pip_size

            # Arrotonda ai digits del simbolo
            new_sl = round(new_sl, digits)

            request = {
                "action":   mt5.TRADE_ACTION_SLTP,
                "position": ticket,
                "symbol":   p.symbol,
                "sl":       new_sl,
                "tp":       p.tp,
            }
            res = mt5.order_send(request)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                comment = getattr(res, "comment", "?")
                retcode = getattr(res, "retcode", -1)
                return {"success": False, "error": f"{comment} (retcode {retcode})"}
            logger.info(
                "Utente %s | set_breakeven #%d → SL=%.5f (offset %.1f pips) OK",
                user_id, ticket, new_sl, offset_pips,
            )
            return {"success": True, "error": None, "new_sl": new_sl}

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def close_position_by_ticket(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        ticket: int,
        lots: float | None = None,
    ) -> dict:
        """
        Chiude parzialmente (lots specificato) o totalmente (lots=None) una posizione.
        """
        def _fn(mt5):
            pos = mt5.positions_get(ticket=ticket)
            if not pos:
                return {"success": False, "error": f"Posizione #{ticket} non trovata"}
            p = pos[0]

            vol = lots if lots is not None else p.volume
            # Arrotonda al volume_step del simbolo
            sym = mt5.symbol_info(p.symbol)
            if sym:
                vol = max(sym.volume_min,
                          round(vol / sym.volume_step) * sym.volume_step)

            tick = mt5.symbol_info_tick(p.symbol)
            if tick is None:
                return {"success": False, "error": f"Tick non disponibile per {p.symbol}"}

            # Per chiudere: ordine opposto alla direzione della posizione
            if p.type == 0:  # BUY → chiudi con SELL
                close_type = mt5.ORDER_TYPE_SELL
                close_price = tick.bid
            else:            # SELL → chiudi con BUY
                close_type = mt5.ORDER_TYPE_BUY
                close_price = tick.ask

            request = {
                "action":       mt5.TRADE_ACTION_DEAL,
                "position":     ticket,
                "symbol":       p.symbol,
                "volume":       vol,
                "type":         close_type,
                "price":        close_price,
                "deviation":    20,
                "magic":        234000,
                "comment":      "TgBot:close",
                "type_time":    mt5.ORDER_TIME_GTC,
                "type_filling": mt5.ORDER_FILLING_RETURN,
            }
            res = mt5.order_send(request)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                comment = getattr(res, "comment", "?")
                retcode = getattr(res, "retcode", -1)
                return {"success": False, "error": f"{comment} (retcode {retcode})"}
            logger.info(
                "Utente %s | close_position #%d %.2f lotti @%.5f OK",
                user_id, ticket, vol, close_price,
            )
            return {"success": True, "error": None, "order_id": res.order}

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def cancel_order_by_ticket(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        ticket: int,
    ) -> dict:
        """Cancella un ordine pendente."""
        def _fn(mt5):
            orders = mt5.orders_get(ticket=ticket)
            if not orders:
                return {"success": False, "error": f"Ordine pendente #{ticket} non trovato"}
            request = {
                "action": mt5.TRADE_ACTION_REMOVE,
                "order":  ticket,
            }
            res = mt5.order_send(request)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                comment = getattr(res, "comment", "?")
                retcode = getattr(res, "retcode", -1)
                return {"success": False, "error": f"{comment} (retcode {retcode})"}
            logger.info("Utente %s | cancel_order #%d OK", user_id, ticket)
            return {"success": True, "error": None}

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def modify_order_by_ticket(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        ticket: int,
        new_price: float | None = None,
        new_sl:    float | None = None,
        new_tp:    float | None = None,
    ) -> dict:
        """Modifica prezzo, SL e/o TP di un ordine pendente."""
        def _fn(mt5):
            orders = mt5.orders_get(ticket=ticket)
            if not orders:
                return {"success": False, "error": f"Ordine pendente #{ticket} non trovato"}
            o = orders[0]
            request = {
                "action":    mt5.TRADE_ACTION_MODIFY,
                "order":     ticket,
                "price":     new_price if new_price is not None else o.price_open,
                "sl":        new_sl    if new_sl    is not None else o.sl,
                "tp":        new_tp    if new_tp    is not None else o.tp,
                "type_time": mt5.ORDER_TIME_GTC,
            }
            res = mt5.order_send(request)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                comment = getattr(res, "comment", "?")
                retcode = getattr(res, "retcode", -1)
                return {"success": False, "error": f"{comment} (retcode {retcode})"}
            logger.info("Utente %s | modify_order #%d OK", user_id, ticket)
            return {"success": True, "error": None}

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def open_new_market_order(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        symbol: str,
        order_type: str,       # "BUY" | "SELL"
        lots: float,
        sl: float | None = None,
        tp: float | None = None,
        signal_group_id: str | None = None,
        comment_suffix: str = "",
    ) -> dict:
        """Apre un nuovo ordine a mercato (usato da strategie che vogliono aprire posizioni)."""
        def _fn(mt5):
            if mt5.symbol_info(symbol) is None:
                mt5.symbol_select(symbol, True)
            sym = mt5.symbol_info(symbol)
            if sym is None:
                return {"success": False, "error": f"Simbolo {symbol!r} non trovato"}
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                return {"success": False, "error": f"Tick non disponibile per {symbol}"}

            ot_upper = order_type.upper()
            if ot_upper == "BUY":
                mt5_type = mt5.ORDER_TYPE_BUY
                price    = tick.ask
            else:
                mt5_type = mt5.ORDER_TYPE_SELL
                price    = tick.bid

            vol = max(sym.volume_min,
                      round(lots / sym.volume_step) * sym.volume_step)
            vol = min(vol, sym.volume_max)

            base_comment = f"TgBot:{signal_group_id}" if signal_group_id else "TgBot"
            comment = f"{base_comment}{':' + comment_suffix if comment_suffix else ''}"

            request = {
                "action":       mt5.TRADE_ACTION_DEAL,
                "symbol":       symbol,
                "volume":       vol,
                "type":         mt5_type,
                "price":        price,
                "sl":           sl or 0.0,
                "tp":           tp or 0.0,
                "deviation":    20,
                "magic":        234000,
                "comment":      comment,
                "type_time":    mt5.ORDER_TIME_GTC,
                "type_filling": mt5.ORDER_FILLING_RETURN,
            }
            res = mt5.order_send(request)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                c = getattr(res, "comment", "?")
                r = getattr(res, "retcode", -1)
                return {"success": False, "error": f"{c} (retcode {r})"}
            logger.info(
                "Utente %s | open_market %s %s %.2f lot @%.5f OK ordine #%d",
                user_id, ot_upper, symbol, vol, price, res.order,
            )
            return {"success": True, "order_id": res.order, "error": None}

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def place_new_pending_order(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        symbol: str,
        order_type: str,   # "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP"
        price: float,
        lots: float,
        sl: float | None = None,
        tp: float | None = None,
        signal_group_id: str | None = None,
    ) -> dict:
        """Piazza un nuovo ordine pendente."""
        def _fn(mt5):
            if mt5.symbol_info(symbol) is None:
                mt5.symbol_select(symbol, True)
            sym = mt5.symbol_info(symbol)
            if sym is None:
                return {"success": False, "error": f"Simbolo {symbol!r} non trovato"}

            _type_map = {
                "BUY_LIMIT":  mt5.ORDER_TYPE_BUY_LIMIT,
                "SELL_LIMIT": mt5.ORDER_TYPE_SELL_LIMIT,
                "BUY_STOP":   mt5.ORDER_TYPE_BUY_STOP,
                "SELL_STOP":  mt5.ORDER_TYPE_SELL_STOP,
            }
            mt5_type = _type_map.get(order_type.upper())
            if mt5_type is None:
                return {"success": False, "error": f"Tipo ordine non valido: {order_type!r}"}

            vol = max(sym.volume_min,
                      round(lots / sym.volume_step) * sym.volume_step)
            vol = min(vol, sym.volume_max)

            comment = f"TgBot:{signal_group_id}" if signal_group_id else "TgBot"

            request = {
                "action":       mt5.TRADE_ACTION_PENDING,
                "symbol":       symbol,
                "volume":       vol,
                "type":         mt5_type,
                "price":        price,
                "sl":           sl or 0.0,
                "tp":           tp or 0.0,
                "deviation":    20,
                "magic":        234000,
                "comment":      comment,
                "type_time":    mt5.ORDER_TIME_GTC,
                "type_filling": mt5.ORDER_FILLING_RETURN,
            }
            res = mt5.order_send(request)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                c = getattr(res, "comment", "?")
                r = getattr(res, "retcode", -1)
                return {"success": False, "error": f"{c} (retcode {r})"}
            logger.info(
                "Utente %s | pending %s %s @%.5f %.2f lot OK ordine #%d",
                user_id, order_type, symbol, price, vol, res.order,
            )
            return {"success": True, "order_id": res.order, "error": None}

        try:
            return await self._run_mt5_async(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # ── Helper per PositionWatcher (sync, gira già nell'executor del watcher) ─

    def get_positions_sync(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
    ) -> dict[int, dict]:
        """
        Snapshot sincrono delle posizioni aperte. Usato dal PositionWatcher.
        Ritorna {ticket: position_dict}.
        """
        def _fn(mt5):
            positions = mt5.positions_get() or []
            _reason_map = {0: "CLIENT", 3: "EXPERT", 4: "SL", 5: "TP", 6: "SO"}
            result: dict[int, dict] = {}
            for p in positions:
                sig_group = None
                if p.comment and ":" in p.comment:
                    sig_group = p.comment.split(":", 1)[1]
                result[p.ticket] = {
                    "ticket":          p.ticket,
                    "symbol":          p.symbol,
                    "order_type":      "BUY" if p.type == 0 else "SELL",
                    "lots":            p.volume,
                    "entry_price":     p.price_open,
                    "current_price":   p.price_current,
                    "sl":              p.sl   if p.sl   != 0.0 else None,
                    "tp":              p.tp   if p.tp   != 0.0 else None,
                    "profit":          round(p.profit, 2),
                    "open_time":       datetime.fromtimestamp(p.time, tz=timezone.utc).isoformat(),
                    "comment":         p.comment,
                    "signal_group_id": sig_group,
                }
            return result

        return self._run_mt5(user_id, mt5_login, mt5_password, mt5_server, _fn)

    def get_last_closed_deal_sync(
        self,
        user_id: str,
        mt5_login: int,
        mt5_password: str,
        mt5_server: str,
        position_id: int,
    ) -> dict | None:
        """
        Recupera l'ultimo deal di chiusura per un position_id.
        Usato dal PositionWatcher per determinare il motivo della chiusura (TP/SL/manuale).
        """
        def _fn(mt5):
            date_from = datetime.now(timezone.utc) - timedelta(days=7)
            date_to   = datetime.now(timezone.utc) + timedelta(hours=1)
            deals = mt5.history_deals_get(date_from, date_to) or []
            # Cerca deal con entry=OUT (1) appartenente a questa posizione
            closing = [
                d for d in deals
                if d.position_id == position_id and d.entry in (1, 3)  # OUT o INOUT
            ]
            if not closing:
                return None
            d = closing[-1]  # il più recente
            _reason_map = {
                0: "CLIENT", 1: "MOBILE", 2: "WEB",
                3: "EXPERT", 4: "SL",     5: "TP", 6: "SO",
            }
            return {
                "ticket":      d.ticket,
                "position_id": d.position_id,
                "symbol":      d.symbol,
                "price":       d.price,
                "profit":      round(d.profit, 2),
                "reason":      _reason_map.get(d.reason, str(d.reason)),
                "close_time":  datetime.fromtimestamp(d.time, tz=timezone.utc).isoformat(),
            }

        try:
            return self._run_mt5(user_id, mt5_login, mt5_password, mt5_server, _fn)
        except Exception as exc:
            logger.warning("get_last_closed_deal_sync utente %s pos %d: %s", user_id, position_id, exc)
            return None
