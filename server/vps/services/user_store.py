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

_CREATE_LINKS_TABLE = """
CREATE TABLE IF NOT EXISTS signal_links (
    source_user_id  TEXT NOT NULL,
    target_user_id  TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_user_id, target_user_id)
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

# ── Tabella multi-gruppo ──────────────────────────────────────────────────────

_CREATE_USER_GROUPS_TABLE = """
CREATE TABLE IF NOT EXISTS user_groups (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                 TEXT    NOT NULL,
    group_id                INTEGER NOT NULL,
    group_name              TEXT    NOT NULL,
    sizing_strategy         TEXT,
    management_strategy     TEXT,
    range_entry_pct         INTEGER NOT NULL DEFAULT 0,
    entry_if_favorable      INTEGER NOT NULL DEFAULT 0,
    deletion_strategy       TEXT,
    extraction_instructions TEXT,
    active                  INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, group_id)
)
"""

_CREATE_USER_GROUPS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_user_groups_user_id ON user_groups(user_id)
"""

# Migrazione dati: popola user_groups dai gruppi già presenti nella tabella users
_MIGRATE_USER_GROUPS_DATA = """
INSERT OR IGNORE INTO user_groups
    (user_id, group_id, group_name,
     sizing_strategy, management_strategy,
     range_entry_pct, entry_if_favorable,
     deletion_strategy, extraction_instructions,
     active, created_at)
SELECT
    user_id, group_id, group_name,
    sizing_strategy, management_strategy,
    COALESCE(range_entry_pct, 0),
    COALESCE(entry_if_favorable, 0),
    deletion_strategy, extraction_instructions,
    active, created_at
FROM users
WHERE group_id IS NOT NULL AND group_id != 0
"""


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
        """Crea il database e le tabelle se non esistono; applica le migration."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.execute(_CREATE_LINKS_TABLE)
            await db.commit()
            # Migration incrementali: ignora errori se la colonna esiste già
            for sql in _MIGRATIONS:
                try:
                    await db.execute(sql)
                    await db.commit()
                except Exception:
                    pass
            # Tabella multi-gruppo e migrazione dati
            await db.execute(_CREATE_USER_GROUPS_TABLE)
            await db.execute(_CREATE_USER_GROUPS_INDEX)
            await db.commit()
            try:
                await db.execute(_MIGRATE_USER_GROUPS_DATA)
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

    # ── User groups CRUD ─────────────────────────────────────────────────────

    async def _fetch_groups_for_user(self, db: "aiosqlite.Connection", user_id: str) -> list[dict]:
        """Helper: legge tutti i gruppi dell'utente usando una connessione già aperta."""
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM user_groups WHERE user_id = ? ORDER BY id ASC",
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [_group_row_to_dict(row) for row in rows]

    async def get_user_groups(self, user_id: str) -> list[dict]:
        """Ritorna tutti i gruppi di un utente."""
        async with aiosqlite.connect(self._db_path) as db:
            return await self._fetch_groups_for_user(db, user_id)

    async def get_user_group(self, user_id: str, group_id: int) -> dict | None:
        """Ritorna le impostazioni di un singolo gruppo."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM user_groups WHERE user_id = ? AND group_id = ?",
                (user_id, group_id),
            )
            row = await cursor.fetchone()
        return _group_row_to_dict(row) if row is not None else None

    async def upsert_user_group(
        self,
        user_id: str,
        group_id: int,
        group_name: str,
        *,
        sizing_strategy: str | None = None,
        management_strategy: str | None = None,
        range_entry_pct: int = 0,
        entry_if_favorable: bool = False,
        deletion_strategy: str | None = None,
        extraction_instructions: str | None = None,
        active: bool = True,
    ) -> None:
        """Inserisce o aggiorna un gruppo utente."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """
                INSERT INTO user_groups
                    (user_id, group_id, group_name,
                     sizing_strategy, management_strategy, range_entry_pct,
                     entry_if_favorable, deletion_strategy, extraction_instructions, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, group_id) DO UPDATE SET
                    group_name              = excluded.group_name,
                    sizing_strategy         = excluded.sizing_strategy,
                    management_strategy     = excluded.management_strategy,
                    range_entry_pct         = excluded.range_entry_pct,
                    entry_if_favorable      = excluded.entry_if_favorable,
                    deletion_strategy       = excluded.deletion_strategy,
                    extraction_instructions = excluded.extraction_instructions,
                    active                  = excluded.active
                """,
                (
                    user_id, group_id, group_name,
                    sizing_strategy, management_strategy,
                    max(0, min(100, int(range_entry_pct))),
                    1 if entry_if_favorable else 0,
                    deletion_strategy, extraction_instructions,
                    1 if active else 0,
                ),
            )
            await db.commit()

    async def update_user_group_settings(
        self,
        user_id: str,
        group_id: int,
        fields: dict,
    ) -> None:
        """Aggiorna selettivamente le impostazioni di un gruppo utente."""
        allowed = {
            "group_name", "sizing_strategy", "management_strategy",
            "range_entry_pct", "entry_if_favorable",
            "deletion_strategy", "extraction_instructions",
        }
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return
        # Coerce types
        if "range_entry_pct" in updates:
            updates["range_entry_pct"] = max(0, min(100, int(updates["range_entry_pct"])))
        if "entry_if_favorable" in updates:
            updates["entry_if_favorable"] = 1 if updates["entry_if_favorable"] else 0
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [user_id, group_id]
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                f"UPDATE user_groups SET {set_clause} WHERE user_id = ? AND group_id = ?",
                values,
            )
            await db.commit()

    async def delete_user_group(self, user_id: str, group_id: int) -> None:
        """Rimuove un gruppo dal profilo dell'utente."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "DELETE FROM user_groups WHERE user_id = ? AND group_id = ?",
                (user_id, group_id),
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
        TelegramManager.restore_users(). Include group_ids (lista) per il
        multi-gruppo e i campi del primo gruppo per backward-compat.
        """
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM users WHERE active = 1")
            rows = await cursor.fetchall()

            result = []
            for row in rows:
                groups = await self._fetch_groups_for_user(db, row["user_id"])
                active_groups = [g for g in groups if g["active"]]
                first = active_groups[0] if active_groups else {}

                mt5_password: str | None = None
                if row["mt5_password_enc"]:
                    try:
                        mt5_password = _decrypt(row["mt5_password_enc"])
                    except Exception:
                        mt5_password = None

                result.append({
                    "user_id":   row["user_id"],
                    "api_id":    row["api_id"],
                    "api_hash":  row["api_hash"],
                    "phone":     row["phone"],
                    "mt5_login": row["mt5_login"],
                    "mt5_password": mt5_password,
                    "mt5_server":   row["mt5_server"],
                    # Multi-gruppo
                    "group_ids": [g["group_id"] for g in active_groups],
                    "groups":    active_groups,
                    # Backward-compat: primo gruppo attivo
                    "group_id":              first.get("group_id"),
                    "group_name":            first.get("group_name"),
                    "sizing_strategy":       first.get("sizing_strategy"),
                    "management_strategy":   first.get("management_strategy"),
                    "deletion_strategy":     first.get("deletion_strategy"),
                    "extraction_instructions": first.get("extraction_instructions"),
                    "range_entry_pct":       first.get("range_entry_pct", 0),
                    "entry_if_favorable":    first.get("entry_if_favorable", False),
                })
        return result

    async def get_user_by_phone(self, phone: str) -> dict | None:
        """Cerca un utente per numero di telefono. Include la lista dei gruppi."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM users WHERE phone = ?", (phone,)
            )
            row = await cursor.fetchone()
            if row is None:
                return None
            groups = await self._fetch_groups_for_user(db, row["user_id"])

        mt5_password: str | None = None
        if row["mt5_password_enc"]:
            try:
                mt5_password = _decrypt(row["mt5_password_enc"])
            except Exception:
                pass

        first = groups[0] if groups else {}
        return {
            "user_id":   row["user_id"],
            "api_id":    row["api_id"],
            "api_hash":  row["api_hash"],
            "phone":     row["phone"],
            "mt5_login": row["mt5_login"],
            "mt5_password": mt5_password,
            "mt5_server":   row["mt5_server"],
            "active":    bool(row["active"]),
            "created_at": row["created_at"],
            "groups":    groups,
            # Backward-compat: primo gruppo
            "group_id":              first.get("group_id"),
            "group_name":            first.get("group_name"),
            "sizing_strategy":       first.get("sizing_strategy"),
            "management_strategy":   first.get("management_strategy"),
            "deletion_strategy":     first.get("deletion_strategy"),
            "extraction_instructions": first.get("extraction_instructions"),
            "range_entry_pct":       first.get("range_entry_pct", 0),
            "entry_if_favorable":    first.get("entry_if_favorable", False),
        }

    async def get_user(self, user_id: str) -> dict | None:
        """Ritorna l'utente con la lista completa dei gruppi."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM users WHERE user_id = ?", (user_id,)
            )
            row = await cursor.fetchone()
            if row is None:
                return None
            groups = await self._fetch_groups_for_user(db, row["user_id"])

        mt5_password: str | None = None
        if row["mt5_password_enc"]:
            try:
                mt5_password = _decrypt(row["mt5_password_enc"])
            except Exception:
                pass

        first = groups[0] if groups else {}
        return {
            "user_id":   row["user_id"],
            "api_id":    row["api_id"],
            "api_hash":  row["api_hash"],
            "phone":     row["phone"],
            "mt5_login": row["mt5_login"],
            "mt5_password": mt5_password,
            "mt5_server":   row["mt5_server"],
            "active":    bool(row["active"]),
            "created_at": row["created_at"],
            "groups":    groups,
            # Backward-compat: primo gruppo
            "group_id":              first.get("group_id"),
            "group_name":            first.get("group_name"),
            "sizing_strategy":       first.get("sizing_strategy"),
            "management_strategy":   first.get("management_strategy"),
            "deletion_strategy":     first.get("deletion_strategy"),
            "extraction_instructions": first.get("extraction_instructions"),
            "range_entry_pct":       first.get("range_entry_pct", 0),
            "entry_if_favorable":    first.get("entry_if_favorable", False),
        }

    # ── Signal links ──────────────────────────────────────────────────────────

    async def is_link_target(self, user_id: str) -> bool:
        """Ritorna True se user_id riceve segnali da almeno un altro utente."""
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT 1 FROM signal_links WHERE target_user_id = ? LIMIT 1",
                (user_id,),
            )
            row = await cursor.fetchone()
        return row is not None

    async def add_link(self, source_user_id: str, target_user_id: str) -> None:
        """Associa i segnali di source_user_id a target_user_id."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "INSERT OR IGNORE INTO signal_links (source_user_id, target_user_id) VALUES (?, ?)",
                (source_user_id, target_user_id),
            )
            await db.commit()

    async def remove_link(self, source_user_id: str, target_user_id: str) -> None:
        """Rimuove l'associazione segnali tra i due utenti."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "DELETE FROM signal_links WHERE source_user_id = ? AND target_user_id = ?",
                (source_user_id, target_user_id),
            )
            await db.commit()

    async def get_linked_users(self, source_user_id: str) -> list[str]:
        """Ritorna la lista di user_id che ricevono i segnali di source_user_id."""
        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                "SELECT target_user_id FROM signal_links WHERE source_user_id = ?",
                (source_user_id,),
            )
            rows = await cursor.fetchall()
        return [row[0] for row in rows]

    async def list_all_links(self) -> list[dict]:
        """Ritorna tutti i link segnale presenti nel DB."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT source_user_id, target_user_id, created_at FROM signal_links ORDER BY created_at"
            )
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def delete_all_links_for_user(self, user_id: str) -> None:
        """Rimuove tutti i link (come sorgente o destinazione) per un utente."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "DELETE FROM signal_links WHERE source_user_id = ? OR target_user_id = ?",
                (user_id, user_id),
            )
            await db.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _group_row_to_dict(row: "aiosqlite.Row") -> dict:
    return {
        "id":                       row["id"],
        "user_id":                  row["user_id"],
        "group_id":                 row["group_id"],
        "group_name":               row["group_name"],
        "sizing_strategy":          row["sizing_strategy"],
        "management_strategy":      row["management_strategy"],
        "range_entry_pct":          int(row["range_entry_pct"] or 0),
        "entry_if_favorable":       bool(row["entry_if_favorable"]),
        "deletion_strategy":        row["deletion_strategy"],
        "extraction_instructions":  row["extraction_instructions"],
        "active":                   bool(row["active"]),
        "created_at":               row["created_at"],
    }
