"""
RangeOrderWatcher — monitora ordini pendenti con entry a range.

Per ogni utente con ordini di questo tipo, apre una sessione MT5 dedicata
durante il ciclo di controllo (ogni 5 secondi) e la chiude al termine.
Cancella l'ordine se TP o SL vengono raggiunti prima del fill.

Design:
  - Task asyncio unico che itera sugli utenti monitorati ogni POLL_INTERVAL sec.
  - Per ogni utente: una sola sessione MT5 (initialize → check tutti gli ordini → shutdown).
  - Executor single-worker separato da MT5Trader per evitare interferenze.
  - Nessun lock asyncio necessario: add() e il loop interno girano entrambi
    sull'event loop asyncio (single-thread), quindi self._watched è thread-safe.
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

# Worker singolo: MT5 è un singleton per processo, non possono girare
# due sessioni in parallelo senza interferire.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mt5-watch")


# ── Struttura dati ────────────────────────────────────────────────────────────

@dataclass
class WatchedOrder:
    ticket:       int
    symbol:       str
    order_type:   str          # "BUY" | "SELL"
    sl:           float | None
    tp:           float | None
    user_id:      str
    user_dir:     Path         # <mt5_users_dir>/<user_id>
    mt5_login:    int
    mt5_password: str
    mt5_server:   str


# ── Classe principale ─────────────────────────────────────────────────────────

class RangeOrderWatcher:
    """
    Avvio:
        watcher = RangeOrderWatcher()
        watcher.start()          # crea il task asyncio
        watcher.add(order)       # registra un ordine range
        await watcher.stop()     # cancella il task
    """

    POLL_INTERVAL = 5  # secondi

    def __init__(self) -> None:
        # user_id → lista di ordini monitorati
        self._watched: dict[str, list[WatchedOrder]] = {}
        self._task: asyncio.Task | None = None

    # ── API pubblica ──────────────────────────────────────────────────────────

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="range-watcher")
        logger.info("RangeOrderWatcher avviato (poll ogni %ds)", self.POLL_INTERVAL)

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("RangeOrderWatcher fermato")

    def add(self, order: WatchedOrder) -> None:
        """Registra un nuovo ordine range. Chiamabile da coroutine asyncio."""
        self._watched.setdefault(order.user_id, []).append(order)
        logger.info(
            "Watcher: aggiunto ordine #%d %s %s | SL=%s TP=%s | utente %s",
            order.ticket, order.order_type, order.symbol,
            order.sl, order.tp, order.user_id,
        )

    # ── Loop interno ──────────────────────────────────────────────────────────

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self.POLL_INTERVAL)

            if not self._watched:
                continue

            # Snapshot: lista di (user_id, ordini) da controllare questo ciclo
            snapshot = list(self._watched.items())

            loop = asyncio.get_event_loop()
            for user_id, orders in snapshot:
                # Passa una copia della lista: il thread non modifica self._watched
                tickets_done: set[int] = await loop.run_in_executor(
                    _executor,
                    _check_user_sync,
                    list(orders),
                )

                if not tickets_done:
                    continue

                # Rimuovi i ticket completati dalla struttura asyncio
                remaining = [
                    o for o in self._watched.get(user_id, [])
                    if o.ticket not in tickets_done
                ]
                if remaining:
                    self._watched[user_id] = remaining
                else:
                    self._watched.pop(user_id, None)


# ── Sync helpers (girano in ThreadPoolExecutor) ───────────────────────────────

def _check_user_sync(orders: list[WatchedOrder]) -> set[int]:
    """
    Apre una sessione MT5 per l'utente, controlla tutti i suoi ordini range,
    chiude la sessione. Ritorna i ticket da rimuovere dal watch.
    """
    if not orders:
        return set()

    try:
        import MetaTrader5 as mt5
    except ImportError:
        logger.error("Watcher: libreria MetaTrader5 non disponibile")
        return set()

    first = orders[0]
    terminal_path = str(first.user_dir / "terminal64.exe")

    if not mt5.initialize(path=terminal_path, portable=True):
        code, msg = mt5.last_error()
        logger.warning(
            "Watcher utente %s: initialize fallito (%s, cod.%d) — skip ciclo",
            first.user_id, msg, code,
        )
        return set()

    if not mt5.login(first.mt5_login, password=first.mt5_password, server=first.mt5_server):
        code, msg = mt5.last_error()
        logger.warning(
            "Watcher utente %s: login fallito (%s, cod.%d) — skip ciclo",
            first.user_id, msg, code,
        )
        mt5.shutdown()
        return set()

    done: set[int] = set()
    try:
        for order in orders:
            _check_single_order(mt5, order, done)
    finally:
        mt5.shutdown()

    return done


def _check_single_order(mt5, order: WatchedOrder, done: set[int]) -> None:
    """Controlla un singolo ordine pendente e agisce di conseguenza."""

    # Verifica se l'ordine è ancora pendente
    pending = mt5.orders_get(ticket=order.ticket)
    if not pending:
        # Fill avvenuto o cancellazione esterna: rimuovi dal watch
        logger.info(
            "Watcher: ordine #%d %s %s non più pendente (fill o cancellazione esterna)",
            order.ticket, order.order_type, order.symbol,
        )
        done.add(order.ticket)
        return

    tick = mt5.symbol_info_tick(order.symbol)
    if tick is None:
        logger.warning(
            "Watcher: tick non disponibile per %s — skip questo ciclo",
            order.symbol,
        )
        return

    if _is_invalidated(order, tick):
        _cancel_order(mt5, order)
        done.add(order.ticket)


def _cancel_order(mt5, order: WatchedOrder) -> None:
    """Invia TRADE_ACTION_REMOVE per cancellare l'ordine pendente."""
    request = {
        "action": mt5.TRADE_ACTION_REMOVE,
        "order":  order.ticket,
    }
    res = mt5.order_send(request)
    if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
        retcode = getattr(res, "retcode", -1)
        comment = getattr(res, "comment", "?")
        logger.error(
            "Watcher: cancellazione ordine #%d fallita — %s (retcode %d)",
            order.ticket, comment, retcode,
        )
    else:
        logger.info(
            "Watcher: ordine #%d %s %s cancellato — TP/SL raggiunto prima del fill",
            order.ticket, order.order_type, order.symbol,
        )


