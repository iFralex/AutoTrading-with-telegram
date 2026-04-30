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
    sizing_strategy         TEXT,
    management_strategy     TEXT,
    deletion_strategy       TEXT,
    extraction_instructions TEXT,
    updated_at              TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    mt5_server              TEXT,
    sizing_strategy         TEXT,
    management_strategy     TEXT,
    deletion_strategy       TEXT,
    extraction_instructions TEXT,
    range_entry_pct         INTEGER DEFAULT 50,
    entry_if_favorable      INTEGER DEFAULT 0,
    min_confidence          INTEGER DEFAULT 0,
    trading_hours_enabled   INTEGER DEFAULT 0,
    trading_hours_start     INTEGER DEFAULT 8,
    trading_hours_end       INTEGER DEFAULT 22,
    trading_hours_days      TEXT,
    eco_calendar_enabled    INTEGER DEFAULT 0,
    eco_calendar_window     INTEGER DEFAULT 30,
    eco_calendar_strategy   TEXT,
    community_visible       INTEGER DEFAULT 0,
    plan                    TEXT,
    stripe_session_id       TEXT,
    updated_at              TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""

# Campi che il frontend può leggere/scrivere (senza la password cifrata)
_ALLOWED_FIELDS = {
    "api_id", "api_hash", "login_key", "user_id",
    "group_id", "group_name", "mt5_login", "mt5_server",
    "sizing_strategy", "management_strategy", "deletion_strategy",
    "extraction_instructions",
    "range_entry_pct", "entry_if_favorable", "min_confidence",
    "trading_hours_enabled", "trading_hours_start", "trading_hours_end",
    "trading_hours_days",
    "eco_calendar_enabled", "eco_calendar_window", "eco_calendar_strategy",
    "community_visible",
    "plan", "stripe_session_id",
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
        """Crea la tabella se non esiste; applica le migration."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.commit()
            # Migration incrementale: ignora errore se la colonna esiste già
            for _sql in [
                "ALTER TABLE setup_sessions ADD COLUMN management_strategy TEXT",
                "ALTER TABLE setup_sessions ADD COLUMN deletion_strategy TEXT",
                "ALTER TABLE setup_sessions ADD COLUMN extraction_instructions TEXT",
                "ALTER TABLE setup_sessions ADD COLUMN range_entry_pct INTEGER DEFAULT 50",
                "ALTER TABLE setup_sessions ADD COLUMN entry_if_favorable INTEGER DEFAULT 0",
                "ALTER TABLE setup_sessions ADD COLUMN min_confidence INTEGER DEFAULT 0",
                "ALTER TABLE setup_sessions ADD COLUMN trading_hours_enabled INTEGER DEFAULT 0",
                "ALTER TABLE setup_sessions ADD COLUMN trading_hours_start INTEGER DEFAULT 8",
                "ALTER TABLE setup_sessions ADD COLUMN trading_hours_end INTEGER DEFAULT 22",
                "ALTER TABLE setup_sessions ADD COLUMN trading_hours_days TEXT",
                "ALTER TABLE setup_sessions ADD COLUMN eco_calendar_enabled INTEGER DEFAULT 0",
                "ALTER TABLE setup_sessions ADD COLUMN eco_calendar_window INTEGER DEFAULT 30",
                "ALTER TABLE setup_sessions ADD COLUMN eco_calendar_strategy TEXT",
                "ALTER TABLE setup_sessions ADD COLUMN community_visible INTEGER DEFAULT 0",
                "ALTER TABLE setup_sessions ADD COLUMN plan TEXT",
                "ALTER TABLE setup_sessions ADD COLUMN stripe_session_id TEXT",
            ]:
                try:
                    await db.execute(_sql)
                    await db.commit()
                except Exception:
                    pass

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

        import json as _json
        raw_days = row["trading_hours_days"]
        return {
            "phone":               row["phone"],
            "api_id":              row["api_id"],
            "api_hash":            row["api_hash"],
            "login_key":           row["login_key"],
            "user_id":             row["user_id"],
            "group_id":            row["group_id"],
            "group_name":          row["group_name"],
            "mt5_login":           row["mt5_login"],
            "has_mt5_password":    bool(row["mt5_password_enc"]),
            "mt5_server":          row["mt5_server"],
            "sizing_strategy":         row["sizing_strategy"],
            "management_strategy":     row["management_strategy"],
            "deletion_strategy":       row["deletion_strategy"],
            "extraction_instructions": row["extraction_instructions"],
            "range_entry_pct":         row["range_entry_pct"] if row["range_entry_pct"] is not None else 50,
            "entry_if_favorable":      bool(row["entry_if_favorable"] or 0),
            "min_confidence":          row["min_confidence"] if row["min_confidence"] is not None else 0,
            "trading_hours_enabled":   bool(row["trading_hours_enabled"] or 0),
            "trading_hours_start":     row["trading_hours_start"] if row["trading_hours_start"] is not None else 8,
            "trading_hours_end":       row["trading_hours_end"] if row["trading_hours_end"] is not None else 22,
            "trading_hours_days":      _json.loads(raw_days) if raw_days else ["MON","TUE","WED","THU","FRI"],
            "eco_calendar_enabled":    bool(row["eco_calendar_enabled"] or 0),
            "eco_calendar_window":     row["eco_calendar_window"] if row["eco_calendar_window"] is not None else 30,
            "eco_calendar_strategy":   row["eco_calendar_strategy"],
            "community_visible":       bool(row["community_visible"] or 0),
            "plan":                    row["plan"],
            "stripe_session_id":       row["stripe_session_id"],
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
        import json as _json
        db_fields: dict = {}
        for k, v in fields.items():
            col = _FIELD_MAP.get(k, k)
            if k == "mt5_password":
                db_fields[col] = _encrypt(v) if v else None
            elif k == "trading_hours_days":
                db_fields[col] = _json.dumps(v) if isinstance(v, list) else v
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
