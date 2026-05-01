"""
Admin API — read-only statistics for the operator dashboard.

Auth: X-Admin-Secret header must match the ADMIN_SECRET env var.

Endpoints:
  GET /api/admin/overview           — global KPI cards
  GET /api/admin/users              — all users with aggregated stats
  GET /api/admin/users/{user_id}    — per-user detail
  GET /api/admin/ai                 — AI usage/costs by call_type
  GET /api/admin/ai/logs            — paginated AI call logs
  GET /api/admin/signals            — global signal stats
  GET /api/admin/signals/logs       — paginated signal logs
  GET /api/admin/trades             — global trade stats
  GET /api/admin/strategy/logs      — paginated strategy execution logs
  GET /api/admin/revenue            — subscription / billing overview
  GET /api/admin/messages/users     — users + groups that have messages
  GET /api/admin/messages           — paginated raw messages (filterable by user/group)
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any

import aiosqlite
from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(prefix="/api/admin", tags=["admin"])

_PLAN_PRICES: dict[str, float] = {
    "core":  79.0,
    "pro":  149.0,
    "elite": 299.0,
}


# ── Auth helper ───────────────────────────────────────────────────────────────

def _check_auth(request: Request) -> None:
    secret = os.environ.get("ADMIN_SECRET", "")
    if not secret:
        raise HTTPException(503, "ADMIN_SECRET not configured")
    if request.headers.get("x-admin-secret") != secret:
        raise HTTPException(401, "Unauthorized")


def _db(request: Request) -> str:
    return str(request.app.state.db_path)


# ── Overview ──────────────────────────────────────────────────────────────────

@router.get("/overview")
async def get_overview(request: Request) -> dict[str, Any]:
    _check_auth(request)
    db_path = _db(request)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row

        users_row = await (await db.execute(
            "SELECT COUNT(*) AS total, SUM(active) AS active FROM users"
        )).fetchone()

        signals_row = await (await db.execute(
            "SELECT COUNT(*) AS total, SUM(is_signal) AS signals, "
            "SUM(CASE WHEN error_step IS NOT NULL THEN 1 ELSE 0 END) AS errors "
            "FROM signal_logs"
        )).fetchone()

        trades_row = await (await db.execute(
            "SELECT COUNT(*) AS total, "
            "SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) AS wins, "
            "SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END) AS losses, "
            "ROUND(SUM(profit), 2) AS total_pnl "
            "FROM closed_trades"
        )).fetchone()

        ai_row = await (await db.execute(
            "SELECT COUNT(*) AS calls, "
            "ROUND(SUM(cost_usd), 4) AS total_cost, "
            "SUM(total_tokens) AS tokens "
            "FROM ai_logs"
        )).fetchone()

        strategy_row = await (await db.execute(
            "SELECT COUNT(*) AS total, "
            "SUM(CASE WHEN error_msg IS NOT NULL THEN 1 ELSE 0 END) AS errors "
            "FROM strategy_logs"
        )).fetchone()

        revenue_row = await (await db.execute(
            "SELECT plan, COUNT(*) AS cnt FROM users WHERE active=1 GROUP BY plan"
        )).fetchall()

    monthly_revenue = sum(
        _PLAN_PRICES.get(r["plan"] or "", 0) * r["cnt"]
        for r in revenue_row
    )

    return {
        "users": {
            "total":  users_row["total"] or 0,
            "active": users_row["active"] or 0,
        },
        "signals": {
            "total":   signals_row["total"] or 0,
            "signals": signals_row["signals"] or 0,
            "errors":  signals_row["errors"] or 0,
        },
        "trades": {
            "total":     trades_row["total"] or 0,
            "wins":      trades_row["wins"] or 0,
            "losses":    trades_row["losses"] or 0,
            "total_pnl": trades_row["total_pnl"] or 0.0,
        },
        "ai": {
            "calls":      ai_row["calls"] or 0,
            "total_cost": ai_row["total_cost"] or 0.0,
            "tokens":     ai_row["tokens"] or 0,
        },
        "strategy": {
            "total":  strategy_row["total"] or 0,
            "errors": strategy_row["errors"] or 0,
        },
        "revenue": {
            "monthly_usd": round(monthly_revenue, 2),
            "by_plan": [dict(r) for r in revenue_row],
        },
    }


# ── Users list ────────────────────────────────────────────────────────────────

@router.get("/users")
async def get_users(request: Request) -> list[dict[str, Any]]:
    _check_auth(request)
    db_path = _db(request)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute("""
            SELECT
                u.user_id, u.phone, u.active, u.plan, u.created_at,
                COUNT(DISTINCT sl.id)  AS signal_count,
                COUNT(DISTINCT ct.id)  AS trade_count,
                ROUND(SUM(ct.profit), 2) AS total_pnl,
                COUNT(DISTINCT al.id)  AS ai_calls,
                ROUND(SUM(al.cost_usd), 4) AS ai_cost
            FROM users u
            LEFT JOIN signal_logs sl ON sl.user_id = u.user_id
            LEFT JOIN closed_trades ct ON ct.user_id = u.user_id
            LEFT JOIN ai_logs al ON al.user_id = u.user_id
            GROUP BY u.user_id
            ORDER BY u.created_at DESC
        """)).fetchall()
    return [dict(r) for r in rows]


# ── User detail ───────────────────────────────────────────────────────────────

@router.get("/users/{user_id}")
async def get_user_detail(user_id: str, request: Request) -> dict[str, Any]:
    _check_auth(request)
    db_path = _db(request)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row

        user = await (await db.execute(
            "SELECT user_id, phone, active, plan, created_at, "
            "mt5_login, mt5_server, drawdown_alert_pct "
            "FROM users WHERE user_id=?", (user_id,)
        )).fetchone()
        if not user:
            raise HTTPException(404, "User not found")

        groups = await (await db.execute(
            "SELECT group_id, group_name, sizing_strategy, management_strategy "
            "FROM user_groups WHERE user_id=? ORDER BY id", (user_id,)
        )).fetchall()

        trades_row = await (await db.execute(
            "SELECT COUNT(*) AS total, "
            "SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) AS wins, "
            "ROUND(SUM(profit), 2) AS total_pnl, "
            "ROUND(AVG(profit), 2) AS avg_pnl "
            "FROM closed_trades WHERE user_id=?", (user_id,)
        )).fetchone()

        ai_row = await (await db.execute(
            "SELECT call_type, COUNT(*) AS calls, "
            "ROUND(SUM(cost_usd), 4) AS cost, SUM(total_tokens) AS tokens "
            "FROM ai_logs WHERE user_id=? GROUP BY call_type", (user_id,)
        )).fetchall()

        signals_row = await (await db.execute(
            "SELECT COUNT(*) AS total, SUM(is_signal) AS signals, "
            "SUM(CASE WHEN error_step IS NOT NULL THEN 1 ELSE 0 END) AS errors "
            "FROM signal_logs WHERE user_id=?", (user_id,)
        )).fetchone()

        recent_trades = await (await db.execute(
            "SELECT ticket, symbol, order_type, lots, profit, close_time "
            "FROM closed_trades WHERE user_id=? ORDER BY close_time DESC LIMIT 20",
            (user_id,)
        )).fetchall()

    return {
        "user": dict(user),
        "groups": [dict(g) for g in groups],
        "trades": {
            "total":    trades_row["total"] or 0,
            "wins":     trades_row["wins"] or 0,
            "total_pnl": trades_row["total_pnl"] or 0.0,
            "avg_pnl":  trades_row["avg_pnl"] or 0.0,
        },
        "ai_by_type": [dict(r) for r in ai_row],
        "signals": {
            "total":   signals_row["total"] or 0,
            "signals": signals_row["signals"] or 0,
            "errors":  signals_row["errors"] or 0,
        },
        "recent_trades": [dict(r) for r in recent_trades],
    }


# ── AI usage ──────────────────────────────────────────────────────────────────

@router.get("/ai")
async def get_ai_stats(
    request: Request,
    days: int = Query(30, ge=1, le=365),
) -> dict[str, Any]:
    _check_auth(request)
    db_path = _db(request)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row

        by_type = await (await db.execute("""
            SELECT call_type, COUNT(*) AS calls,
                   ROUND(SUM(cost_usd), 4) AS cost,
                   SUM(total_tokens) AS tokens,
                   ROUND(AVG(latency_ms)) AS avg_latency_ms,
                   SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors
            FROM ai_logs
            WHERE ts >= datetime('now', ? || ' days')
            GROUP BY call_type
            ORDER BY cost DESC
        """, (f"-{days}",))).fetchall()

        by_model = await (await db.execute("""
            SELECT model, COUNT(*) AS calls,
                   ROUND(SUM(cost_usd), 4) AS cost,
                   SUM(total_tokens) AS tokens
            FROM ai_logs
            WHERE ts >= datetime('now', ? || ' days')
            GROUP BY model
            ORDER BY cost DESC
        """, (f"-{days}",))).fetchall()

        daily = await (await db.execute("""
            SELECT DATE(ts) AS day,
                   COUNT(*) AS calls,
                   ROUND(SUM(cost_usd), 4) AS cost,
                   SUM(total_tokens) AS tokens
            FROM ai_logs
            WHERE ts >= datetime('now', ? || ' days')
            GROUP BY DATE(ts)
            ORDER BY day
        """, (f"-{days}",))).fetchall()

    return {
        "by_type":  [dict(r) for r in by_type],
        "by_model": [dict(r) for r in by_model],
        "daily":    [dict(r) for r in daily],
    }


@router.get("/ai/logs")
async def get_ai_logs(
    request: Request,
    user_id: str | None = Query(None),
    call_type: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    _check_auth(request)
    db_path = _db(request)

    conditions = []
    params: list[Any] = []
    if user_id:
        conditions.append("user_id=?")
        params.append(user_id)
    if call_type:
        conditions.append("call_type=?")
        params.append(call_type)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        total_row = await (await db.execute(
            f"SELECT COUNT(*) AS cnt FROM ai_logs {where}", params
        )).fetchone()
        rows = await (await db.execute(
            f"SELECT id, user_id, ts, call_type, model, prompt_tokens, "
            f"completion_tokens, total_tokens, cost_usd, latency_ms, error, context_json "
            f"FROM ai_logs {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        )).fetchall()

    results = []
    for r in rows:
        d = dict(r)
        if d.get("context_json"):
            try:
                d["context"] = json.loads(d["context_json"])
            except Exception:
                d["context"] = None
        del d["context_json"]
        results.append(d)

    return {"total": total_row["cnt"], "logs": results}


# ── Signal stats ──────────────────────────────────────────────────────────────

@router.get("/signals")
async def get_signal_stats(
    request: Request,
    days: int = Query(30, ge=1, le=365),
) -> dict[str, Any]:
    _check_auth(request)
    db_path = _db(request)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row

        summary = await (await db.execute("""
            SELECT
                COUNT(*) AS messages,
                SUM(is_signal) AS signals,
                SUM(CASE WHEN error_step IS NOT NULL THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN error_step='flash' THEN 1 ELSE 0 END) AS flash_errors,
                SUM(CASE WHEN error_step='extraction' THEN 1 ELSE 0 END) AS extract_errors,
                SUM(CASE WHEN error_step='mt5_execute' THEN 1 ELSE 0 END) AS mt5_errors
            FROM signal_logs
            WHERE ts >= datetime('now', ? || ' days')
        """, (f"-{days}",))).fetchone()

        by_error = await (await db.execute("""
            SELECT error_step, COUNT(*) AS cnt
            FROM signal_logs
            WHERE error_step IS NOT NULL
              AND ts >= datetime('now', ? || ' days')
            GROUP BY error_step
            ORDER BY cnt DESC
        """, (f"-{days}",))).fetchall()

        daily = await (await db.execute("""
            SELECT DATE(ts) AS day,
                   COUNT(*) AS messages,
                   SUM(is_signal) AS signals,
                   SUM(CASE WHEN error_step IS NOT NULL THEN 1 ELSE 0 END) AS errors
            FROM signal_logs
            WHERE ts >= datetime('now', ? || ' days')
            GROUP BY DATE(ts)
            ORDER BY day
        """, (f"-{days}",))).fetchall()

    return {
        "summary":  dict(summary),
        "by_error": [dict(r) for r in by_error],
        "daily":    [dict(r) for r in daily],
    }


@router.get("/signals/logs")
async def get_signal_logs(
    request: Request,
    user_id: str | None = Query(None),
    is_signal: bool | None = Query(None),
    has_error: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    _check_auth(request)
    db_path = _db(request)

    conditions = []
    params: list[Any] = []
    if user_id:
        conditions.append("user_id=?")
        params.append(user_id)
    if is_signal is not None:
        conditions.append("is_signal=?")
        params.append(1 if is_signal else 0)
    if has_error is True:
        conditions.append("error_step IS NOT NULL")
    elif has_error is False:
        conditions.append("error_step IS NULL")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        total_row = await (await db.execute(
            f"SELECT COUNT(*) AS cnt FROM signal_logs {where}", params
        )).fetchone()
        rows = await (await db.execute(
            f"SELECT id, user_id, ts, sender_name, message_text, is_signal, "
            f"flash_raw, has_mt5_creds, sizing_strategy, signals_json, results_json, "
            f"error_step, error_msg, group_name "
            f"FROM signal_logs {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        )).fetchall()

    results = []
    for r in rows:
        d = dict(r)
        for field in ("signals_json", "results_json"):
            if d.get(field):
                try:
                    d[field.replace("_json", "")] = json.loads(d[field])
                except Exception:
                    d[field.replace("_json", "")] = None
            else:
                d[field.replace("_json", "")] = None
            del d[field]
        results.append(d)

    return {"total": total_row["cnt"], "logs": results}


# ── Trades ────────────────────────────────────────────────────────────────────

@router.get("/trades")
async def get_trade_stats(
    request: Request,
    days: int = Query(30, ge=1, le=365),
) -> dict[str, Any]:
    _check_auth(request)
    db_path = _db(request)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row

        summary = await (await db.execute("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END) AS losses,
                ROUND(SUM(profit), 2) AS total_pnl,
                ROUND(AVG(profit), 2) AS avg_pnl,
                ROUND(MAX(profit), 2) AS best_trade,
                ROUND(MIN(profit), 2) AS worst_trade
            FROM closed_trades
            WHERE close_time >= datetime('now', ? || ' days')
        """, (f"-{days}",))).fetchone()

        by_symbol = await (await db.execute("""
            SELECT symbol, COUNT(*) AS total,
                   ROUND(SUM(profit), 2) AS pnl,
                   SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) AS wins
            FROM closed_trades
            WHERE close_time >= datetime('now', ? || ' days')
            GROUP BY symbol
            ORDER BY pnl DESC
            LIMIT 20
        """, (f"-{days}",))).fetchall()

        daily = await (await db.execute("""
            SELECT DATE(close_time) AS day,
                   COUNT(*) AS total,
                   ROUND(SUM(profit), 2) AS pnl
            FROM closed_trades
            WHERE close_time >= datetime('now', ? || ' days')
            GROUP BY DATE(close_time)
            ORDER BY day
        """, (f"-{days}",))).fetchall()

        by_user = await (await db.execute("""
            SELECT ct.user_id, u.phone,
                   COUNT(*) AS total,
                   ROUND(SUM(ct.profit), 2) AS pnl
            FROM closed_trades ct
            LEFT JOIN users u ON u.user_id = ct.user_id
            WHERE ct.close_time >= datetime('now', ? || ' days')
            GROUP BY ct.user_id
            ORDER BY pnl DESC
            LIMIT 20
        """, (f"-{days}",))).fetchall()

    return {
        "summary":   dict(summary),
        "by_symbol": [dict(r) for r in by_symbol],
        "daily":     [dict(r) for r in daily],
        "by_user":   [dict(r) for r in by_user],
    }


