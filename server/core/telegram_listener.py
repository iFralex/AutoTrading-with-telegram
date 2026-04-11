from __future__ import annotations

"""
Telegram live listener.

Gira in un thread separato con il proprio event loop asyncio.
I messaggi in arrivo vengono messi in una queue thread-safe che la GUI
svuota periodicamente tramite root.after().
"""

import asyncio
import queue
import selectors
import threading
from datetime import datetime

from telethon import TelegramClient, events


class TelegramListener:
    def __init__(self, message_queue: queue.Queue, group_id: int, status_callback=None):
        """
        message_queue   – queue.Queue in cui vengono inseriti i messaggi
        group_id        – ID del gruppo/canale da ascoltare
        status_callback – funzione chiamata con (bool connected, str info)
        """
        self._queue = message_queue
        self._group_id = group_id
        self._status_cb = status_callback or (lambda ok, msg: None)
        self._client: TelegramClient | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None

    # ── public ──────────────────────────────────────────────────────────────

    def start(self):
        """Avvia il listener in background."""
        self._thread = threading.Thread(target=self._run, daemon=True, name='TelegramListener')
        self._thread.start()

    def stop(self):
        """Ferma il listener."""
        if self._loop and self._client:
            asyncio.run_coroutine_threadsafe(self._client.disconnect(), self._loop)

    # ── internals ───────────────────────────────────────────────────────────

    def _run(self):
        # SelectorEventLoop esplicito: evita il conflitto con il notifier Tcl/tk su macOS
        self._loop = asyncio.SelectorEventLoop(selectors.SelectSelector())
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._listen())
        except Exception as exc:
            self._status_cb(False, f'Errore: {exc}')

    async def _listen(self):
        import config
        self._client = TelegramClient(
            config.TELEGRAM_SESSION,
            config.TELEGRAM_API_ID,
            config.TELEGRAM_API_HASH,
        )

        # La sessione è già autenticata da main.py — start() è istantaneo
        await self._client.start()

        me = await self._client.get_me()
        self._status_cb(True, f'Connesso come {me.first_name} ({me.phone})')

        @self._client.on(events.NewMessage(chats=self._group_id))
        async def _handler(event):
            msg = event.message
            sender = await event.get_sender()
            name = self._format_name(sender)
            self._queue.put({
                'id':     msg.id,
                'date':   msg.date.strftime('%H:%M:%S') if msg.date else datetime.now().strftime('%H:%M:%S'),
                'sender': name,
                'text':   msg.text or '',
            })

        await self._client.run_until_disconnected()
        self._status_cb(False, 'Disconnesso')

    @staticmethod
    def _format_name(sender) -> str:
        if sender is None:
            return 'Anonimo'
        first = getattr(sender, 'first_name', '') or ''
        last  = getattr(sender, 'last_name',  '') or ''
        title = getattr(sender, 'title',      '') or ''
        full  = f'{first} {last}'.strip()
        return full if full else title if title else str(getattr(sender, 'id', '?'))
