"""
Gestione dei link segnale tra utenti.

Quando un link (SOURCE → TARGET) è attivo, ogni messaggio ricevuto da SOURCE
viene processato anche da TARGET con le proprie impostazioni (MT5, strategie, ecc.).

Utilizzo:
    python link_users.py list
    python link_users.py add <source_user_id> <target_user_id>
    python link_users.py remove <source_user_id> <target_user_id>
    python link_users.py clear <user_id>        # rimuove tutti i link dell'utente
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Rende importabile il package vps.* anche se lanciato da questa directory
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / "vps" / ".env")

from vps.services.user_store import UserStore

_DB_PATH = _ROOT / "data" / "users.db"


async def _list(store: UserStore) -> None:
    links = await store.list_all_links()
    if not links:
        print("Nessun link configurato.")
        return
    print(f"{'SORGENTE':<20}  {'DESTINAZIONE':<20}  {'CREATO IL'}")
    print("-" * 65)
    for lnk in links:
        print(f"{lnk['source_user_id']:<20}  {lnk['target_user_id']:<20}  {lnk['created_at']}")


async def _add(store: UserStore, source: str, target: str) -> None:
    if source == target:
        print("Errore: sorgente e destinazione non possono essere lo stesso utente.")
        sys.exit(1)
    src_user = await store.get_user(source)
    tgt_user = await store.get_user(target)
    if src_user is None:
        print(f"Errore: utente sorgente '{source}' non trovato nel DB.")
        sys.exit(1)
    if tgt_user is None:
        print(f"Errore: utente destinazione '{target}' non trovato nel DB.")
        sys.exit(1)
    await store.add_link(source, target)
    print(f"Link creato: {source} → {target}")
    print(f"  Sorgente: {src_user['phone']} (gruppo: {src_user['group_name']})")
    print(f"  Destinazione: {tgt_user['phone']} (MT5 login: {tgt_user.get('mt5_login')})")


async def _remove(store: UserStore, source: str, target: str) -> None:
    await store.remove_link(source, target)
    print(f"Link rimosso: {source} → {target}")


async def _clear(store: UserStore, user_id: str) -> None:
    await store.delete_all_links_for_user(user_id)
    print(f"Tutti i link per l'utente '{user_id}' rimossi.")


async def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)

    cmd = args[0].lower()

    store = UserStore(_DB_PATH)
    await store.init()

    if cmd == "list":
        await _list(store)

    elif cmd == "add":
        if len(args) < 3:
            print("Utilizzo: python link_users.py add <source_user_id> <target_user_id>")
            sys.exit(1)
        await _add(store, args[1], args[2])

    elif cmd == "remove":
        if len(args) < 3:
            print("Utilizzo: python link_users.py remove <source_user_id> <target_user_id>")
            sys.exit(1)
        await _remove(store, args[1], args[2])

    elif cmd == "clear":
        if len(args) < 2:
            print("Utilizzo: python link_users.py clear <user_id>")
            sys.exit(1)
        await _clear(store, args[1])

    else:
        print(f"Comando sconosciuto: '{cmd}'")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
