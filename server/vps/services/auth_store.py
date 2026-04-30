"""
AuthStore — hashing password + gestione refresh JWT token.

Schema:
  auth(
    phone         TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    refresh_jti   TEXT,          -- JTI del refresh token corrente (NULL = nessuna sessione)
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )

Usa argon2id per l'hashing: resistente a GPU e side-channel attack.
"""

from __future__ import annotations

from pathlib import Path

import aiosqlite
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

_ph = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS auth (
    phone         TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    refresh_jti   TEXT,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""


class AuthStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path

    async def init(self) -> None:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.commit()

    # ── Password ──────────────────────────────────────────────────────────────

    async def set_password(self, phone: str, password: str) -> None:
        h = _ph.hash(password)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """
                INSERT INTO auth(phone, password_hash)
                VALUES (?, ?)
                ON CONFLICT(phone) DO UPDATE
                  SET password_hash = excluded.password_hash,
                      updated_at    = CURRENT_TIMESTAMP
                """,
                (phone, h),
            )
            await db.commit()

    async def verify_password(self, phone: str, password: str) -> bool:
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT password_hash FROM auth WHERE phone = ?", (phone,)
            )
            row = await cur.fetchone()
        if row is None:
            return False
        try:
            return _ph.verify(row["password_hash"], password)
        except (VerifyMismatchError, InvalidHashError):
            return False

    async def has_password(self, phone: str) -> bool:
        async with aiosqlite.connect(self._db_path) as db:
            cur = await db.execute(
                "SELECT 1 FROM auth WHERE phone = ?", (phone,)
            )
            return await cur.fetchone() is not None

    # ── Refresh token (JTI) ───────────────────────────────────────────────────

    async def store_refresh_jti(self, phone: str, jti: str) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                """
                UPDATE auth
                SET refresh_jti = ?, updated_at = CURRENT_TIMESTAMP
                WHERE phone = ?
                """,
                (jti, phone),
            )
            await db.commit()

    async def get_refresh_jti(self, phone: str) -> str | None:
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT refresh_jti FROM auth WHERE phone = ?", (phone,)
            )
            row = await cur.fetchone()
        return row["refresh_jti"] if row else None

    async def clear_refresh_jti(self, phone: str) -> None:
        """Invalida tutte le sessioni esistenti per questo telefono."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(
                "UPDATE auth SET refresh_jti = NULL, updated_at = CURRENT_TIMESTAMP WHERE phone = ?",
                (phone,),
            )
            await db.commit()
