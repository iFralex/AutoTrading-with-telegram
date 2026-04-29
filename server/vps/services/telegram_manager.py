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
# firma: on_delete(user_id, group_id, deleted_ids) → None
DeleteCallback = Callable[[str, "int | None", list[int]], Awaitable[None]]


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

    def get_groups_for_user(self, user_id: str) -> list[dict]:
        """
        Ritorna i gruppi/canali usando il client attivo dell'utente già registrato.

        Returns:
            [{"id": str, "name": str, "type": "channel"|"group", "members": int}]

        Raises:
            ValueError  se l'utente non ha un client attivo
        """
        return self._call(self._async_get_groups_for_user(user_id), timeout=60)

    def get_recent_messages(self, login_key: str, group_id: str, limit: int = 15) -> list[dict]:
        """
        Ritorna gli ultimi messaggi testuali dal gruppo selezionato usando la sessione pendente.

        Returns:
            [{"id": int, "text": str, "date": str|null}]

        Raises:
            ValueError  se login_key non trovato
        """
        return self._call(self._async_get_recent_messages(login_key, group_id, limit), timeout=30)

    # ── Gestione utenti ──────────────────────────────────────────────────────

    def add_user(
        self,
        user_id: str,
        api_id: int,
        api_hash: str,
        group_ids: list[int],
        login_key: str,
    ) -> None:
        """
        Promuove il login pendente a sessione attiva e avvia l'ascolto
        dei messaggi su tutti i gruppi indicati.
        """
        self._call(
            self._async_add_user(user_id, api_id, api_hash, group_ids, login_key),
            timeout=120,
        )

    def remove_user(self, user_id: str) -> None:
        """Disconnette e rimuove l'utente."""
        self._call(self._async_remove_user(user_id))

    def update_user_groups(
        self,
        user_id: str,
        api_id: int,
        api_hash: str,
        group_ids: list[int],
    ) -> None:
        """
        Aggiorna la lista di gruppi/canali monitorati per un utente già attivo.
        Disconnette il client esistente e lo ricrea con i nuovi group_ids.
        """
        self._call(
            self._async_update_user_groups(user_id, api_id, api_hash, group_ids)
        )

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

    async def send_to_user(self, user_id: str, text: str) -> bool:
        """
        Invia un messaggio di testo all'utente tramite la sua sessione Telethon.
        Da chiamare con await nel loop del TelegramManager (es. da on_message).
        """
        client = self._clients.get(user_id)
        if not client:
            return False
        try:
            await client.send_message(int(user_id), text)
            return True
        except Exception as exc:
            logger.warning("Notifica a %s fallita: %s", user_id, exc)
            return False

    def notify_user(self, user_id: str, text: str) -> bool:
        """
        Thread-safe: invia un messaggio all'utente schedulando la coroutine
        sul loop del TelegramManager. Da chiamare con run_in_executor dal loop FastAPI.
        """
        return self._call(self.send_to_user(user_id, text), timeout=10)

    async def send_file_to_user(
        self,
        user_id: str,
        file_bytes: bytes,
        filename: str,
        caption: str = "",
    ) -> bool:
        """
        Invia un file (bytes) all'utente tramite la sua sessione Telethon.
        Da chiamare con await nel loop del TelegramManager.
        """
        import io
        client = self._clients.get(user_id)
        if not client:
            return False
        try:
            buf = io.BytesIO(file_bytes)
            buf.name = filename
            await client.send_file(int(user_id), buf, caption=caption)
            return True
        except Exception as exc:
            logger.warning("Invio file a %s fallito: %s", user_id, exc)
            return False

    def notify_user_with_file(
        self,
        user_id: str,
        file_bytes: bytes,
        filename: str,
        caption: str = "",
    ) -> bool:
        """
        Thread-safe: invia un file all'utente schedulando la coroutine
        sul loop del TelegramManager.
        """
        return self._call(
            self.send_file_to_user(user_id, file_bytes, filename, caption),
            timeout=60,
        )

    def get_history(
        self,
        user_id: str,
        group_id: int,
        limit: int | None = None,
        until_date=None,
        from_date=None,
        on_progress=None,
    ) -> list[dict]:
        """
        Recupera messaggi storici da un gruppo Telegram.

        Args:
            user_id:    ID utente registrato nel manager.
            group_id:   ID del gruppo/canale da cui scaricare.
            limit:      Numero massimo di messaggi (None = fino a until_date).
            until_date: datetime UTC — scarica messaggi fino a questa data (esclusiva).
            from_date:  datetime UTC — scarta messaggi precedenti a questa data.
            on_progress: callable(fetched: int) invocato ogni 100 messaggi.

        Returns:
            Lista di dict [{id, date_iso, sender_name, text}] ordinati dal più vecchio.
        """
        return self._call(
            self._async_get_history(user_id, group_id, limit, until_date, from_date, on_progress),
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
        from_date,
        on_progress,
    ) -> list[dict]:
        client = self._clients.get(user_id)
        if client is None:
            raise ValueError(f"Utente {user_id} non connesso nel TelegramManager")

        messages: list[dict] = []
        fetched = 0

        # Telethon iter_messages: offset_date = scarica messaggi PRIMA di quella data
        # reverse=False → dal più recente al più vecchio (poi invertiamo alla fine)
        # Usiamo un limite grezzo più grande per compensare i messaggi non-testo
        # (foto, video, messaggi di servizio) che vengono scartati — ci fermiamo
        # noi stessi quando abbiamo raccolto abbastanza messaggi con testo.
        raw_limit = limit * 10 if limit else None
        async for msg in client.iter_messages(
            group_id,
            limit=raw_limit,
            offset_date=until_date,
            reverse=False,
        ):
            text = getattr(msg, "text", None) or getattr(msg, "message", None) or ""
            if not text:
                continue

            date = getattr(msg, "date", None)

            # Se c'è un from_date, fermiamo l'iterazione appena usciamo dall'intervallo
            # (i messaggi arrivano dal più recente al più vecchio)
            if from_date and date and date < from_date:
                break

            date_iso = date.isoformat() if date else None

            sender = await msg.get_sender()
            if sender is None:
                sender_name = "?"
            else:
                sender_name = (
                    getattr(sender, "first_name", None)
                    or getattr(sender, "title", None)
                    or "?"
                )

            messages.append({
                "id":          msg.id,
                "date_iso":    date_iso,
                "sender_name": sender_name,
                "text":        text,
            })
            fetched += 1

            if limit and fetched >= limit:
                break

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

    async def _async_get_recent_messages(self, login_key: str, group_id: str, limit: int) -> list[dict]:
        entry = self._pending.get(login_key)
        if entry is None:
            raise ValueError("Sessione di login non trovata")
        client: TelegramClient = entry["client"]
        messages: list[dict] = []
        async for msg in client.iter_messages(int(group_id), limit=limit):
            if msg.text and msg.text.strip():
                messages.append({
                    "id": msg.id,
                    "text": msg.text,
                    "date": msg.date.isoformat() if msg.date else None,
                })
        return messages

    async def _async_get_groups(self, login_key: str) -> list[dict]:
        entry = self._pending.get(login_key)
        if entry is None:
            raise ValueError("Sessione di login non trovata")

        client: TelegramClient = entry["client"]
        return await self._fetch_dialogs_as_groups(client)

    async def _async_get_groups_for_user(self, user_id: str) -> list[dict]:
        client = self._clients.get(user_id)
        if client is None:
            raise ValueError(f"Nessun client attivo per l'utente {user_id}")
        return await self._fetch_dialogs_as_groups(client)

    @staticmethod
    async def _fetch_dialogs_as_groups(client: "TelegramClient") -> list[dict]:
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
        group_ids: list[int],
        login_key: str,
    ) -> None:
        entry = self._pending.pop(login_key, None)

        tmp_path = self._sessions_dir / f"_tmp_{login_key}.session"

        if entry is None and not tmp_path.exists():
            raise ValueError(f"Login pendente '{login_key}' non trovato")

        if entry is not None:
            tmp_client: TelegramClient = entry["client"]
            try:
                await tmp_client.disconnect()
            except Exception:
                pass
        final_path = self._sessions_dir / f"{user_id}.session"
        if tmp_path.exists():
            tmp_path.rename(final_path)
        else:
            logger.warning("File sessione temporaneo non trovato: %s", tmp_path)

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
        self._attach_handler(client, user_id, group_ids)
        logger.info("Utente %s aggiunto, ascolto sui gruppi %s", user_id, group_ids)

    async def _async_remove_user(self, user_id: str) -> None:
        client = self._clients.pop(user_id, None)
        if client:
            await client.disconnect()
            logger.info("Utente %s disconnesso", user_id)

    async def _async_update_user_groups(
        self,
        user_id: str,
        api_id: int,
        api_hash: str,
        group_ids: list[int],
    ) -> None:
        old_client = self._clients.pop(user_id, None)
        if old_client:
            await old_client.disconnect()

        if not group_ids:
            logger.info("Utente %s: nessun gruppo attivo, listener rimosso", user_id)
            return

        session_path = self._sessions_dir / f"{user_id}.session"
        if not session_path.exists():
            raise RuntimeError(f"File sessione non trovato per utente {user_id}")

        session_name = str(session_path.with_suffix(""))
        client = await self._make_client(api_id, api_hash, session_name)

        if not await client.is_user_authorized():
            await client.disconnect()
            raise RuntimeError(f"Sessione utente {user_id} non autorizzata")

        self._clients[user_id] = client
        self._attach_handler(client, user_id, group_ids)
        logger.info("Utente %s: gruppi aggiornati a %s", user_id, group_ids)

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
                group_ids = [int(g) for g in u.get("group_ids") or [] if g]
                if not group_ids and u.get("group_id"):
                    group_ids = [int(u["group_id"])]
                self._attach_handler(client, uid, group_ids)

                me: User = await client.get_me()
                logger.info(
                    "Utente %s (%s) ripristinato, ascolto gruppi %s",
                    uid, me.first_name, group_ids,
                )
                restored += 1

            except Exception as exc:
                logger.error(
                    "Ripristino utente %s fallito: %s", uid, exc, exc_info=True
                )

        logger.info("Ripristinati %d/%d utenti", restored, len(users))

    def _attach_handler(
        self, client: TelegramClient, user_id: str, group_ids: list[int]
    ) -> None:
        """
        Registra NewMessage e MessageDeleted handler per tutti i gruppi in group_ids.
        Il callback on_message riceve il group_id sorgente dell'evento.
        """
        if not group_ids:
            logger.warning("Utente %s: nessun gruppo, handler non registrato", user_id)
            return

        @client.on(events.NewMessage(chats=group_ids))
        async def _handler(event: events.NewMessage.Event) -> None:
            if self._on_message is None:
                return
            try:
                sender = await event.get_sender()
                await self._on_message(
                    user_id=user_id,
                    group_id=event.chat_id,
                    message=event.message.message or "",
                    raw_event=event,
                    sender=sender,
                )
            except Exception as exc:
                logger.error(
                    "Errore callback messaggio (utente %s): %s",
                    user_id, exc, exc_info=True,
                )

        @client.on(events.MessageDeleted(chats=group_ids))
        async def _delete_handler(event: events.MessageDeleted.Event) -> None:
            if self._on_delete is None:
                return
            deleted_ids: list[int] = list(event.deleted_ids or [])
            if not deleted_ids:
                return
            try:
                await self._on_delete(user_id, getattr(event, "chat_id", None), deleted_ids)
            except Exception as exc:
                logger.error(
                    "Errore callback eliminazione (utente %s): %s",
                    user_id, exc, exc_info=True,
                )
