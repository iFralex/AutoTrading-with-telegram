"""
GroupFollowStore — tracks community group follows.

Schema:
    group_follows(id, follower_user_id, source_user_id, source_group_id, created_at)
    UNIQUE(follower_user_id, source_user_id, source_group_id)
"""
from __future__ import annotations

from pathlib import Path

import aiosqlite

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS group_follows (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_user_id TEXT    NOT NULL,
    source_user_id   TEXT    NOT NULL,
    source_group_id  INTEGER NOT NULL,
    created_at       TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_user_id, source_user_id, source_group_id)
)
"""

_IDX_FOLLOWER = "CREATE INDEX IF NOT EXISTS idx_gf_follower ON group_follows(follower_user_id)"
_IDX_SOURCE   = "CREATE INDEX IF NOT EXISTS idx_gf_source   ON group_follows(source_user_id, source_group_id)"


class GroupFollowStore:
    def __init__(self, db_path: Path) -> None:
        self._db = db_path

    async def init(self) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(_CREATE_TABLE)
            await db.execute(_IDX_FOLLOWER)
            await db.execute(_IDX_SOURCE)
            await db.commit()

    async def add_follow(
        self,
        follower_user_id: str,
        source_user_id: str,
        source_group_id: int,
    ) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                "INSERT OR IGNORE INTO group_follows "
                "(follower_user_id, source_user_id, source_group_id) VALUES (?, ?, ?)",
                (follower_user_id, source_user_id, source_group_id),
            )
            await db.commit()

    async def remove_follow(
        self,
        follower_user_id: str,
        source_user_id: str,
        source_group_id: int,
    ) -> None:
        async with aiosqlite.connect(self._db) as db:
            await db.execute(
                "DELETE FROM group_follows "
                "WHERE follower_user_id = ? AND source_user_id = ? AND source_group_id = ?",
                (follower_user_id, source_user_id, source_group_id),
            )
            await db.commit()

    async def get_followers(self, source_user_id: str, source_group_id: int) -> list[str]:
        async with aiosqlite.connect(self._db) as db:
            cursor = await db.execute(
                "SELECT follower_user_id FROM group_follows "
                "WHERE source_user_id = ? AND source_group_id = ?",
                (source_user_id, source_group_id),
            )
            rows = await cursor.fetchall()
        return [row[0] for row in rows]

    async def get_following(self, follower_user_id: str) -> list[dict]:
        async with aiosqlite.connect(self._db) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT source_user_id, source_group_id, created_at "
                "FROM group_follows WHERE follower_user_id = ? ORDER BY created_at DESC",
                (follower_user_id,),
            )
            rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def is_following(
        self,
        follower_user_id: str,
        source_user_id: str,
        source_group_id: int,
    ) -> bool:
        async with aiosqlite.connect(self._db) as db:
            cursor = await db.execute(
                "SELECT 1 FROM group_follows "
                "WHERE follower_user_id = ? AND source_user_id = ? AND source_group_id = ?",
                (follower_user_id, source_user_id, source_group_id),
            )
            row = await cursor.fetchone()
        return row is not None

    async def delete_by_source(self, source_user_id: str, source_group_id: int) -> int:
        async with aiosqlite.connect(self._db) as db:
            cursor = await db.execute(
                "DELETE FROM group_follows WHERE source_user_id = ? AND source_group_id = ?",
                (source_user_id, source_group_id),
            )
            await db.commit()
            return cursor.rowcount

    async def delete_by_follower(self, follower_user_id: str) -> int:
        async with aiosqlite.connect(self._db) as db:
            cursor = await db.execute(
                "DELETE FROM group_follows WHERE follower_user_id = ?",
                (follower_user_id,),
            )
            await db.commit()
            return cursor.rowcount

    async def delete_by_source_user(self, source_user_id: str) -> int:
        async with aiosqlite.connect(self._db) as db:
            cursor = await db.execute(
                "DELETE FROM group_follows WHERE source_user_id = ?",
                (source_user_id,),
            )
            await db.commit()
            return cursor.rowcount