# ── Strategy logs ─────────────────────────────────────────────────────────────

@router.get("/strategy/logs")
async def get_strategy_logs(
    request: Request,
    user_id: str | None = Query(None),
    event_type: str | None = Query(None),
    has_error: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    _check_auth(request)
    db_path = _db(request)

    conditions = []
    params: list[Any] = []
    if user_id:
        conditions.append("user_id=?")
        params.append(user_id)
    if event_type:
        conditions.append("event_type=?")
        params.append(event_type)
    if has_error is True:
        conditions.append("error_msg IS NOT NULL")
    elif has_error is False:
        conditions.append("error_msg IS NULL")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        total_row = await (await db.execute(
            f"SELECT COUNT(*) AS cnt FROM strategy_logs {where}", params
        )).fetchone()
        rows = await (await db.execute(
            f"SELECT id, user_id, ts, event_type, management_strategy, "
            f"final_response, error_msg, tool_calls_json "
            f"FROM strategy_logs {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        )).fetchall()

    results = []
    for r in rows:
        d = dict(r)
        if d.get("tool_calls_json"):
            try:
                d["tool_calls"] = json.loads(d["tool_calls_json"])
            except Exception:
                d["tool_calls"] = None
        else:
            d["tool_calls"] = None
        del d["tool_calls_json"]
        results.append(d)

    return {"total": total_row["cnt"], "logs": results}


# ── Revenue ───────────────────────────────────────────────────────────────────

@router.get("/revenue")
async def get_revenue(request: Request) -> dict[str, Any]:
    _check_auth(request)
    db_path = _db(request)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row

        by_plan = await (await db.execute("""
            SELECT plan, COUNT(*) AS users,
                   SUM(active) AS active_users
            FROM users
            GROUP BY plan
            ORDER BY CASE plan
                WHEN 'elite' THEN 1
                WHEN 'pro'   THEN 2
                WHEN 'core'  THEN 3
                ELSE 4
            END
        """)).fetchall()

        recent_subs = await (await db.execute("""
            SELECT user_id, phone, plan, active, created_at
            FROM users
            WHERE plan IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 20
        """)).fetchall()

        monthly_growth = await (await db.execute("""
            SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS new_users
            FROM users
            GROUP BY strftime('%Y-%m', created_at)
            ORDER BY month DESC
            LIMIT 12
        """)).fetchall()

    plans_out = []
    total_mrr = 0.0
    for r in by_plan:
        price = _PLAN_PRICES.get(r["plan"] or "", 0)
        active = r["active_users"] or 0
        mrr = round(price * active, 2)
        total_mrr += mrr
        plans_out.append({**dict(r), "price_usd": price, "mrr_usd": mrr})

    return {
        "total_mrr_usd": round(total_mrr, 2),
        "by_plan": plans_out,
        "recent_subscriptions": [dict(r) for r in recent_subs],
        "monthly_growth": [dict(r) for r in monthly_growth],
    }


# ── Messages browser ──────────────────────────────────────────────────────────

@router.get("/messages/users")
async def get_messages_users(request: Request) -> list[dict[str, Any]]:
    """
    Returns every user that has at least one message in signal_logs or bot_messages,
    with distinct groups and per-direction counts.
    """
    _check_auth(request)
    db_path = _db(request)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row

        users = await (await db.execute("""
            SELECT u.user_id, u.phone,
                   COUNT(DISTINCT sl.id) AS msg_count,
                   COUNT(DISTINCT bm.id) AS bot_msg_count
            FROM users u
            LEFT JOIN signal_logs sl  ON sl.user_id = u.user_id
            LEFT JOIN bot_messages bm ON bm.user_id = u.user_id
            WHERE sl.id IS NOT NULL OR bm.id IS NOT NULL
            GROUP BY u.user_id
            ORDER BY msg_count DESC
        """)).fetchall()

        groups = await (await db.execute("""
            SELECT DISTINCT user_id, group_id, group_name
            FROM signal_logs
            WHERE group_id IS NOT NULL
            ORDER BY user_id, group_name
        """)).fetchall()

    groups_by_user: dict[str, list[dict]] = {}
    for g in groups:
        uid = g["user_id"]
        groups_by_user.setdefault(uid, []).append({
            "group_id": g["group_id"],
            "group_name": g["group_name"],
        })

    return [
        {
            **dict(u),
            "groups": groups_by_user.get(u["user_id"], []),
        }
        for u in users
    ]


@router.get("/messages")
async def get_messages(
    request: Request,
    user_id: str = Query(...),
    group_id: int | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """
    Paginated messages for a given user, optionally filtered by group and
    full-text search on message_text.
    """
    _check_auth(request)
    db_path = _db(request)

    conditions = ["user_id=?"]
    params: list[Any] = [user_id]

    if group_id is not None:
        conditions.append("group_id=?")
        params.append(group_id)
    if search:
        conditions.append("message_text LIKE ?")
        params.append(f"%{search}%")

    where = "WHERE " + " AND ".join(conditions)

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        total_row = await (await db.execute(
            f"SELECT COUNT(*) AS cnt FROM signal_logs {where}", params
        )).fetchone()
        rows = await (await db.execute(
            f"SELECT id, ts, sender_name, message_text, is_signal, "
            f"group_id, group_name, error_step, signals_json, results_json "
            f"FROM signal_logs {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        )).fetchall()

    results = []
    for r in rows:
        d = dict(r)
        for field in ("signals_json", "results_json"):
            raw = d.pop(field, None)
            key = field.replace("_json", "")
            if raw:
                try:
                    d[key] = json.loads(raw)
                except Exception:
                    d[key] = None
            else:
                d[key] = None
        results.append(d)

    return {"total": total_row["cnt"], "messages": results}


@router.get("/messages/bot")
async def get_bot_messages(
    request: Request,
    user_id: str = Query(...),
    message_type: str | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Messaggi inviati dal bot all'utente (notifiche, report, alert)."""
    _check_auth(request)
    db_path = _db(request)

    conditions = ["user_id=?"]
    params: list[Any] = [user_id]
    if message_type:
        conditions.append("message_type=?")
        params.append(message_type)
    if search:
        conditions.append("message_text LIKE ?")
        params.append(f"%{search}%")

    where = "WHERE " + " AND ".join(conditions)

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        total_row = await (await db.execute(
            f"SELECT COUNT(*) AS cnt FROM bot_messages {where}", params
        )).fetchone()
        rows = await (await db.execute(
            f"SELECT id, ts, message_text, message_type "
            f"FROM bot_messages {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        )).fetchall()

    return {"total": total_row["cnt"], "messages": [dict(r) for r in rows]}


@router.get("/messages/telegram-history")
async def get_telegram_history(
    request: Request,
    user_id: str = Query(...),
    group_id: int = Query(...),
    limit: int = Query(500, ge=1, le=5000),
    from_date: str | None = Query(None),   # ISO 8601 date, es. "2024-01-01"
    until_date: str | None = Query(None),  # ISO 8601 date, es. "2024-12-31"
) -> dict[str, Any]:
    """
    Recupera messaggi storici da un gruppo Telegram usando la sessione dell'utente.
    Richiede che l'utente sia attivo nel TelegramManager.
    """
    _check_auth(request)

    tm = request.app.state.telegram_manager

    def _parse_date(s: str) -> datetime:
        # Accetta "YYYY-MM-DD" o ISO full
        try:
            return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, f"Data non valida: {s!r} — usa formato YYYY-MM-DD")

    from_dt    = _parse_date(from_date)   if from_date   else None
    until_dt   = _parse_date(until_date)  if until_date  else None

    loop = asyncio.get_event_loop()
    try:
        messages: list[dict] = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: tm.get_history(
                    user_id=user_id,
                    group_id=group_id,
                    limit=limit,
                    from_date=from_dt,
                    until_date=until_dt,
                ),
            ),
            timeout=180.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Timeout: il recupero storico ha impiegato troppo. Riduci il limite o restringi il periodo.")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Errore Telegram: {exc}")

    return {"total": len(messages), "messages": messages}
