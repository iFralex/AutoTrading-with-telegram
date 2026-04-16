"""
UserStore — persistenza utenti su SQLite con aiosqlite.

Schema:
  users(
    user_id                 TEXT PRIMARY KEY,   -- Telegram user ID
    api_id                  INTEGER NOT NULL,
    api_hash                TEXT    NOT NULL,
    phone                   TEXT    NOT NULL,
    group_id                INTEGER NOT NULL,
    group_name              TEXT    NOT NULL,
    mt5_login               INTEGER,
    mt5_password_enc        TEXT,               -- cifrato con Fernet
    mt5_server              TEXT,
    sizing_strategy         TEXT,               -- strategia di sizing (iniettata nel prompt Pro)
    management_strategy     TEXT,               -- strategia di gestione (eseguita dal StrategyExecutor)
    deletion_strategy       TEXT,               -- strategia da eseguire quando un messaggio segnale viene eliminato
    extraction_instructions TEXT,               -- istruzioni custom per il prompt di estrazione Pro
    active                  INTEGER DEFAULT 1,
    entry_if_favorable      INTEGER DEFAULT 0,  -- 1 = entra a mercato se prezzo già favorevole
    created_at              TEXT    DEFAULT CURRENT_TIMESTAMP
  )
"""

from __future__ import annotations

import os
from pathlib import Path

import aiosqlite
from cryptography.fernet import Fernet

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS users (
    user_id             TEXT    PRIMARY KEY,
    api_id              INTEGER NOT NULL,
    api_hash            TEXT    NOT NULL,
    phone               TEXT    NOT NULL,
    group_id            INTEGER NOT NULL,
    group_name          TEXT    NOT NULL,
    mt5_login           INTEGER,
    mt5_password_enc    TEXT,
    mt5_server          TEXT,
    sizing_strategy         TEXT,
    management_strategy     TEXT,
    range_entry_pct         INTEGER NOT NULL DEFAULT 0,
    entry_if_favorable      INTEGER NOT NULL DEFAULT 0,
    deletion_strategy       TEXT,
    extraction_instructions TEXT,
    active                  INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""

# Migrations: colonne aggiunte dopo la versione iniziale dello schema
_MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN sizing_strategy TEXT",
    "ALTER TABLE users ADD COLUMN management_strategy TEXT",
    "ALTER TABLE users ADD COLUMN range_entry_pct INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN entry_if_favorable INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN deletion_strategy TEXT",
    "ALTER TABLE users ADD COLUMN extraction_instructions TEXT",
]


def _cipher() -> Fernet:
    key = os.environ.get("ENCRYPTION_KEY", "")
    if not key:
        raise RuntimeError(
            "Variabile d'ambiente ENCRYPTION_KEY non impostata. "
            "Esegui setup.ps1 per generarla."
        )
    return Fernet(key.encode())


