"""
TelegramManager — gestisce N sessioni Telethon in un singolo thread asyncio.

Design:
  - Un unico event loop gira in un thread dedicato ("TelegramManager").
  - Ogni utente ha il proprio TelegramClient connesso e autenticato.
  - Tutti i client condividono lo stesso loop: nessun overhead di thread extra.
  - Le chiamate pubbliche (da FastAPI, che gira su un loop diverso) usano
    run_coroutine_threadsafe() per serializzare le operazioni.

Flusso di login in due fasi:
  1. request_code(api_id, api_hash, phone)
     → crea un client temporaneo, invia l'OTP, ritorna login_key
  2. verify_code(login_key, code)
     → verifica OTP, salva la sessione, ritorna user_id
     → se 2FA attivo, solleva PasswordRequiredError
  3. [opzionale] verify_password(login_key, password)
     → completa il login 2FA

Dopo il login, add_user() promuove la sessione temporanea a definitiva
e avvia l'event handler sul gruppo configurato.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from pathlib import Path
from typing import Awaitable, Callable

from telethon import TelegramClient, events
from telethon.errors import (
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    SessionPasswordNeededError,
)
from telethon.tl.types import User

logger = logging.getLogger(__name__)

# Tipo del callback chiamato su ogni nuovo messaggio
MessageCallback = Callable[..., Awaitable[None]]

# Tipo del callback chiamato quando uno o più messaggi vengono eliminati
# firma: on_delete(user_id, deleted_ids) → None
DeleteCallback = Callable[[str, list[int]], Awaitable[None]]


class PasswordRequiredError(Exception):
    """Sollevata quando verify_code incontra un account con 2FA abilitato."""
    def __init__(self, login_key: str):
        super().__init__("2FA abilitato: usare verify_password()")
        self.login_key = login_key


class TelegramManager:
    """
    Servizio singleton che gestisce le sessioni Telethon di tutti gli utenti.

    Uso tipico:
        manager = TelegramManager(sessions_dir=Path("sessions"), on_message=handler)
        manager.start()                          # avvia il thread asyncio
        manager.restore_users(db_users)          # riconnette utenti al boot
        ...
        key = manager.request_code(id, hash, phone)["login_key"]
        info = manager.verify_code(key, "12345")
        groups = manager.get_groups(key)
        manager.add_user(user_id, api_id, api_hash, group_id, key)
    """

    def __init__(
        self,
        sessions_dir: Path,
        on_message: MessageCallback | None = None,
        on_delete: DeleteCallback | None = None,
    ):
        self._sessions_dir = sessions_dir
        self._sessions_dir.mkdir(parents=True, exist_ok=True)
        self._on_message = on_message
        self._on_delete  = on_delete

        # Sessioni attive: user_id → TelegramClient
        self._clients: dict[str, TelegramClient] = {}

        # Login in corso: login_key → {client, phone, phone_code_hash, api_id, api_hash}
        self._pending: dict[str, dict] = {}

        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Avvia il thread asyncio. Blocca finché il loop non è pronto."""
        self._thread = threading.Thread(
            target=self._run_loop,
            daemon=True,
            name="TelegramManager",
        )
        self._thread.start()
        if not self._ready.wait(timeout=10):
            raise RuntimeError("TelegramManager: timeout avvio event loop")
        logger.info("TelegramManager avviato")

    def stop(self) -> None:
        """Disconnette tutti i client e ferma il loop."""
        if self._loop and not self._loop.is_closed():
            future = asyncio.run_coroutine_threadsafe(
                self._async_stop_all(), self._loop
            )
            try:
                future.result(timeout=15)
            except Exception:
                pass
            self._loop.call_soon_threadsafe(self._loop.stop)
        logger.info("TelegramManager fermato")

    # ── Login flow (chiamate thread-safe da FastAPI) ──────────────────────────

    def request_code(self, api_id: int, api_hash: str, phone: str) -> dict:
        """
        Invia il codice OTP Telegram al numero indicato.

        Returns:
            {"login_key": str}  — token da passare ai passi successivi
        """
        return self._call(self._async_request_code(api_id, api_hash, phone))

    def verify_code(self, login_key: str, code: str) -> dict:
        """
        Verifica il codice OTP.

        Returns:
            {"user_id": str, "first_name": str, "phone": str, "login_key": str}

        Raises:
            PasswordRequiredError  se l'account ha 2FA abilitato
            ValueError             se login_key non trovato o codice scaduto
        """
        return self._call(self._async_verify_code(login_key, code))

    def verify_password(self, login_key: str, password: str) -> dict:
        """
        Completa il login 2FA con la password cloud.

        Returns:
            {"user_id": str, "first_name": str, "phone": str, "login_key": str}
        """
        return self._call(self._async_verify_password(login_key, password))

    def get_groups(self, login_key: str) -> list[dict]:
        """
        Ritorna i gruppi e canali di cui è membro l'utente autenticato.

        Returns:
            [{"id": str, "name": str, "type": "channel"|"group", "members": int}]
        """
        return self._call(self._async_get_groups(login_key), timeout=60)

    # ── Gestione utenti ──────────────────────────────────────────────────────

    def add_user(
        self,
        user_id: str,
        api_id: int,
        api_hash: str,
        group_id: int,
        login_key: str,
    ) -> None:
        """
        Promuove il login pendente a sessione attiva e avvia l'ascolto
        dei messaggi sul gruppo indicato.
        """
        self._call(
            self._async_add_user(user_id, api_id, api_hash, group_id, login_key)
        )

    def remove_user(self, user_id: str) -> None:
        """Disconnette e rimuove l'utente."""
        self._call(self._async_remove_user(user_id))

    def restore_users(self, users: list[dict]) -> None:
        """
        Riconnette al boot gli utenti con sessione già salvata.

        Args:
            users: lista di dict con chiavi
                   {user_id, api_id, api_hash, group_id}
        """
        self._call(self._async_restore_users(users), timeout=120)

    def active_user_ids(self) -> list[str]:
        return list(self._clients.keys())

    def get_history(
        self,
        user_id: str,
        group_id: int,
        limit: int | None = None,
        until_date=None,
        on_progress=None,
    ) -> list[dict]:
        """
        Recupera messaggi storici da un gruppo Telegram.

        Args:
            user_id:    ID utente registrato nel manager.
            group_id:   ID del gruppo/canale da cui scaricare.
            limit:      Numero massimo di messaggi (None = fino a until_date).
            until_date: datetime (timezone-aware UTC) — scarica messaggi fino a questa data.
            on_progress: callable(fetched: int) invocato ogni 100 messaggi.

        Returns:
            Lista di dict [{id, date_iso, sender_name, text}] ordinati dal più vecchio.
        """
        return self._call(
            self._async_get_history(user_id, group_id, limit, until_date, on_progress),
            timeout=3600,
        )

    # ── Internals ────────────────────────────────────────────────────────────

    def _call(self, coro, timeout: int = 30):
        """Esegue una coroutine sul loop del manager e ritorna il risultato."""
        if self._loop is None or self._loop.is_closed():
            raise RuntimeError("TelegramManager non avviato")
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result(timeout=timeout)

    def _run_loop(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._ready.set()
        try:
            self._loop.run_forever()
        finally:
            self._loop.close()

    # ── Coroutine asincrone ──────────────────────────────────────────────────

    async def _make_client(
        self, api_id: int, api_hash: str, session_name: str
    ) -> TelegramClient:
        """Crea e connette un TelegramClient."""
        client = TelegramClient(session_name, api_id, api_hash)
        await client.connect()
        return client

    async def _async_stop_all(self) -> None:
        for uid, client in list(self._clients.items()):
            try:
                await client.disconnect()
            except Exception:
                pass
        self._clients.clear()
        for key, entry in list(self._pending.items()):
            try:
                await entry["client"].disconnect()
            except Exception:
                pass
        self._pending.clear()

    async def _async_request_code(
        self, api_id: int, api_hash: str, phone: str
    ) -> dict:
        login_key = uuid.uuid4().hex
        session_name = str(self._sessions_dir / f"_tmp_{login_key}")

        client = await self._make_client(api_id, api_hash, session_name)
        result = await client.send_code_request(phone)

        self._pending[login_key] = {
            "client": client,
            "phone": phone,
            "phone_code_hash": result.phone_code_hash,
            "api_id": api_id,
            "api_hash": api_hash,
        }
        logger.debug("Codice OTP inviato a %s (login_key=%s)", phone, login_key)
        return {"login_key": login_key}

    async def _async_verify_code(self, login_key: str, code: str) -> dict:
        entry = self._pending.get(login_key)
        if entry is None:
            raise ValueError("Sessione di login non trovata o scaduta")

        client: TelegramClient = entry["client"]
        try:
            await client.sign_in(
                phone=entry["phone"],
                code=code,
                phone_code_hash=entry["phone_code_hash"],
            )
        except SessionPasswordNeededError:
            raise PasswordRequiredError(login_key)
        except PhoneCodeInvalidError:
            raise ValueError("Codice non corretto")
        except PhoneCodeExpiredError:
            raise ValueError("Codice scaduto. Richiedi un nuovo codice")

        me: User = await client.get_me()
        return {
            "user_id": str(me.id),
            "first_name": me.first_name or "",
            "phone": me.phone or entry["phone"],
            "login_key": login_key,
        }

    async def _async_verify_password(
        self, login_key: str, password: str
    ) -> dict:
        entry = self._pending.get(login_key)
        if entry is None:
            raise ValueError("Sessione di login non trovata o scaduta")

        client: TelegramClient = entry["client"]
        await client.sign_in(password=password)
        me: User = await client.get_me()
        return {
            "user_id": str(me.id),
            "first_name": me.first_name or "",
            "phone": me.phone or entry["phone"],
            "login_key": login_key,
        }

    async def _async_get_history(
        self,
        user_id: str,
        group_id: int,
        limit: int | None,
        until_date,
        on_progress,
    ) -> list[dict]:
        client = self._clients.get(user_id)
        if client is None:
            raise ValueError(f"Utente {user_id} non connesso nel TelegramManager")

        messages: list[dict] = []
        fetched = 0

        # Telethon iter_messages: offset_date = scarica messaggi PRIMA di quella data
        # reverse=False → dal più recente al più vecchio (poi invertiamo alla fine)
        async for msg in client.iter_messages(
            group_id,
            limit=limit,
            offset_date=until_date,
            reverse=False,
        ):
            text = getattr(msg, "text", None) or getattr(msg, "message", None) or ""
            if not text:
                continue

            sender = await msg.get_sender()
            if sender is None:
                sender_name = "?"
            else:
                sender_name = (
                    getattr(sender, "first_name", None)
                    or getattr(sender, "title", None)
                    or "?"
                )

            date = getattr(msg, "date", None)
            date_iso = date.isoformat() if date else None

            messages.append({
                "id":          msg.id,
                "date_iso":    date_iso,
                "sender_name": sender_name,
                "text":        text,
            })
            fetched += 1

            if on_progress and fetched % 100 == 0:
                try:
                    on_progress(fetched)
                except Exception:
                    pass

            # FloodWait è gestito automaticamente da Telethon con wait_time
            # ma aggiungiamo un piccolo throttle per non stressare i rate limit
            if fetched % 200 == 0:
                await asyncio.sleep(0.5)

        # Dal più recente al più vecchio → invertiamo per ordine cronologico
        messages.reverse()
        logger.info("Storico Telegram utente %s: %d messaggi scaricati", user_id, len(messages))
        return messages

    async def _async_get_groups(self, login_key: str) -> list[dict]:
        entry = self._pending.get(login_key)
        if entry is None:
            raise ValueError("Sessione di login non trovata")

        client: TelegramClient = entry["client"]
        groups: list[dict] = []

        async for dialog in client.iter_dialogs():
            if not (dialog.is_group or dialog.is_channel):
                continue
            members = getattr(dialog.entity, "participants_count", None) or 0
            groups.append(
                {
                    "id": str(dialog.id),
                    "name": dialog.name or "(senza nome)",
                    "type": "channel" if dialog.is_channel else "group",
                    "members": members,
                }
            )

        groups.sort(key=lambda g: g["members"], reverse=True)
        return groups

    async def _async_add_user(
        self,
        user_id: str,
        api_id: int,
        api_hash: str,
        group_id: int,
        login_key: str,
    ) -> None:
        entry = self._pending.pop(login_key, None)
        if entry is None:
            raise ValueError(f"Login pendente '{login_key}' non trovato")

        # Disconnetti il client temporaneo (la sessione è già salvata su disco)
        tmp_client: TelegramClient = entry["client"]
        await tmp_client.disconnect()

        # Sposta il file di sessione da _tmp_{key}.session a {user_id}.session
        tmp_path = self._sessions_dir / f"_tmp_{login_key}.session"
        final_path = self._sessions_dir / f"{user_id}.session"
        if tmp_path.exists():
            tmp_path.rename(final_path)
        else:
            logger.warning(
                "File sessione temporaneo non trovato: %s", tmp_path
            )

        # Crea il client definitivo caricando la sessione appena rinominata
        session_name = str(final_path.with_suffix(""))
        client = await self._make_client(api_id, api_hash, session_name)

        if not await client.is_user_authorized():
            await client.disconnect()
            raise RuntimeError(
                f"Sessione dell'utente {user_id} non valida dopo il trasferimento"
            )

        if user_id in self._clients:
            await self._clients[user_id].disconnect()

        self._clients[user_id] = client
        self._attach_handler(client, user_id, group_id)
        logger.info(
            "Utente %s aggiunto, ascolto sul gruppo %d", user_id, group_id
        )

    async def _async_remove_user(self, user_id: str) -> None:
        client = self._clients.pop(user_id, None)
        if client:
            await client.disconnect()
            logger.info("Utente %s disconnesso", user_id)

    async def _async_restore_users(self, users: list[dict]) -> None:
        """Riconnette tutti gli utenti dal database all'avvio del servizio."""
        restored = 0
        for u in users:
            uid = u["user_id"]
            session_path = self._sessions_dir / f"{uid}.session"

            if not session_path.exists():
                logger.warning(
                    "Sessione mancante per utente %s (%s), skip", uid, session_path
                )
                continue

            try:
                session_name = str(session_path.with_suffix(""))
                client = await self._make_client(
                    u["api_id"], u["api_hash"], session_name
                )
                if not await client.is_user_authorized():
                    logger.warning(
                        "Sessione utente %s non autorizzata, skip", uid
                    )
                    await client.disconnect()
                    continue

                self._clients[uid] = client
                self._attach_handler(client, uid, int(u["group_id"]))

                me: User = await client.get_me()
                logger.info(
                    "Utente %s (%s) ripristinato, ascolto gruppo %s",
                    uid,
                    me.first_name,
                    u["group_id"],
                )
                restored += 1

            except Exception as exc:
                logger.error(
                    "Ripristino utente %s fallito: %s", uid, exc, exc_info=True
                )

        logger.info("Ripristinati %d/%d utenti", restored, len(users))

    def _attach_handler(
        self, client: TelegramClient, user_id: str, group_id: int
    ) -> None:
        """
        Registra il NewMessage e il MessageDeleted handler sul client.
        Viene chiamata sia per utenti nuovi che per quelli ripristinati al boot.
        """

        @client.on(events.NewMessage(chats=group_id))
        async def _handler(event: events.NewMessage.Event) -> None:
            if self._on_message is None:
                return
            try:
                sender = await event.get_sender()
                await self._on_message(
                    user_id=user_id,
                    message=event.message.message or "",
                    raw_event=event,
                    sender=sender,
                )
            except Exception as exc:
                logger.error(
                    "Errore nel callback messaggio (utente %s): %s",
                    user_id,
                    exc,
                    exc_info=True,
                )

        @client.on(events.MessageDeleted(chats=group_id))
        async def _delete_handler(event: events.MessageDeleted.Event) -> None:
            if self._on_delete is None:
                return
            deleted_ids: list[int] = list(event.deleted_ids or [])
            if not deleted_ids:
                return
            try:
                await self._on_delete(user_id, deleted_ids)
            except Exception as exc:
                logger.error(
                    "Errore nel callback eliminazione messaggi (utente %s): %s",
                    user_id,
                    exc,
                    exc_info=True,
                )
