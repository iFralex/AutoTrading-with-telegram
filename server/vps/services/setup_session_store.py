"""
SetupSessionStore — persistenza dello stato parziale di setup in SQLite.

Ogni sessione è identificata dal numero di telefono dell'utente.
Permette al wizard di riprendere dal punto in cui si è fermato.

Schema:
  setup_sessions(
    phone            TEXT PRIMARY KEY,
    api_id           INTEGER,
    api_hash         TEXT,
    login_key        TEXT,
    user_id          TEXT,
    group_id         TEXT,
    group_name       TEXT,
    mt5_login        INTEGER,
    mt5_password_enc TEXT,   -- cifrata con Fernet
    mt5_server       TEXT,
    sizing_strategy  TEXT,
    updated_at       TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
"""

from __future__ import annotations

import os
from pathlib import Path

import aiosqlite
from cryptography.fernet import Fernet

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS setup_sessions (
    phone            TEXT    PRIMARY KEY,
    api_id           INTEGER,
    api_hash         TEXT,
    login_key        TEXT,
    user_id          TEXT,
    group_id         TEXT,
    group_name       TEXT,
    mt5_login        INTEGER,
    mt5_password_enc TEXT,
    mt5_server       TEXT,
    sizing_strategy  TEXT,
    updated_at       TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""

# Campi che il frontend può leggere/scrivere (senza la password cifrata)
_ALLOWED_FIELDS = {
    "api_id", "api_hash", "login_key", "user_id",
    "group_id", "group_name", "mt5_login", "mt5_server", "sizing_strategy",
}

# Mappatura nomi frontend → colonne DB
_FIELD_MAP: dict[str, str] = {
    "mt5_password": "mt5_password_enc",
}


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


class SetupSessionStore:
    """
    Persistenza asincrona dello stato parziale di setup.

    Uso:
        store = SetupSessionStore(db_path)
        await store.init()
        await store.upsert(phone, {"api_id": 123, "api_hash": "abc..."})
        session = await store.get(phone)
        await store.clear_fields(phone, ["login_key", "user_id"])
        await store.delete(phone)
    """

    def __init__(self, db_path: Path):
        self._db_path = db_path

    async def init(self) -> None:
        """Crea la tabella se non esiste."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.commit()

    # ── Read ─────────────────────────────────────────────────────────────────

    async def get(self, phone: str) -> dict | None:
        """
        Ritorna lo stato della sessione per il numero di telefono dato.
        Non include il campo mt5_password; usa has_mt5_password per sapere
        se la password è memorizzata.
        """
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM setup_sessions WHERE phone = ?", (phone,)
            )
            row = await cursor.fetchone()

        if row is None:
            return None

        return {
            "phone":            row["phone"],
            "api_id":           row["api_id"],
            "api_hash":         row["api_hash"],
            "login_key":        row["login_key"],
            "user_id":          row["user_id"],
            "group_id":         row["group_id"],
            "group_name":       row["group_name"],
            "mt5_login":        row["mt5_login"],
            "has_mt5_password": bool(row["mt5_password_enc"]),
            "mt5_server":       row["mt5_server"],
            "sizing_strategy":  row["sizing_strategy"],
        }

    async def get_mt5_password(self, phone: str) -> str | None:
        """Ritorna la password MT5 decifrata dalla sessione, se presente."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT mt5_password_enc FROM setup_sessions WHERE phone = ?",
                (phone,),
            )
            row = await cursor.fetchone()

        if row is None or not row["mt5_password_enc"]:
            return None

        try:
            return _decrypt(row["mt5_password_enc"])
        except Exception:
            return None

    # ── Write ────────────────────────────────────────────────────────────────

    async def upsert(self, phone: str, fields: dict) -> None:
        """
        Inserisce o aggiorna una sessione con i campi forniti.

        Campi accettati:
            api_id, api_hash, login_key, user_id,
            group_id, group_name,
            mt5_login, mt5_password (verrà cifrata), mt5_server,
            sizing_strategy
        """
        # Cifra la password se presente
        db_fields: dict = {}
        for k, v in fields.items():
            col = _FIELD_MAP.get(k, k)
            if k == "mt5_password":
                db_fields[col] = _encrypt(v) if v else None
            elif col in _ALLOWED_FIELDS or col == "mt5_password_enc":
                db_fields[col] = v

        # Garantisce che la riga esista
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "INSERT OR IGNORE INTO setup_sessions (phone) VALUES (?)", (phone,)
            )
            await db.commit()

        if not db_fields:
            return

        set_parts = [f"{col} = ?" for col in db_fields] + ["updated_at = CURRENT_TIMESTAMP"]
        values = list(db_fields.values()) + [phone]

        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                f"UPDATE setup_sessions SET {', '.join(set_parts)} WHERE phone = ?",
                values,
            )
            await db.commit()

    async def clear_fields(self, phone: str, fields: list[str]) -> None:
        """
        Imposta a NULL i campi specificati nella sessione.

        Accetta sia nomi frontend ("mt5_password") che nomi DB ("mt5_password_enc").
        """
        db_cols: list[str] = []
        for f in fields:
            col = _FIELD_MAP.get(f, f)
            if col in _ALLOWED_FIELDS or col == "mt5_password_enc":
                db_cols.append(col)

        if not db_cols:
            return

        set_parts = [f"{col} = NULL" for col in db_cols] + ["updated_at = CURRENT_TIMESTAMP"]

        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                f"UPDATE setup_sessions SET {', '.join(set_parts)} WHERE phone = ?",
                [phone],
            )
            await db.commit()

    async def delete(self, phone: str) -> None:
        """Elimina completamente la sessione per il numero di telefono."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "DELETE FROM setup_sessions WHERE phone = ?", (phone,)
            )
            await db.commit()
