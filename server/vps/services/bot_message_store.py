"""
BotMessageStore — persiste ogni messaggio inviato dal bot all'utente su Telegram.
"""

from __future__ import annotations

import aiosqlite


class BotMessageStore:
    def __init__(self, db_path) -> None:
        self._db_path = str(db_path)

    async def init(self) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS bot_messages (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id      TEXT    NOT NULL,
                    ts           TEXT    NOT NULL DEFAULT (datetime('now')),
                    message_text TEXT    NOT NULL,
                    message_type TEXT
                )
            """)
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_bot_messages_user_id "
                "ON bot_messages(user_id)"
            )
            await db.commit()

    async def insert(
        self,
        user_id: str,
        message_text: str,
        message_type: str = "notification",
    ) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "INSERT INTO bot_messages (user_id, message_text, message_type) "
                "VALUES (?, ?, ?)",
                (user_id, message_text, message_type),
            )
            await db.commit()
