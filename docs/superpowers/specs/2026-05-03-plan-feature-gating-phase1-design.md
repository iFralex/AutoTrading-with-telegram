# Plan Feature Gating — Phase 1 (Core restrictions)

## Context

Three subscription plans: Core (€39), Pro (€89), Elite (€149). Previously all features were
available regardless of plan. This spec covers Phase 1: restricting Pro+ features from Core
users. Phase 2 (Elite-only features) is defined in `plan_features.py` but not enforced yet.

---

## Feature → Plan mapping

| Feature | Core | Pro | Elite |
|---|---|---|---|
| AI confidence threshold (`min_confidence`) | ❌ | ✅ | ✅ |
| Backtesting + PDF reports | ❌ | ✅ (5 credits/mo) | ✅ (25 credits/mo) |
| Trust Score | ❌ | ✅ | ✅ |
| Multiple channels | 1 max | 5 max | unlimited |
| AI management strategy *(Phase 2)* | ❌ | ❌ | ✅ |
| Signal deletion strategy *(Phase 2)* | ❌ | ❌ | ✅ |
| Trading hours filter *(Phase 2)* | ❌ | ❌ | ✅ |
| Economic calendar *(Phase 2)* | ❌ | ❌ | ✅ |
| Community *(Phase 2)* | ❌ | ❌ | ✅ |

### Backtest credit system

- Pro: **5 credits/month**, Elite: **25 credits/month**
- Non-AI run: costs **1 credit**; AI run: costs **3 credits**
- Resets at start of each calendar month
- All historical runs remain visible regardless of current credit balance
- All runs (running/completed/failed/cancelled) count against monthly credits

---

## Architecture

### Single source of truth: two mirrored files

| File | Role |
|---|---|
| `server/vps/api/plan_features.py` *(new)* | Backend: feature → min plan, channel limits, backtest credit limits |
| `site/src/lib/planFeatures.ts` *(new)* | Frontend: exact mirror for UI gating |

Both files define Phase 1 AND Phase 2 features. Phase 2 routes are not gated yet — only the
definitions live here so Phase 2 requires zero changes to these files.

---

## Backend changes

### 1. `server/vps/api/plan_features.py` (new)

```python
PLAN_TIER = {"core": 0, "pro": 1, "elite": 2}
CHANNEL_LIMITS = {"core": 1, "pro": 5, "elite": None}
BACKTEST_MONTHLY_LIMITS = {"core": 0, "pro": 5, "elite": 25}  # credits/month
BACKTEST_AI_WEIGHT = 3   # AI run costs 3 credits
BACKTEST_STD_WEIGHT = 1

FEATURE_MIN_PLAN = {
    # Phase 1
    "confidence_threshold": "pro",
    "backtesting":          "pro",
    "pdf_reports":          "pro",
    "trust_scores":         "pro",
    # Phase 2 (defined now, enforced later)
    "management_strategy":  "elite",
    "deletion_strategy":    "elite",
    "trading_hours":        "elite",
    "eco_calendar":         "elite",
    "community":            "elite",
}

def has_feature(plan: str | None, feature: str) -> bool
def require_feature(user: dict, feature: str) -> None   # raises HTTPException 403
def channel_limit(plan: str | None) -> int | None
def backtest_credit_limit(plan: str | None) -> int      # 0 = blocked
```

### 2. `server/vps/services/backtest_store.py`

Add one method:

```python
async def count_credits_this_month(self, user_id: str) -> int:
    """Sum of credits used in current calendar month (AI=3, non-AI=1)."""
    # SELECT COALESCE(SUM(CASE WHEN use_ai=1 THEN 3 ELSE 1 END), 0)
    # FROM backtest_runs
    # WHERE user_id=? AND strftime('%Y-%m', started_at) = strftime('%Y-%m', 'now')
```

### 3. `server/vps/api/routes/backtest.py`

- All routes: `require_feature(current_user, "backtesting")` at top
- `POST /run` only: after feature check, load credit limit and count credits used this month;
  calculate cost of new run (1 or 3); raise 403 if `used + cost > limit`