def _encrypt(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    return _cipher().decrypt(value.encode()).decode()


class UserStore:
    """
    Wrapper asincrono attorno al database SQLite degli utenti.

    Uso:
        store = UserStore(db_path)
        await store.init()          # crea la tabella se non esiste
        await store.upsert(user)
        users = await store.get_active_users()
    """

    def __init__(self, db_path: Path):
        self._db_path = db_path

    async def init(self) -> None:
        """Crea il database e la tabella se non esistono; applica le migration."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.commit()
            # Migration incrementali: ignora errori se la colonna esiste già
            for sql in _MIGRATIONS:
                try:
                    await db.execute(sql)
                    await db.commit()
                except Exception:
                    pass

    # ── Write ────────────────────────────────────────────────────────────────

    async def upsert(self, user: dict) -> None:
        """
        Inserisce o aggiorna un utente.

        Campi attesi nel dict:
            user_id, api_id, api_hash, phone,
            group_id, group_name,
            mt5_login (opzionale), mt5_password (opzionale, verrà cifrata),
            mt5_server (opzionale)
        """
        mt5_password_enc: str | None = None
        if user.get("mt5_password"):
            mt5_password_enc = _encrypt(user["mt5_password"])

        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """
                INSERT INTO users
                    (user_id, api_id, api_hash, phone,
                     group_id, group_name,
                     mt5_login, mt5_password_enc, mt5_server,
                     sizing_strategy, management_strategy, range_entry_pct,
                     entry_if_favorable, deletion_strategy, extraction_instructions, active)
                VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(user_id) DO UPDATE SET
                    api_id                  = excluded.api_id,
                    api_hash                = excluded.api_hash,
                    phone                   = excluded.phone,
                    group_id                = excluded.group_id,
                    group_name              = excluded.group_name,
                    mt5_login               = excluded.mt5_login,
                    mt5_password_enc        = excluded.mt5_password_enc,
                    mt5_server              = excluded.mt5_server,
                    sizing_strategy         = excluded.sizing_strategy,
                    management_strategy     = excluded.management_strategy,
                    extraction_instructions = excluded.extraction_instructions,
                    active                  = 1
                """,
                (
                    user["user_id"],
                    user["api_id"],
                    user["api_hash"],
                    user["phone"],
                    user["group_id"],
                    user["group_name"],
                    user.get("mt5_login"),
                    mt5_password_enc,
                    user.get("mt5_server"),
                    user.get("sizing_strategy"),
                    user.get("management_strategy"),
                    int(user.get("range_entry_pct") or 0),
                    int(bool(user.get("entry_if_favorable"))),
                    user.get("deletion_strategy"),
                    user.get("extraction_instructions"),
                ),
            )
            await db.commit()

    async def update_sizing_strategy(self, user_id: str, sizing_strategy: str | None) -> None:
        """Aggiorna solo il campo sizing_strategy per l'utente."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE users SET sizing_strategy = ? WHERE user_id = ?",
                (sizing_strategy or None, user_id),
            )
            await db.commit()

    async def update_management_strategy(self, user_id: str, management_strategy: str | None) -> None:
        """Aggiorna solo il campo management_strategy per l'utente."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE users SET management_strategy = ? WHERE user_id = ?",
                (management_strategy or None, user_id),
            )
            await db.commit()

    async def update_range_entry_pct(self, user_id: str, range_entry_pct: int) -> None:
        """Aggiorna solo il campo range_entry_pct per l'utente (0–100)."""
        pct = max(0, min(100, int(range_entry_pct)))
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE users SET range_entry_pct = ? WHERE user_id = ?",
                (pct, user_id),
            )
            await db.commit()

    async def update_entry_if_favorable(self, user_id: str, entry_if_favorable: bool) -> None:
        """Aggiorna la modalità di ingresso quando il prezzo è già favorevole."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE users SET entry_if_favorable = ? WHERE user_id = ?",
                (1 if entry_if_favorable else 0, user_id),
            )
            await db.commit()

    async def update_deletion_strategy(self, user_id: str, deletion_strategy: str | None) -> None:
        """Aggiorna la strategia da eseguire quando un messaggio segnale viene eliminato."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE users SET deletion_strategy = ? WHERE user_id = ?",
                (deletion_strategy or None, user_id),
            )
            await db.commit()

    async def update_extraction_instructions(self, user_id: str, extraction_instructions: str | None) -> None:
        """Aggiorna le istruzioni custom iniettate nel prompt Pro di estrazione."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE users SET extraction_instructions = ? WHERE user_id = ?",
                (extraction_instructions or None, user_id),
            )
            await db.commit()

    async def set_active(self, user_id: str, active: bool) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE users SET active = ? WHERE user_id = ?",
                (1 if active else 0, user_id),
            )
            await db.commit()

    async def delete(self, user_id: str) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
            await db.commit()

    # ── Read ─────────────────────────────────────────────────────────────────

    async def get_active_users(self) -> list[dict]:
        """
        Ritorna tutti gli utenti attivi nel formato atteso da
        TelegramManager.restore_users().
        """
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM users WHERE active = 1"
            )
            rows = await cursor.fetchall()

        result = []
        for row in rows:
            mt5_password: str | None = None
            if row["mt5_password_enc"]:
                try:
                    mt5_password = _decrypt(row["mt5_password_enc"])
                except Exception:
                    mt5_password = None  # chiave cambiata o dati corrotti

            result.append(
                {
                    "user_id":                  row["user_id"],
                    "api_id":                   row["api_id"],
                    "api_hash":                 row["api_hash"],
                    "phone":                    row["phone"],
                    "group_id":                 row["group_id"],
                    "group_name":               row["group_name"],
                    "mt5_login":                row["mt5_login"],
                    "mt5_password":             mt5_password,
                    "mt5_server":               row["mt5_server"],
                    "sizing_strategy":          row["sizing_strategy"],
                    "management_strategy":      row["management_strategy"],
                    "deletion_strategy":        row["deletion_strategy"],
                    "extraction_instructions":  row["extraction_instructions"],
                    "range_entry_pct":          int(row["range_entry_pct"] or 0),
                    "entry_if_favorable":       bool(row["entry_if_favorable"]),
                }
            )
        return result

    async def get_user_by_phone(self, phone: str) -> dict | None:
        """Cerca un utente per numero di telefono."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM users WHERE phone = ?", (phone,)
            )
            row = await cursor.fetchone()

        if row is None:
            return None

        mt5_password: str | None = None
        if row["mt5_password_enc"]:
            try:
                mt5_password = _decrypt(row["mt5_password_enc"])
            except Exception:
                pass

        return {
            "user_id":                  row["user_id"],
            "api_id":                   row["api_id"],
            "api_hash":                 row["api_hash"],
            "phone":                    row["phone"],
            "group_id":                 row["group_id"],
            "group_name":               row["group_name"],
            "mt5_login":                row["mt5_login"],
            "mt5_password":             mt5_password,
            "mt5_server":               row["mt5_server"],
            "sizing_strategy":          row["sizing_strategy"],
            "management_strategy":      row["management_strategy"],
            "deletion_strategy":        row["deletion_strategy"],
            "extraction_instructions":  row["extraction_instructions"],
            "range_entry_pct":          int(row["range_entry_pct"] or 0),
            "entry_if_favorable":       bool(row["entry_if_favorable"]),
            "active":                   bool(row["active"]),
            "created_at":               row["created_at"],
        }

    async def get_user(self, user_id: str) -> dict | None:
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM users WHERE user_id = ?", (user_id,)
            )
            row = await cursor.fetchone()

        if row is None:
            return None

        mt5_password: str | None = None
        if row["mt5_password_enc"]:
            try:
                mt5_password = _decrypt(row["mt5_password_enc"])
            except Exception:
                pass

        return {
            "user_id":                  row["user_id"],
            "api_id":                   row["api_id"],
            "api_hash":                 row["api_hash"],
            "phone":                    row["phone"],
            "group_id":                 row["group_id"],
            "group_name":               row["group_name"],
            "mt5_login":                row["mt5_login"],
            "mt5_password":             mt5_password,
            "mt5_server":               row["mt5_server"],
            "sizing_strategy":          row["sizing_strategy"],
            "management_strategy":      row["management_strategy"],
            "deletion_strategy":        row["deletion_strategy"],
            "extraction_instructions":  row["extraction_instructions"],
            "range_entry_pct":          int(row["range_entry_pct"] or 0),
            "entry_if_favorable":       bool(row["entry_if_favorable"]),
            "active":                   bool(row["active"]),
            "created_at":               row["created_at"],
        }
