# Plan Feature Gating — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict Pro+ and Elite-only features from Core plan users, with a monthly backtest credit system (Pro: 5 credits, Elite: 25 credits; AI run = 3 credits, standard run = 1 credit).

**Architecture:** A single `plan_features.py` (backend) and `planFeatures.ts` (frontend) are the sole sources of truth for feature→plan mapping. All enforcement points import from these two files. No business logic is scattered in route handlers.

**Tech Stack:** FastAPI (Python), Next.js/React (TypeScript), SQLite via aiosqlite, Tailwind CSS, Lucide icons.

---

## File map

| Action | Path |
|---|---|
| Create | `server/vps/api/plan_features.py` |
| Modify | `server/vps/services/backtest_store.py` |
| Modify | `server/vps/api/routes/backtest.py` |
| Modify | `server/vps/api/routes/dashboard.py` |
| Modify | `server/vps/api/app.py` |
| Modify | `server/vps/api/routes/setup.py` |
| Create | `site/src/lib/planFeatures.ts` |
| Create | `site/src/components/dashboard/UpgradeGate.tsx` |
| Modify | `site/src/lib/api.ts` |
| Modify | `site/src/components/dashboard/pages/SettingsPage.tsx` |
| Modify | `site/src/components/dashboard/pages/BacktestPage.tsx` |

---

## Task 1 — Backend source of truth: `plan_features.py`

**Files:**
- Create: `server/vps/api/plan_features.py`

- [ ] **Step 1: Create the file**

```python
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
    return _tier(plan) >= PLAN_TIER.get(min_plan, 2)


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
```

- [ ] **Step 2: Verify the file parses**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "from vps.api.plan_features import has_feature, require_feature, channel_limit, backtest_credit_limit; print('OK')"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/vps/api/plan_features.py
git commit -m "feat: add plan_features module — feature→plan source of truth"
```

---

## Task 2 — Backtest credit counter in `backtest_store.py`

**Files:**
- Modify: `server/vps/services/backtest_store.py`

The table already has `use_ai INTEGER` and `started_at TEXT` (ISO-8601). No schema migration needed.

- [ ] **Step 1: Add `count_credits_this_month` after the `list_runs` method**

Open `server/vps/services/backtest_store.py`. Find the `list_runs` method (around line 297–320) and add the following method immediately after it:

```python
    async def count_credits_this_month(self, user_id: str) -> int:
        """Sum of backtest credits consumed in the current calendar month.

        AI runs cost 3 credits; standard runs cost 1 credit.
        Counts all run statuses (running / completed / failed / cancelled)
        so deleting old runs does not game the monthly quota.
        """
        async with aiosqlite.connect(self._db_path) as db:
            cur = await db.execute(
                """
                SELECT COALESCE(
                    SUM(CASE WHEN use_ai = 1 THEN 3 ELSE 1 END), 0
                )
                FROM backtest_runs
                WHERE user_id = ?
                  AND strftime('%Y-%m', started_at) = strftime('%Y-%m', 'now')
                """,
                (user_id,),
            )
            row = await cur.fetchone()
            return int(row[0])
```

- [ ] **Step 2: Verify it parses**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "from vps.services.backtest_store import BacktestStore; print('OK')"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/vps/services/backtest_store.py
git commit -m "feat: add count_credits_this_month to BacktestStore"
```

---

## Task 3 — Gate backtest routes + credit enforcement

**Files:**
- Modify: `server/vps/api/routes/backtest.py`

- [ ] **Step 1: Add import at top of file**

In `server/vps/api/routes/backtest.py`, add to the existing imports block:

```python
from vps.api.plan_features import (
    require_feature, backtest_credit_limit,
    BACKTEST_AI_WEIGHT, BACKTEST_STD_WEIGHT,
)
```

- [ ] **Step 2: Gate `POST /run` — plan check + credit check**

In the `start_backtest` function, immediately after the ownership check (`if body.user_id != current_user["user_id"]`), add:

```python
    # Plan + credit gate
    require_feature(current_user, "backtesting")
    plan        = (current_user.get("plan") or "").lower()
    limit       = backtest_credit_limit(plan)
    credits_used = await bt_store.count_credits_this_month(body.user_id)
    cost        = BACKTEST_AI_WEIGHT if body.use_ai else BACKTEST_STD_WEIGHT
    if credits_used + cost > limit:
        raise HTTPException(
            403,
            detail=(
                f"Monthly backtest credits exhausted "
                f"({credits_used}/{limit} used). Resets at the start of next month."
            ),
        )
```

Note: `bt_store` is already assigned a few lines below in the original function. Move the `bt_store` assignment up before this block so it's available. The relevant lines to reorder (original lines ~51-56):

```python
    bt_engine = getattr(request.app.state, "backtest_engine", None)
    bt_store  = getattr(request.app.state, "backtest_store",  None)
    user_store = request.app.state.user_store

    if bt_engine is None or bt_store is None:
        raise HTTPException(503, "BacktestEngine non disponibile")

    # Plan + credit gate
    require_feature(current_user, "backtesting")
    plan         = (current_user.get("plan") or "").lower()
    limit        = backtest_credit_limit(plan)
    credits_used = await bt_store.count_credits_this_month(body.user_id)
    cost         = BACKTEST_AI_WEIGHT if body.use_ai else BACKTEST_STD_WEIGHT
    if credits_used + cost > limit:
        raise HTTPException(
            403,
            detail=(
                f"Monthly backtest credits exhausted "
                f"({credits_used}/{limit} used). Resets at the start of next month."
            ),
        )
```

- [ ] **Step 3: Gate `GET /list` and return credit info**

Replace the body of `list_backtests`:

```python
@router.get("/list")
async def list_backtests(current_user: dict = Depends(get_current_user), request: Request = None):
    """Lista di tutti i run per l'utente, dal più recente al più vecchio."""
    require_feature(current_user, "backtesting")
    user_id  = current_user["user_id"]
    bt_store = getattr(request.app.state, "backtest_store", None)
    if bt_store is None:
        raise HTTPException(503, "BacktestStore non disponibile")
    runs         = await bt_store.list_runs(user_id)
    credits_used = await bt_store.count_credits_this_month(user_id)
    limit        = backtest_credit_limit(current_user.get("plan"))
    return {"runs": runs, "total": len(runs), "credits_used": credits_used, "credits_limit": limit}
```

- [ ] **Step 4: Gate `GET /{run_id}`, `GET /{run_id}/trades`, `POST /{run_id}/cancel`, `DELETE /{run_id}`**

Add `require_feature(current_user, "backtesting")` as the first line of each of these four route functions, before any other logic.

`get_backtest` (around line 141):
```python
async def get_backtest(run_id: str, current_user: dict = Depends(get_current_user), request: Request = None):
    require_feature(current_user, "backtesting")
    # ... rest unchanged
```

`get_backtest_trades` (the trades endpoint):
```python
async def get_backtest_trades(...):
    require_feature(current_user, "backtesting")
    # ... rest unchanged
```

`cancel_backtest`:
```python
async def cancel_backtest(...):
    require_feature(current_user, "backtesting")
    # ... rest unchanged
```

`delete_backtest`:
```python
async def delete_backtest(...):
    require_feature(current_user, "backtesting")
    # ... rest unchanged
```

- [ ] **Step 5: Verify the module parses**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "from vps.api.routes.backtest import router; print('OK')"
```
Expected output: `OK`

- [ ] **Step 6: Commit**

```bash
git add server/vps/api/routes/backtest.py
git commit -m "feat: gate all backtest routes by plan; enforce monthly credit limit"
```

---

## Task 4 — Gate dashboard routes

**Files:**
- Modify: `server/vps/api/routes/dashboard.py`

- [ ] **Step 1: Add import**

Add to the existing imports in `server/vps/api/routes/dashboard.py`:

```python
from vps.api.plan_features import require_feature, channel_limit
```

- [ ] **Step 2: Gate `GET /trust-scores`**

In `get_trust_scores` (around line 352), add as the first line of the function body (after `current_user` is available):

```python
    require_feature(current_user, "trust_scores")
