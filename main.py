"""
Entry point.

1. Autentica Telegram nel main thread (stdin disponibile, nessun conflitto Tcl).
   Se la sessione esiste già il blocco è istantaneo.
2. Avvia la GUI (tkinter mainloop nel main thread).
"""

import asyncio
import sys

import config
from telethon import TelegramClient


async def _ensure_auth():
    """Apre e chiude il client per completare l'autenticazione interattiva."""
    client = TelegramClient(config.TELEGRAM_SESSION, config.TELEGRAM_API_ID, config.TELEGRAM_API_HASH)
    await client.start()          # chiede telefono/codice/2FA solo se serve
    me = await client.get_me()
    print(f"Autenticato come: {me.first_name} ({me.phone})")
    await client.disconnect()


if __name__ == '__main__':
    print("Verifica sessione Telegram...")
    try:
        asyncio.run(_ensure_auth())
    except KeyboardInterrupt:
        print("Autenticazione annullata.")
        sys.exit(0)
    except Exception as exc:
        print(f"Errore autenticazione: {exc}")
        sys.exit(1)

    from gui.app import App
    app = App()
    app.protocol('WM_DELETE_WINDOW', app.on_close)
    app.mainloop()