def _is_invalidated(order: WatchedOrder, tick) -> bool:
    """
    Ritorna True se il segnale è diventato invalido perché TP o SL
    sono stati raggiunti prima che l'ordine venisse eseguito.

    BUY LIMIT (attende discesa del prezzo verso l'entry):
        - sl colpito: bid <= sl  (prezzo crollato sotto lo stop)
        - tp colpito: bid >= tp  (prezzo salito oltre il target senza toccare l'entry)

    SELL LIMIT (attende salita del prezzo verso l'entry):
        - sl colpito: ask >= sl  (prezzo salito oltre lo stop)
        - tp colpito: ask <= tp  (prezzo sceso sotto il target senza toccare l'entry)
    """
    if order.order_type == "BUY":
        price = tick.bid
        if order.sl is not None and price <= order.sl:
            logger.info(
                "Watcher: ordine #%d — SL %.5f colpito (bid=%.5f)",
                order.ticket, order.sl, price,
            )
            return True
        if order.tp is not None and price >= order.tp:
            logger.info(
                "Watcher: ordine #%d — TP %.5f colpito prima del fill (bid=%.5f)",
                order.ticket, order.tp, price,
            )
            return True
    else:  # SELL
        price = tick.ask
        if order.sl is not None and price >= order.sl:
            logger.info(
                "Watcher: ordine #%d — SL %.5f colpito (ask=%.5f)",
                order.ticket, order.sl, price,
            )
            return True
        if order.tp is not None and price <= order.tp:
            logger.info(
                "Watcher: ordine #%d — TP %.5f colpito prima del fill (ask=%.5f)",
                order.ticket, order.tp, price,
            )
            return True
    return False