```

- [ ] **Step 3: Gate `POST /user/{user_id}/generate-report`**

In `generate_report` (around line 877), add after the ownership check:

```python
    require_feature(current_user, "pdf_reports")
```

- [ ] **Step 4: Gate `GET /user/{user_id}/reports`**

In `list_saved_reports` (around line 937), add after the ownership check:

```python
    require_feature(current_user, "pdf_reports")
```

- [ ] **Step 5: Enforce channel limit in `POST /user/{user_id}/groups`**

In `add_user_group` (around line 169), add after the ownership check and before `store.upsert_user_group`:

```python
    plan  = (current_user.get("plan") or "").lower()
    limit = channel_limit(plan)
    if limit is not None:
        existing_groups = await store.get_user_groups(user_id)
        if len(existing_groups) >= limit:
            raise HTTPException(
                403,
                detail=f"Your plan allows a maximum of {limit} channel(s). Upgrade to add more.",
            )
```

- [ ] **Step 6: Block setting `min_confidence > 0` for Core in `PATCH /user/{user_id}/groups/{group_id}`**

In `update_user_group` (around line 207), add after the ownership check, before `store.update_user_group_settings`:

```python
    plan = (current_user.get("plan") or "").lower()
    if body.min_confidence is not None and body.min_confidence > 0:
        require_feature(current_user, "confidence_threshold")
```

- [ ] **Step 7: Verify the module parses**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "from vps.api.routes.dashboard import router; print('OK')"
```
Expected output: `OK`

- [ ] **Step 8: Commit**

```bash
git add server/vps/api/routes/dashboard.py
git commit -m "feat: gate trust scores, PDF reports, channel add limit, confidence threshold by plan"
```

---

## Task 5 — Runtime safety in `app.py` for `min_confidence`

**Files:**
- Modify: `server/vps/api/app.py`

This protects users who had `min_confidence` set before gating was introduced. The filter is silently skipped for Core users rather than erroring.

- [ ] **Step 1: Add import**

Near the top of `server/vps/api/app.py` in the imports section, add:

```python
from vps.api.plan_features import has_feature
```

- [ ] **Step 2: Wrap the confidence filter (around line 742)**

Find this block:

```python
        # ── Step 4.5: filtro confidenza AI ────────────────────────────────────
        min_confidence = int((group_settings or {}).get("min_confidence") or 0)
        if min_confidence > 0:
```

Replace with:

```python
        # ── Step 4.5: filtro confidenza AI (solo Pro+) ───────────────────────
        min_confidence = int((group_settings or {}).get("min_confidence") or 0)
        if min_confidence > 0 and has_feature(user.get("plan"), "confidence_threshold"):
```

No other changes — the rest of the block stays identical.

- [ ] **Step 3: Verify the module parses**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "import vps.api.app; print('OK')"
```
Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
git add server/vps/api/app.py
git commit -m "fix: skip min_confidence filter for Core plan users at runtime"
```

---

## Task 6 — Setup wizard safety for `min_confidence`

**Files:**
- Modify: `server/vps/api/routes/setup.py`

Prevents Core users from accidentally persisting a non-zero `min_confidence` via the setup wizard.

- [ ] **Step 1: Add import**

In `server/vps/api/routes/setup.py`, add to the imports block:

```python
from vps.api.plan_features import has_feature
```

- [ ] **Step 2: Zero out `min_confidence` for Core in `save_config`**

Find the `save_config` step (around line 1444), specifically the `upsert_user_group` call (around line 1445). Add the following immediately before that call:

```python
        # Force min_confidence to 0 for Core plan users
        if not has_feature(body.plan, "confidence_threshold"):
            body = body.model_copy(update={"min_confidence": 0})
```

- [ ] **Step 3: Verify the module parses**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "from vps.api.routes.setup import router; print('OK')"
```
Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
git add server/vps/api/routes/setup.py
git commit -m "fix: zero out min_confidence for Core plan during setup wizard save"
```

---

## Task 7 — Frontend source of truth: `planFeatures.ts`

**Files:**
- Create: `site/src/lib/planFeatures.ts`

- [ ] **Step 1: Create the file**

