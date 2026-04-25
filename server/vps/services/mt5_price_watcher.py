"""
PriceLevelWatcher — monitora livelli di prezzo per posizioni aperte.

Quando una posizione tocca un livello prezzo calcolato dalla management strategy
durante l'estrazione del segnale, emette un evento "price_level_reached" verso
il callback configurato, che chiama StrategyExecutor.on_event() con function calling.

Design:
  - Task asyncio unico, poll ogni POLL_INTERVAL secondi.
  - Per ogni utente: sessione MT5 sincrona (initialize → tick → shutdown)
    nello stesso _executor single-worker usato da PositionWatcher e RangeOrderWatcher.
  - Ogni livello è one-shot: rimosso al primo trigger per non rieseguire la strategia.
  - remove_by_ticket() permette di ripulire i livelli quando la posizione viene chiusa.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mt5-price-watch")
_level_counter = itertools.count()

POLL_INTERVAL = 5  # secondi


# ── Tipo callback ──────────────────────────────────────────────────────────────

OnPriceLevelCallback = Callable[
    [str, dict, str, int, str, str],   # user_id, event_data, mgmt_strategy, login, pwd, server
    Awaitable[None],
]


# ── Struttura dati ─────────────────────────────────────────────────────────────

@dataclass
class WatchedPriceLevel:
    ticket:              int
    symbol:              str
    order_type:          str           # "BUY" | "SELL"
    price:               float         # livello da monitorare
    management_strategy: str
    user_id:             str
    user_dir:            Path
    mt5_login:           int
    mt5_password:        str
    mt5_server:          str
    signal_group_id:     str | None = None
    level_id:            int = field(default_factory=lambda: next(_level_counter))


# ── Classe principale ──────────────────────────────────────────────────────────

class PriceLevelWatcher:
    """
    Avvio:
        watcher = PriceLevelWatcher(on_event=callback)
        watcher.start()
        watcher.add(level)       # registra un livello prezzo
        watcher.remove_by_ticket(user_id, ticket)  # pulizia alla chiusura posizione
        await watcher.stop()
    """

    def __init__(self, on_event: OnPriceLevelCallback) -> None:
        self._on_event = on_event
        # user_id → lista di livelli monitorati
        self._watched: dict[str, list[WatchedPriceLevel]] = {}
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="price-level-watcher")
        logger.info("PriceLevelWatcher avviato (poll ogni %ds)", POLL_INTERVAL)

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("PriceLevelWatcher fermato")

    def add(self, level: WatchedPriceLevel) -> None:
        """Registra un nuovo livello prezzo. Chiamabile da coroutine asyncio."""
        self._watched.setdefault(level.user_id, []).append(level)
        logger.info(
            "PriceLevelWatcher: aggiunto livello %.5f per ticket #%d %s %s | utente %s",
            level.price, level.ticket, level.order_type, level.symbol, level.user_id,
        )

    def remove_by_ticket(self, user_id: str, ticket: int) -> None:
        """Rimuove tutti i livelli associati a un ticket (es. alla chiusura posizione)."""
        if user_id not in self._watched:
            return
        before = len(self._watched[user_id])
        remaining = [lv for lv in self._watched[user_id] if lv.ticket != ticket]
        removed = before - len(remaining)
        if remaining:
            self._watched[user_id] = remaining
        else:
            self._watched.pop(user_id, None)
        if removed:
            logger.info(
                "PriceLevelWatcher: rimossi %d livelli per ticket #%d utente %s",
                removed, ticket, user_id,
            )

    # ── Loop interno ───────────────────────────────────────────────────────────

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(POLL_INTERVAL)

            if not self._watched:
                continue

            snapshot = list(self._watched.items())
            loop = asyncio.get_event_loop()

            for user_id, levels in snapshot:
                if not levels:
                    continue

                # Controlla i livelli nel thread MT5
                triggered_ids: set[int] = await loop.run_in_executor(
                    _executor,
                    _check_levels_sync,
                    list(levels),
                )

                if not triggered_ids:
                    continue

                # Separa i livelli triggerati da quelli rimanenti
                to_fire:   list[WatchedPriceLevel] = []
                remaining: list[WatchedPriceLevel] = []
                for lv in self._watched.get(user_id, []):
                    if lv.level_id in triggered_ids:
                        to_fire.append(lv)
                    else:
                        remaining.append(lv)

                if remaining:
                    self._watched[user_id] = remaining
                else:
                    self._watched.pop(user_id, None)

                # Spara gli eventi (fire-and-forget, non blocca il loop)
                for lv in to_fire:
                    asyncio.get_event_loop().create_task(self._fire_event(lv))

    async def _fire_event(self, level: WatchedPriceLevel) -> None:
        try:
            await self._on_event(
                level.user_id,
                {
                    "ticket":          level.ticket,
                    "symbol":          level.symbol,
                    "order_type":      level.order_type,
                    "trigger_price":   level.price,
                    "signal_group_id": level.signal_group_id,
                },
                level.management_strategy,
                level.mt5_login,
                level.mt5_password,
                level.mt5_server,
            )
        except Exception as exc:
            logger.error(
                "PriceLevelWatcher: errore on_event per ticket #%d: %s",
                level.ticket, exc, exc_info=True,
            )


# ── Sync helpers (girano in ThreadPoolExecutor) ────────────────────────────────

def _check_levels_sync(levels: list[WatchedPriceLevel]) -> set[int]:
    """
    Apre una sessione MT5 per l'utente, controlla il tick per ogni livello,
    ritorna i level_id dei livelli che hanno raggiunto il prezzo target.
    """
    if not levels:
        return set()

    try:
        import MetaTrader5 as mt5
    except ImportError:
        logger.error("PriceLevelWatcher: libreria MetaTrader5 non disponibile")
        return set()

    first = levels[0]
    terminal_path = str(first.user_dir / "terminal64.exe")

    if not mt5.initialize(path=terminal_path, portable=True):
        code, msg = mt5.last_error()
        logger.warning(
            "PriceLevelWatcher utente %s: initialize fallito (%s, cod.%d) — skip ciclo",
            first.user_id, msg, code,
        )
        return set()

    if not mt5.login(first.mt5_login, password=first.mt5_password, server=first.mt5_server):
        code, msg = mt5.last_error()
        logger.warning(
            "PriceLevelWatcher utente %s: login fallito (%s, cod.%d) — skip ciclo",
            first.user_id, msg, code,
        )
        mt5.shutdown()
        return set()

    triggered: set[int] = set()
    try:
        for lv in levels:
            tick = mt5.symbol_info_tick(lv.symbol)
            if tick is None:
                logger.warning(
                    "PriceLevelWatcher: tick non disponibile per %s — skip",
                    lv.symbol,
                )
                continue
            if _is_triggered(lv, tick):
                triggered.add(lv.level_id)
                logger.info(
                    "PriceLevelWatcher: livello %.5f raggiunto per ticket #%d %s %s",
                    lv.price, lv.ticket, lv.order_type, lv.symbol,
                )
    finally:
        mt5.shutdown()

    return triggered


def _is_triggered(level: WatchedPriceLevel, tick) -> bool:
    """
    BUY: la posizione è long, il profitto cresce quando il prezzo sale.
         Trigger quando bid >= level.price.
    SELL: la posizione è short, il profitto cresce quando il prezzo scende.
          Trigger quando ask <= level.price.
    """
    if level.order_type == "BUY":
        return tick.bid >= level.price
    else:
        return tick.ask <= level.price
