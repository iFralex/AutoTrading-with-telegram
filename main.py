"""
Entry point.

Flusso:
  1. Se config.py non esiste → schermata guidata per creare le credenziali.
  2. Autentica Telegram nel main thread (stdin disponibile, nessun conflitto Tcl).
     Se la sessione esiste già il blocco è istantaneo.
  3. Avvia la GUI (tkinter mainloop nel main thread).
"""

import asyncio
import os
import sys


# ── Primo avvio: config.py mancante ──────────────────────────────────────────

_config_path = os.path.join(os.path.dirname(__file__), 'config.py')

if not os.path.exists(_config_path):
    from gui.config_setup import run_config_setup
    run_config_setup()
    # Se l'utente ha annullato senza salvare, usciamo
    if not os.path.exists(_config_path):
        print("Configurazione annullata.")
        sys.exit(0)


# ── Importa config solo dopo che il file esiste ───────────────────────────────

import config  # noqa: E402  (importazione posticipata intenzionale)
from telethon import TelegramClient  # noqa: E402


async def _ensure_auth():
    """Apre e chiude il client per completare l'autenticazione interattiva."""
    client = TelegramClient(
        config.TELEGRAM_SESSION,
        config.TELEGRAM_API_ID,
        config.TELEGRAM_API_HASH,
    )
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