```typescript
// site/src/lib/planFeatures.ts
// Mirror of server/vps/api/plan_features.py — keep in sync manually.

export const PLAN_TIER: Record<string, number> = { core: 0, pro: 1, elite: 2 }

export const CHANNEL_LIMITS: Record<string, number | null> = {
  core: 1, pro: 5, elite: null,
}

export const BACKTEST_MONTHLY_LIMITS: Record<string, number> = {
  core: 0, pro: 5, elite: 25,
}
export const BACKTEST_AI_WEIGHT  = 3
export const BACKTEST_STD_WEIGHT = 1

// Minimum plan required per feature key.
export const FEATURE_MIN_PLAN: Record<string, string> = {
  // Phase 1
  confidence_threshold: "pro",
  backtesting:          "pro",
  pdf_reports:          "pro",
  trust_scores:         "pro",
  // Phase 2 (defined now, enforced in UI later)
  management_strategy:  "elite",
  deletion_strategy:    "elite",
  trading_hours:        "elite",
  eco_calendar:         "elite",
  community:            "elite",
}

function tier(plan: string | null): number {
  return PLAN_TIER[(plan ?? "").toLowerCase()] ?? 0
}

export function hasPlanFeature(plan: string | null, feature: string): boolean {
  const minPlan = FEATURE_MIN_PLAN[feature] ?? "elite"
  return tier(plan) >= (PLAN_TIER[minPlan] ?? 2)
}

export function channelLimit(plan: string | null): number | null {
  return CHANNEL_LIMITS[(plan ?? "").toLowerCase()] ?? 1
}

export function backtestCreditLimit(plan: string | null): number {
  return BACKTEST_MONTHLY_LIMITS[(plan ?? "").toLowerCase()] ?? 0
}

/** Human-readable label for the minimum plan required by a feature. */
export function requiredPlanLabel(feature: string): string {
  const p = FEATURE_MIN_PLAN[feature] ?? "Elite"
  return p.charAt(0).toUpperCase() + p.slice(1)
}
```

- [ ] **Step 2: Verify it compiles (TypeScript check)**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/site
npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```
Expected: no errors related to `planFeatures.ts`.

- [ ] **Step 3: Commit**

```bash
git add site/src/lib/planFeatures.ts
git commit -m "feat: add planFeatures.ts — frontend feature→plan source of truth"
```

---

## Task 8 — `UpgradeGate` component

**Files:**
- Create: `site/src/components/dashboard/UpgradeGate.tsx`

- [ ] **Step 1: Create the component**

```tsx
// site/src/components/dashboard/UpgradeGate.tsx
"use client"

import { Lock } from "lucide-react"
import { hasPlanFeature, requiredPlanLabel } from "@/src/lib/planFeatures"

/**
 * Wraps children with a lock overlay when the user's plan does not include
 * the requested feature. Children are rendered (not unmounted) so the layout
 * is preserved and the user can see what they are missing.
 */
