"""
Persistenza dei report mensili PDF in SQLite (colonna BLOB).

Schema:
    monthly_reports(id, user_id, year, month, generated_at, pdf_bytes, size_bytes)
    UNIQUE(user_id, year, month) → ON CONFLICT DO UPDATE
"""
from __future__ import annotations

from pathlib import Path

import aiosqlite


class MonthlyReportStore:
    def __init__(self, db_path: Path) -> None:
        self._db = db_path

    async def init(self) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS monthly_reports (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id      TEXT    NOT NULL,
                    year         INTEGER NOT NULL,
                    month        INTEGER NOT NULL,
                    generated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    pdf_bytes    BLOB    NOT NULL,
                    size_bytes   INTEGER NOT NULL,
                    UNIQUE(user_id, year, month)
                )
            """)
            await db.commit()

    async def save(self, user_id: str, year: int, month: int, pdf_bytes: bytes) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                """
                INSERT INTO monthly_reports (user_id, year, month, generated_at, pdf_bytes, size_bytes)
                VALUES (?, ?, ?, datetime('now'), ?, ?)
                ON CONFLICT(user_id, year, month) DO UPDATE SET
                    generated_at = excluded.generated_at,
                    pdf_bytes    = excluded.pdf_bytes,
                    size_bytes   = excluded.size_bytes
                """,
                (user_id, year, month, pdf_bytes, len(pdf_bytes)),
            )
            await db.commit()

    async def list_for_user(self, user_id: str) -> list[dict]:
        """Returns all saved reports for a user, without pdf_bytes (metadata only)."""
        async with aiosqlite.connect(self._db) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """
                SELECT id, user_id, year, month, generated_at, size_bytes
                FROM monthly_reports
                WHERE user_id = ?
                ORDER BY year DESC, month DESC
                """,
                (user_id,),
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get(self, user_id: str, year: int, month: int) -> bytes | None:
        async with aiosqlite.connect(self._db) as db:
            async with db.execute(
                "SELECT pdf_bytes FROM monthly_reports WHERE user_id = ? AND year = ? AND month = ?",
                (user_id, year, month),
            ) as cur:
                row = await cur.fetchone()
        return bytes(row[0]) if row else None

    async def delete_by_user_id(self, user_id: str) -> int:
        async with aiosqlite.connect(self._db) as db:
            cur = await db.execute(
                "DELETE FROM monthly_reports WHERE user_id = ?",
                (user_id,),
            )
            await db.commit()
            return cur.rowcount