- `GET /list`: add `credits_used` and `credits_limit` fields to response so frontend can
  display remaining credits without a separate API call

### 4. `server/vps/api/routes/dashboard.py`

| Endpoint | Change |
|---|---|
| `GET /trust-scores` | `require_feature(current_user, "trust_scores")` |
| `POST /user/{id}/generate-report` | `require_feature(current_user, "pdf_reports")` |
| `GET /user/{id}/reports` | `require_feature(current_user, "pdf_reports")` |
| `POST /user/{id}/groups` | Enforce `channel_limit(plan)`: count existing groups, raise 403 if at limit |
| `PATCH /user/{id}/groups/{gid}` | If Core and `min_confidence > 0` in body → raise 403 |

### 5. `server/vps/api/app.py` — runtime safety

At line 742 (confidence filter), wrap with `has_feature(user.get("plan"), "confidence_threshold")`.
Core users with `min_confidence > 0` in DB (pre-gating data) are silently unaffected — the
filter is skipped, not errored.

### 6. `server/vps/api/routes/setup.py` — setup wizard safety

In the `save_config` step (line ~1455), if `body.plan == "core"`: force `min_confidence = 0`
before `upsert_user_group`.

---

## Frontend changes

### 7. `site/src/lib/planFeatures.ts` (new)

```typescript
export const PLAN_TIER = { core: 0, pro: 1, elite: 2 } as const
export const CHANNEL_LIMITS: Record<string, number | null> = { core: 1, pro: 5, elite: null }
export const BACKTEST_MONTHLY_LIMITS: Record<string, number> = { core: 0, pro: 5, elite: 25 }
export const BACKTEST_AI_WEIGHT = 3

export function hasPlanFeature(plan: string | null, feature: string): boolean
export function channelLimit(plan: string | null): number | null
export function backtestCreditLimit(plan: string | null): number
```

### 8. `site/src/components/dashboard/UpgradeGate.tsx` (new)

Reusable wrapper component:
- Props: `feature: string`, `plan: string | null`, `requiredPlan?: string` (display label),
  `children: ReactNode`
- If plan has feature: render children normally
- If plan lacks feature: render children with `opacity-40 pointer-events-none select-none`
  + overlay with lock icon + plan badge (e.g. "Pro") + "Upgrade" link to `/billing`
- Does not unmount children (preserves layout, shows users what they're missing)

### 9. `site/src/components/dashboard/pages/SettingsPage.tsx`

- Pass `plan` down to `GroupCard` component
- Wrap `ConfidenceField` row with `<UpgradeGate feature="confidence_threshold" plan={plan}>`
- Wrap `TrustScoreTag` display with `<UpgradeGate feature="trust_scores" plan={plan}>`
- Skip `api.getTrustScores()` call if Core (avoid unnecessary 403)
- In `GroupCard` header: show channel count badge (e.g. "1/1" for Core, "2/5" for Pro)
- `AddGroupCard`: if Core user already has 1 group, show disabled/locked add button with upgrade
  prompt instead of opening the group picker

### 10. `site/src/components/dashboard/pages/BacktestPage.tsx`

- If Core: replace entire page content with an upgrade card (no form rendered at all)
- If Pro/Elite: show backtest form + credit meter:
  - "X / Y credits used this month"
  - Inline hint: "AI run costs 3 credits, standard run costs 1"
  - Submit button disabled with tooltip if insufficient credits

---

## What does NOT change

- Existing DB data is not cleared or migrated
- `sizing_strategy`, `extraction_instructions`, `range_entry_pct`, `entry_if_favorable`
  remain freely configurable for all plans (Core included)
- Phase 2 features (`management_strategy`, `deletion_strategy`, `trading_hours`,
  `eco_calendar`, `community`) enforcement is deferred — only their definitions exist in
  `plan_features.py` and `planFeatures.ts`
- `app.py` trading hours / eco_calendar / management_strategy execution paths are untouched