export function UpgradeGate({
  feature,
  plan,
  children,
}: {
  feature: string
  plan: string | null
  children: React.ReactNode
}) {
  if (hasPlanFeature(plan, feature)) return <>{children}</>

  const label = requiredPlanLabel(feature)

  return (
    <div className="relative rounded-lg">
      <div className="opacity-40 pointer-events-none select-none">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center rounded-lg">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg text-xs font-medium text-white/80">
          <Lock className="w-3 h-3 shrink-0" />
          <span>{label} plan</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/site
npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add site/src/components/dashboard/UpgradeGate.tsx
git commit -m "feat: add UpgradeGate component for plan-locked UI sections"
```

---

## Task 9 — Update `api.ts` for backtest credits

**Files:**
- Modify: `site/src/lib/api.ts`

- [ ] **Step 1: Update `listBacktests` return type**

Find the `listBacktests` method (around line 1221):

```typescript
  listBacktests(userId: string) {
    return callAuth<{ runs: BacktestRun[]; total: number }>(
      "GET",
      `/api/backtest/list?user_id=${encodeURIComponent(userId)}`
    )
  },
```

Replace with:

```typescript
  listBacktests(userId: string) {
    return callAuth<{
      runs: BacktestRun[]
      total: number
      credits_used:  number
      credits_limit: number
    }>("GET", `/api/backtest/list?user_id=${encodeURIComponent(userId)}`)
  },
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/site
npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add site/src/lib/api.ts
git commit -m "feat: add credits_used / credits_limit to listBacktests response type"
```

---

## Task 10 — `SettingsPage.tsx` — gate confidence, trust score, add-group

**Files:**
- Modify: `site/src/components/dashboard/pages/SettingsPage.tsx`

- [ ] **Step 1: Add imports**

At the top of `SettingsPage.tsx`, add to the existing imports:

```typescript
import { UpgradeGate } from "@/src/components/dashboard/UpgradeGate"
import { hasPlanFeature, channelLimit } from "@/src/lib/planFeatures"
```

- [ ] **Step 2: Skip `getTrustScores` for Core users**

In the `SettingsPage` component, the `useEffect` that calls `api.getTrustScores` starts at line ~33. Replace:

```typescript
  useEffect(() => {
    api.getTrustScores(user.user_id)
      .then(res => {
        const map: Record<number, TrustScore> = {}
        for (const s of res.scores) map[s.group_id] = s
        setTrustScores(map)
      })
      .catch(() => {})
```

With:

```typescript
  useEffect(() => {
    if (hasPlanFeature(user.plan, "trust_scores")) {
      api.getTrustScores(user.user_id)
        .then(res => {
          const map: Record<number, TrustScore> = {}
          for (const s of res.scores) map[s.group_id] = s
          setTrustScores(map)
        })
        .catch(() => {})
    }
```

- [ ] **Step 3: Pass `plan` to `GroupCard` and lock `AddGroupCard`**

Find the group list render section (around line 112–132):

```tsx
      <div className="space-y-4">
        {user.groups.map(group => (
          <GroupCard
            key={group.group_id}
            group={group}
            userId={user.user_id}
            trustScore={trustScores[group.group_id] ?? null}
            onUpdate={updateGroup}
            onRemove={() => removeGroup(group.group_id)}
            canRemove={user.groups.length > 1}
            otherGroups={user.groups.filter(g => g.group_id !== group.group_id)}
          />
        ))}

        {/* Aggiungi nuovo gruppo */}
        <AddGroupCard
          userId={user.user_id}
          onAdded={addGroup}
        />
      </div>
```

Replace with:

```tsx
      <div className="space-y-4">
        {user.groups.map(group => (
          <GroupCard
            key={group.group_id}
            group={group}
            userId={user.user_id}
            plan={user.plan}
            trustScore={trustScores[group.group_id] ?? null}
            onUpdate={updateGroup}
            onRemove={() => removeGroup(group.group_id)}
            canRemove={user.groups.length > 1}
            otherGroups={user.groups.filter(g => g.group_id !== group.group_id)}
          />
        ))}

        {/* Aggiungi nuovo gruppo */}
        {(() => {
          const limit = channelLimit(user.plan)
          const atLimit = limit !== null && user.groups.length >= limit
          return atLimit ? (
            <UpgradeGate feature="backtesting" plan={user.plan}>
              <div className="flex items-center gap-3 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] opacity-60">
                <Plus className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Add channel ({user.groups.length}/{limit} used)
                </span>
              </div>
            </UpgradeGate>
          ) : (
            <AddGroupCard userId={user.user_id} onAdded={addGroup} />
          )
        })()}
      </div>
```

Note: `Plus` is already imported in this file.

- [ ] **Step 4: Add `plan` prop to `GroupCard` function signature**

Find the `GroupCard` function definition (around line 347):

```typescript
function GroupCard({
  group,
  userId,
  trustScore,
  onUpdate,
  onRemove,
  canRemove,
  otherGroups,
}: {
  group: UserGroup
  userId: string
  trustScore: TrustScore | null
  onUpdate: (g: UserGroup) => void
  onRemove: () => void
  canRemove: boolean
  otherGroups: UserGroup[]
}) {
```

Replace with:

```typescript
function GroupCard({
  group,
  userId,
  plan,
  trustScore,
  onUpdate,
  onRemove,
  canRemove,
  otherGroups,
}: {
  group: UserGroup
  userId: string
  plan: string | null
  trustScore: TrustScore | null
  onUpdate: (g: UserGroup) => void
  onRemove: () => void
  canRemove: boolean
  otherGroups: UserGroup[]
}) {
```

- [ ] **Step 5: Wrap `TrustScoreTag` in `GroupCard` with `UpgradeGate`**

Inside `GroupCard`, find where `TrustScoreTag` is rendered (around line 437):

```tsx
            <TrustScoreTag score={trustScore} />
```

Replace with:

```tsx
            <UpgradeGate feature="trust_scores" plan={plan}>
              <TrustScoreTag score={trustScore} />
            </UpgradeGate>
```

- [ ] **Step 6: Wrap `ConfidenceField` row with `UpgradeGate`**

Find the `GroupSettingRow` for "Soglia confidenza AI" (around line 625):

```tsx
          <GroupSettingRow title="Soglia confidenza AI" badge="filtro"
            description="Scarta i segnali con confidenza di estrazione inferiore alla soglia (0 = accetta tutto)">
            <ConfidenceField
              value={group.min_confidence ?? 0}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, { min_confidence: v })
                patch({ min_confidence: v })
              }}
            />
          </GroupSettingRow>
```

Replace with:

```tsx
          <UpgradeGate feature="confidence_threshold" plan={plan}>
            <GroupSettingRow title="Soglia confidenza AI" badge="filtro"
              description="Scarta i segnali con confidenza di estrazione inferiore alla soglia (0 = accetta tutto)">
              <ConfidenceField
                value={group.min_confidence ?? 0}
                onSave={async v => {
                  await api.updateUserGroup(userId, group.group_id, { min_confidence: v })
                  patch({ min_confidence: v })
                }}
              />
            </GroupSettingRow>
          </UpgradeGate>
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/site
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add site/src/components/dashboard/pages/SettingsPage.tsx
git commit -m "feat: gate confidence threshold, trust score, and channel add by plan in SettingsPage"
```

---

## Task 11 — `BacktestPage.tsx` — upgrade wall for Core, credit meter for Pro/Elite

**Files:**
- Modify: `site/src/components/dashboard/pages/BacktestPage.tsx`

- [ ] **Step 1: Add imports**

Add to the existing imports at the top of `BacktestPage.tsx`:

```typescript
import { hasPlanFeature, backtestCreditLimit, BACKTEST_AI_WEIGHT, BACKTEST_STD_WEIGHT } from "@/src/lib/planFeatures"
import { Lock } from "lucide-react"
```

(`Lock` may already be imported — check and skip if so.)

- [ ] **Step 2: Add `creditsUsed` / `creditsLimit` state to `BacktestPage`**

In `BacktestPage` (around line 1242), add two state variables after the existing state declarations:

```typescript
  const [creditsUsed,  setCreditsUsed]  = useState<number>(0)
  const [creditsLimit, setCreditsLimit] = useState<number>(backtestCreditLimit(user.plan))
```

- [ ] **Step 3: Populate credits from `loadRuns`**

Update `loadRuns` (around line 1250) to capture the credits fields:

```typescript
  const loadRuns = useCallback(async () => {
    try {
      const r = await api.listBacktests(userId)
      setRuns(r.runs)
      setCreditsUsed(r.credits_used ?? 0)
      setCreditsLimit(r.credits_limit ?? backtestCreditLimit(user.plan))
    } catch { /* ignore */ }
    finally { setLR(false) }
  }, [userId, user.plan])
```

- [ ] **Step 4: Add upgrade wall before the return statement**

In `BacktestPage`, just before `return (` at line 1299, insert:

```tsx
  if (!hasPlanFeature(user.plan, "backtesting")) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
        <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center">
          <Lock className="w-6 h-6 text-indigo-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Backtesting requires Pro or Elite</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Run historical simulations on your signal channels, get full analytics
            and monthly PDF reports. Available from the Pro plan.
          </p>
        </div>
        <a
          href="/settings"
          className="px-4 py-2 text-sm font-medium bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 rounded-lg transition-colors"
        >
          View plans → Settings
        </a>
      </div>
    )
  }
```

- [ ] **Step 5: Add credit meter in the left column, above `RunForm`**

Inside the left column `<div className="space-y-4">` (line 1313), add the credit meter immediately before the `<RunForm` at line 1314:

```tsx
        <div className="space-y-4">
          {/* Credit meter */}
          {creditsLimit > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs text-muted-foreground">
              <div className="flex-1">
                <span className="font-medium text-foreground">{creditsUsed}</span>
                <span> / {creditsLimit} credits used this month</span>
              </div>
              <div className="w-32 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    creditsUsed >= creditsLimit ? "bg-red-500" : "bg-indigo-500"
                  }`}
                  style={{ width: `${Math.min(100, (creditsUsed / creditsLimit) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground/60">resets monthly</span>
            </div>
          )}

          <RunForm
            user={user}
            onStarted={handleStarted}
            disabled={runs.some(r => r.status.startsWith("running"))}
            creditsUsed={creditsUsed}
            creditsLimit={creditsLimit}
          />
```

- [ ] **Step 6: Update `RunForm` props and add cost hint + disable submit**

**Update `RunForm` function signature** at line 127 from:

```typescript
function RunForm({ user, onStarted, disabled }: {
  user: DashboardUser
  onStarted: (runId: string) => void
  disabled?: boolean
}) {
```

To:

```typescript
function RunForm({ user, onStarted, disabled, creditsUsed, creditsLimit }: {
  user: DashboardUser
  onStarted: (runId: string) => void
  disabled?: boolean
  creditsUsed: number
  creditsLimit: number
}) {
```

**Add cost hint** between the AI toggle block (ends at line 283) and the starting balance block (starts at line 285). Insert after line 283:

```tsx
      {/* Credit cost hint */}
      {creditsLimit > 0 && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${
          creditsUsed + (useAi ? BACKTEST_AI_WEIGHT : BACKTEST_STD_WEIGHT) > creditsLimit
            ? "bg-red-600/8 border-red-500/20 text-red-400"
            : "bg-white/[0.03] border-white/[0.06] text-muted-foreground"
        }`}>
          This run costs{" "}
          <span className="font-medium text-foreground">
            {useAi ? BACKTEST_AI_WEIGHT : BACKTEST_STD_WEIGHT} credit{useAi ? "s" : ""}
          </span>{" "}
          ({creditsUsed + (useAi ? BACKTEST_AI_WEIGHT : BACKTEST_STD_WEIGHT) > creditsLimit
            ? "not enough credits — upgrade or wait for monthly reset"
            : `${creditsLimit - creditsUsed} remaining`})
        </div>
      )}
```

**Derive `cannotAfford`** before the `return` inside `RunForm` (after line 143 where `err` state is declared):

```typescript
  const cannotAfford =
    creditsLimit > 0 &&
    creditsUsed + (useAi ? BACKTEST_AI_WEIGHT : BACKTEST_STD_WEIGHT) > creditsLimit
```

**Update the submit button** at line 308 from `disabled={loading || disabled}` to:

```tsx
        disabled={loading || disabled || cannotAfford}
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/site
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add site/src/components/dashboard/pages/BacktestPage.tsx
git commit -m "feat: upgrade wall for Core plan in BacktestPage; credit meter for Pro/Elite"
```

---

## Final verification

- [ ] **Step 1: Backend — import chain check**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "
from vps.api.plan_features import has_feature, require_feature, channel_limit, backtest_credit_limit
from vps.api.routes.backtest import router as bt
from vps.api.routes.dashboard import router as dash
from vps.api.routes.setup import router as setup
import vps.api.app
print('All backend imports OK')
"
```
Expected: `All backend imports OK`

- [ ] **Step 2: Frontend — full TypeScript check**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/site
npx tsc --noEmit 2>&1
```
Expected: zero errors.

- [ ] **Step 3: Final commit**

```bash
git add -A
git status  # confirm only expected files
git commit -m "feat: Phase 1 plan feature gating — Core restrictions complete"
```
