"""
AILogStore — persistenza dei log di ogni chiamata alle API Gemini.

Registra input/output, token counts, costo stimato e latenza per:
  - Gemini Flash (rilevamento segnale)
  - Gemini Pro (estrazione segnali)
  - Gemini Pro con function calling (strategy agent: pre_trade, on_event)

Schema:
  ai_logs(
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           TEXT,               -- NULL per chiamate di sistema
    ts                TEXT NOT NULL,      -- ISO timestamp UTC inizio chiamata
    call_type         TEXT NOT NULL,      -- "flash_detect" | "pro_extract" | "strategy_pretrade" | "strategy_event"
    model             TEXT NOT NULL,      -- es. "gemini-2.5-flash-preview-04-17"
    prompt_tokens     INTEGER,            -- token input (dall'API)
    completion_tokens INTEGER,            -- token output (dall'API)
    total_tokens      INTEGER,            -- prompt + completion
    cost_usd          REAL,               -- costo stimato in USD
    latency_ms        INTEGER,            -- durata totale chiamata in ms
    error             TEXT,               -- messaggio di errore (se la chiamata è fallita)
    context_json      TEXT                -- JSON con preview prompt/risposta e metadati specifici
  )

Pricing table (aggiornare se i prezzi Gemini cambiano):
  I costi sono in USD per milione di token.
  gemini-2.5-flash: $0.15 input / $0.60 output
  gemini-2.5-pro:   $1.25 input / $10.00 output
"""

from __future__ import annotations

import json as _json
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

# ── Pricing table (USD per milione di token) ──────────────────────────────────
# Chiavi: prefisso del model-id (match parziale, prima corrispondenza vince)
_PRICING: list[tuple[str, float, float]] = [
    # (prefix,            input_per_M, output_per_M)
    ("gemini-2.5-flash",  0.15,        0.60),
    ("gemini-2.5-pro",    1.25,       10.00),
    ("gemini-1.5-flash",  0.075,       0.30),
    ("gemini-1.5-pro",    1.25,        5.00),
]


def estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    """Stima il costo in USD della chiamata. Ritorna None se il modello non è noto."""
    model_lower = model.lower()
    for prefix, input_rate, output_rate in _PRICING:
        if prefix in model_lower:
            cost = (prompt_tokens / 1_000_000) * input_rate + (completion_tokens / 1_000_000) * output_rate
            return round(cost, 8)
    return None


