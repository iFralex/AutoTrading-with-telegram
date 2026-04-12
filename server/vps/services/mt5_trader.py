"""
MT5Trader — esegue ordini su MetaTrader 5 in modalità portable.

Ogni utente ha una copia dell'installazione MT5 in:
    <mt5_users_dir>/<user_id>/terminal64.exe

Al primo ordine di un utente, la directory viene creata copiando il template.
L'esecuzione è sincrona (libreria MT5) e avviene in ThreadPoolExecutor
per non bloccare l'event loop asyncio.

Un singolo blocco initialize/login/order_send/shutdown per ogni chiamata
a execute_signals(), così MT5 non rimane aperto tra un segnale e l'altro.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from vps.services.signal_processor import TradeSignal

logger = logging.getLogger(__name__)

# Pool dedicato: una thread per utente alla volta va bene, max 8 paralleli
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="mt5-trade")


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
            user_dir = self._ensure_user_dir(user_id)
        except Exception:
            return None

        terminal_path = str(user_dir / "terminal64.exe")

        if not mt5.initialize(path=terminal_path, portable=True):
            return None

        try:
            if not mt5.login(login, password=password, server=server):
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
    ) -> list[TradeResult]:
        """
        Esegue tutti i segnali per l'utente in un unico blocco MT5
        (una sola initialize/shutdown per tutti gli ordini del batch).
        """
        if not signals:
            return []

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            _executor,
            self._execute_block,
            user_id, signals, mt5_login, mt5_password, mt5_server,
        )

    # ── Sync — gira in ThreadPoolExecutor ─────────────────────────────────────

    def _ensure_user_dir(self, user_id: str) -> Path:
        """Crea la directory MT5 dell'utente dal template se non esiste ancora."""
        user_dir = self._users_dir / user_id
        if not (user_dir / "terminal64.exe").exists():
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
        return user_dir

    def _execute_block(
        self,
        user_id: str,
        signals: list[TradeSignal],
        login: int,
        password: str,
        server: str,
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
            user_dir = self._ensure_user_dir(user_id)
        except Exception as exc:
            msg = str(exc)
            logger.error("Utente %s — setup MT5: %s", user_id, msg)
            return [TradeResult(success=False, error=msg, signal=s) for s in signals]

        terminal_path = str(user_dir / "terminal64.exe")
        results: list[TradeResult] = []

        try:
            # ── Inizializza ───────────────────────────────────────────────────
            if not mt5.initialize(path=terminal_path, portable=True):
                code, msg = mt5.last_error()
                err = f"MT5 non avviabile: {msg} (codice {code})"
                logger.error("Utente %s — %s", user_id, err)
                return [TradeResult(success=False, error=err, signal=s) for s in signals]

            # ── Login ─────────────────────────────────────────────────────────
            if not mt5.login(login, password=password, server=server):
                code, msg = mt5.last_error()
                err = f"Login MT5 fallito: {msg} (codice {code})"
                logger.error("Utente %s — %s", user_id, err)
                return [TradeResult(success=False, error=err, signal=s) for s in signals]

            logger.info(
                "Utente %s — MT5 connesso a %s, invio %d ordini...",
                user_id, server, len(signals),
            )

            # ── Ordini ────────────────────────────────────────────────────────
            for sig in signals:
                results.append(self._send_order(mt5, sig, user_id))

        finally:
            mt5.shutdown()

        return results

    def _send_order(self, mt5, sig: TradeSignal, user_id: str) -> TradeResult:
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
            "comment":      "TgBot",
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
