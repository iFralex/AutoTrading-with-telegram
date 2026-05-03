# server/vps/api/plan_features.py
from __future__ import annotations
from fastapi import HTTPException

PLAN_TIER: dict[str, int] = {"core": 0, "pro": 1, "elite": 2}

CHANNEL_LIMITS: dict[str, int | None] = {"core": 1, "pro": 5, "elite": None}

# Monthly backtest credit limits (0 = feature blocked for that plan).
# Non-AI run costs BACKTEST_STD_WEIGHT credits; AI run costs BACKTEST_AI_WEIGHT.
BACKTEST_MONTHLY_LIMITS: dict[str, int] = {"core": 0, "pro": 5, "elite": 25}
BACKTEST_AI_WEIGHT  = 3
BACKTEST_STD_WEIGHT = 1

# Minimum plan required per feature.
# Phase 2 features (management_strategy … community) are DEFINED here but not yet
# enforced in routes — add enforce calls there when Phase 2 begins.
FEATURE_MIN_PLAN: dict[str, str] = {
    # Phase 1 — Pro+ features
    "confidence_threshold": "pro",
    "backtesting":          "pro",
    "pdf_reports":          "pro",
    "trust_scores":         "pro",
    # Phase 2 — Elite-only (defined now, enforced later)
    "management_strategy":  "elite",
    "deletion_strategy":    "elite",
    "trading_hours":        "elite",
    "eco_calendar":         "elite",
    "community":            "elite",
}


def _tier(plan: str | None) -> int:
    return PLAN_TIER.get((plan or "").lower(), 0)


def has_feature(plan: str | None, feature: str) -> bool:
    min_plan = FEATURE_MIN_PLAN.get(feature, "elite")
    return _tier(plan) >= PLAN_TIER[min_plan]


def require_feature(user: dict, feature: str) -> None:
    """Raise HTTP 403 if the user's plan does not include *feature*."""
    plan = (user.get("plan") or "").lower()
    if not has_feature(plan, feature):
        min_plan = FEATURE_MIN_PLAN.get(feature, "elite").capitalize()
        raise HTTPException(403, detail=f"Requires {min_plan} plan or higher.")


def channel_limit(plan: str | None) -> int | None:
    """Return max channels for the plan, or None for unlimited."""
    return CHANNEL_LIMITS.get((plan or "").lower(), 1)


def backtest_credit_limit(plan: str | None) -> int:
    """Return monthly backtest credits for the plan (0 = feature not available)."""
    return BACKTEST_MONTHLY_LIMITS.get((plan or "").lower(), 0)