# ── Schema SQL ────────────────────────────────────────────────────────────────

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS ai_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           TEXT,
    ts                TEXT    NOT NULL,
    call_type         TEXT    NOT NULL,
    model             TEXT    NOT NULL,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    total_tokens      INTEGER,
    cost_usd          REAL,
    latency_ms        INTEGER,
    error             TEXT,
    context_json      TEXT
)
"""

_CREATE_INDEX_USER = "CREATE INDEX IF NOT EXISTS idx_ai_logs_user_id ON ai_logs(user_id)"
_CREATE_INDEX_TS   = "CREATE INDEX IF NOT EXISTS idx_ai_logs_ts ON ai_logs(ts)"


# ── Store ─────────────────────────────────────────────────────────────────────

class AILogStore:

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path

    async def init(self) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute(_CREATE_TABLE)
            await db.execute(_CREATE_INDEX_USER)
            await db.execute(_CREATE_INDEX_TS)
            await db.commit()

    async def insert(
        self,
        *,
        call_type:         str,
        model:             str,
        user_id:           str | None     = None,
        prompt_tokens:     int | None     = None,
        completion_tokens: int | None     = None,
        latency_ms:        int | None     = None,
        error:             str | None     = None,
        context:           dict | None    = None,
        ts:                str | None     = None,
    ) -> int:
        """Inserisce un log AI. Ritorna l'id del record."""
        ts = ts or datetime.now(timezone.utc).isoformat()

        total_tokens = None
        cost_usd     = None
        if prompt_tokens is not None and completion_tokens is not None:
            total_tokens = prompt_tokens + completion_tokens
            cost_usd     = estimate_cost(model, prompt_tokens, completion_tokens)

        context_json = _json.dumps(context, ensure_ascii=False) if context else None

        async with aiosqlite.connect(self._db_path) as db:
            cursor = await db.execute(
                """
                INSERT INTO ai_logs
                    (user_id, ts, call_type, model,
                     prompt_tokens, completion_tokens, total_tokens,
                     cost_usd, latency_ms, error, context_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id, ts, call_type, model,
                    prompt_tokens, completion_tokens, total_tokens,
                    cost_usd, latency_ms, error, context_json,
                ),
            )
            await db.commit()
            return cursor.lastrowid  # type: ignore[return-value]

    async def get_by_user_id(
        self,
        user_id: str,
        limit:  int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Ultimi N log AI per un utente (più recenti prima)."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """
                SELECT * FROM ai_logs
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                (user_id, limit, offset),
            )
            rows = await cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("context_json"):
                try:
                    d["context"] = _json.loads(d["context_json"])
                except Exception:
                    d["context"] = None
            del d["context_json"]
            result.append(d)
        return result

    async def get_stats(self, user_id: str) -> dict:
        """Statistiche aggregate sull'utilizzo AI per un utente."""
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row

            # ── Totali globali ────────────────────────────────────────────
            cur = await db.execute(
                """
                SELECT
                  COUNT(*)                                    AS total_calls,
                  COALESCE(SUM(prompt_tokens), 0)            AS total_prompt_tokens,
                  COALESCE(SUM(completion_tokens), 0)        AS total_completion_tokens,
                  COALESCE(SUM(total_tokens), 0)             AS total_tokens,
                  COALESCE(SUM(cost_usd), 0)                 AS total_cost_usd,
                  COALESCE(AVG(latency_ms), 0)               AS avg_latency_ms,
                  COALESCE(SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_errors
                FROM ai_logs WHERE user_id = ?
                """,
                (user_id,),
            )
            base = dict(await cur.fetchone())

            # ── Per tipo di chiamata ──────────────────────────────────────
            cur = await db.execute(
                """
                SELECT
                  call_type,
                  COUNT(*) AS calls,
                  COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
                  COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
                  COALESCE(SUM(total_tokens), 0)      AS total_tokens,
                  COALESCE(SUM(cost_usd), 0)          AS cost_usd,
                  COALESCE(AVG(latency_ms), 0)        AS avg_latency_ms,
                  COALESCE(SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END), 0) AS errors
                FROM ai_logs WHERE user_id = ?
                GROUP BY call_type
                ORDER BY calls DESC
                """,
                (user_id,),
            )
            by_call_type = [dict(r) for r in await cur.fetchall()]

            # ── Per modello ───────────────────────────────────────────────
            cur = await db.execute(
                """
                SELECT
                  model,
                  COUNT(*) AS calls,
                  COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
                  COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
                  COALESCE(SUM(total_tokens), 0)      AS total_tokens,
                  COALESCE(SUM(cost_usd), 0)          AS cost_usd,
                  COALESCE(AVG(latency_ms), 0)        AS avg_latency_ms
                FROM ai_logs WHERE user_id = ?
                GROUP BY model
                ORDER BY calls DESC
                """,
                (user_id,),
            )
            by_model = [dict(r) for r in await cur.fetchall()]

            # ── Trend giornaliero (ultimi 30 giorni) ─────────────────────
            cur = await db.execute(
                """
                SELECT
                  date(ts) AS day,
                  COUNT(*) AS calls,
                  COALESCE(SUM(total_tokens), 0) AS total_tokens,
                  COALESCE(SUM(cost_usd), 0)     AS cost_usd
                FROM ai_logs
                WHERE user_id = ? AND date(ts) >= date('now', '-30 days')
                GROUP BY date(ts)
                ORDER BY day ASC
                """,
                (user_id,),
            )
            daily = [dict(r) for r in await cur.fetchall()]

        # Arrotonda float
        def _r(v, n=4):
            return round(float(v or 0), n)

        for row in by_call_type + by_model:
            row["cost_usd"]      = _r(row["cost_usd"], 6)
            row["avg_latency_ms"] = round(float(row.get("avg_latency_ms") or 0))
        for row in daily:
            row["cost_usd"] = _r(row["cost_usd"], 6)

        return {
            "total_calls":              int(base["total_calls"]),
            "total_prompt_tokens":      int(base["total_prompt_tokens"]),
            "total_completion_tokens":  int(base["total_completion_tokens"]),
            "total_tokens":             int(base["total_tokens"]),
            "total_cost_usd":           _r(base["total_cost_usd"], 6),
            "avg_latency_ms":           round(float(base["avg_latency_ms"] or 0)),
            "total_errors":             int(base["total_errors"]),
            "by_call_type":             by_call_type,
            "by_model":                 by_model,
            "daily":                    daily,
        }


# ── Context manager per misurare la latenza ───────────────────────────────────

class _Timer:
    """Misura il tempo trascorso in ms."""
    def __init__(self):
        self._start = time.monotonic()

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self._start) * 1000)


def make_timer() -> _Timer:
    return _Timer()
