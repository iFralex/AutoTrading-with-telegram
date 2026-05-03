# Plan Feature Gating — Phase 2 (Elite-only features)

## Context

Continuation of Phase 1 (see `2026-05-03-plan-feature-gating-phase1-design.md`). Phase 1 restricted
Pro+ features from Core users. Phase 2 gates Elite-only features: `management_strategy`,
`deletion_strategy`, `trading_hours`, `eco_calendar`, `community`.

The definitions for all five feature keys are already present in `plan_features.py` and
`planFeatures.ts` (added in Phase 1). No changes to those files are needed.

The setup wizard (`SetupWizard.tsx` / `setup.py`) is **out of scope** — all features remain
fully configurable during initial setup regardless of plan. Enforcement applies only in the
ongoing dashboard and at runtime in `app.py`.

---

## Feature → Plan mapping (Phase 2 only)

| Feature | Core | Pro | Elite |
|---|---|---|---|
| AI management strategy (`management_strategy`) | ❌ | ❌ | ✅ |
| Signal deletion strategy (`deletion_strategy`) | ❌ | ❌ | ✅ |
| Trading hours filter (`trading_hours_*`) | ❌ | ❌ | ✅ |
| Economic calendar filter (`eco_calendar_*`) | ❌ | ❌ | ✅ |
| Community (browse, follow, share) | ❌ | ❌ | ✅ |

---

## Architecture

Same single-source-of-truth pattern as Phase 1. All enforcement imports from
`plan_features.py` (backend) or `planFeatures.ts` (frontend). No business logic scattered
in route handlers.

**Approach: per-tab gating (Approach B)**  
One `UpgradeGate` per tab in `RoomCard` (Strategy / Filters / Community), not per individual
field. All fields within each tab are elite-only, so coarser gating is appropriate and produces
cleaner UI.

---

## Files changed

| Action | Path |
|---|---|
| Modify | `server/vps/api/routes/dashboard.py` |
| Modify | `server/vps/api/app.py` |
| Modify | `site/src/app/dashboard/rooms/page.tsx` |
| Modify | `site/src/app/dashboard/community/page.tsx` |

---

## Backend changes

### 1. `server/vps/api/routes/dashboard.py`

#### PATCH `/user/{user_id}/groups/{group_id}` — `update_user_group`

Add four checks after the existing `min_confidence` check (around line 231). Block only when
*activating* a feature (non-null/non-empty/True). Clearing or disabling is always allowed so
users doing a plan downgrade are not blocked from saving other fields.

```python
if body.management_strategy is not None and body.management_strategy.strip():
    require_feature(current_user, "management_strategy")
if body.deletion_strategy is not None and body.deletion_strategy.strip():
    require_feature(current_user, "deletion_strategy")
if body.trading_hours_enabled is True:
    require_feature(current_user, "trading_hours")
if body.eco_calendar_enabled is True:
    require_feature(current_user, "eco_calendar")
```

The existing import `from vps.api.plan_features import require_feature, channel_limit` already
covers `require_feature` — no new import needed.

#### Community routes — 6 endpoints

Add `require_feature(current_user, "community")` as the first line of each:

| Endpoint | Function |
|---|---|
| `GET /community/groups` | `list_community_groups` |
| `GET /community/groups/{token}` | `get_community_group_detail` |
| `POST /community/groups/{token}/follow` | `follow_community_group` |
| `DELETE /community/groups/{token}/follow` | `unfollow_community_group` |
| `GET /user/{user_id}/community-follows` | `list_community_follows` |
| `PATCH /user/{user_id}/community-follows/{token}` | `update_community_follow_settings` |

### 2. `server/vps/api/app.py` — Runtime safety

Same silent-skip pattern used for `min_confidence` in Phase 1. Users who configured these
features before the plan gating was introduced are silently unaffected — the feature is skipped
at runtime rather than erroring.

Add import (already present if Phase 1 landed): `from vps.api.plan_features import has_feature`

Four wraps:

```python
# trading_hours (around line 639)
# Before: if group_settings and group_settings.get("trading_hours_enabled"):
# After:
if group_settings and group_settings.get("trading_hours_enabled") and has_feature(user.get("plan"), "trading_hours"):

# eco_calendar (around line 656)
# Before: if group_settings and group_settings.get("eco_calendar_enabled"):
# After:
if group_settings and group_settings.get("eco_calendar_enabled") and has_feature(user.get("plan"), "eco_calendar"):

# management_strategy execution (around line 760)
# Before: if strategy_executor and management_strategy:
# After:
if strategy_executor and management_strategy and has_feature(user.get("plan"), "management_strategy"):

# deletion_strategy execution (around line 1030)
# Before: if not deletion_strategy.strip():
# The entire deletion handling block at ~1029 is already inside a broader `if deletion_strategy`
# check — wrap that outer condition:
# Before: deletion_strategy = (del_group_settings or {}).get("deletion_strategy") or ""
#         if not deletion_strategy.strip():
#             ...
# After: add a has_feature guard around the block that uses deletion_strategy
```

For deletion_strategy specifically, the guard should be placed around the section that reads and
applies `deletion_strategy` (~line 1029), not inside the empty-check. The exact form:

```python
deletion_strategy = (del_group_settings or {}).get("deletion_strategy") or ""
if not deletion_strategy.strip() or not has_feature(user.get("plan"), "deletion_strategy"):
    # log skip and return
    ...
```

---

## Frontend changes

### 3. `site/src/app/dashboard/rooms/page.tsx`

#### Imports to add

```typescript
import { hasPlanFeature } from "@/src/lib/planFeatures"
import { UpgradeGate } from "@/src/components/dashboard/UpgradeGate"
```

#### `RoomsPage` — skip trust scores for Core

```typescript
// Before:
api.getTrustScores(user.user_id).then(res => { ... }).catch(() => {})

// After:
if (hasPlanFeature(user.plan, "trust_scores")) {
  api.getTrustScores(user.user_id).then(res => { ... }).catch(() => {})
}
```

#### `RoomsPage` — pass `plan` to `RoomCard`

```tsx
<RoomCard
  ...
  plan={user.plan}
/>
```

#### `RoomCard` — add `plan` prop to signature

```typescript
function RoomCard({
  group, userId, plan, trustScore, canRemove, onUpdate, onRemove,
}: {
  ...
  plan: string | null
  ...
}) {
```

#### `RoomCard` — derive `isTabGated` and hide Save when gated

```typescript
const isTabGated =
  (tab === "strategy"  && !hasPlanFeature(plan, "management_strategy")) ||
  (tab === "filters"   && !hasPlanFeature(plan, "trading_hours"))        ||
  (tab === "community" && !hasPlanFeature(plan, "community"))
```

Save button: render only when `!isTabGated`.

#### `RoomCard` — wrap tab content with UpgradeGate

Strategy tab (management_strategy + deletion_strategy fields):
```tsx
<UpgradeGate feature="management_strategy" plan={plan}>
  {/* existing strategy tab JSX */}
</UpgradeGate>
```

Filters tab (trading_hours + eco_calendar fields):
```tsx
<UpgradeGate feature="trading_hours" plan={plan}>
  {/* existing filters tab JSX */}
</UpgradeGate>
```

Community tab:
```tsx
<UpgradeGate feature="community" plan={plan}>
  {/* existing community tab JSX */}
</UpgradeGate>
```

### 4. `site/src/app/dashboard/community/page.tsx`

Add import: `hasPlanFeature` from `@/src/lib/planFeatures`, `Lock` from `lucide-react`,
`useDashboard` (already imported).

Before the main page `return`, add upgrade wall:

```tsx
if (!hasPlanFeature(user.plan, "community")) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
        <Lock className="w-6 h-6 text-amber-400" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Community requires Elite</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Browse and follow signal rooms from other Elite traders, or share your own room's
          performance. Available on the Elite plan.
        </p>
      </div>
      <a
        href="/settings"
        className="px-4 py-2 text-sm font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 rounded-lg transition-colors"
      >
        View plans → Settings
      </a>
    </div>
  )
}
```

Skip the data-loading API call(s) for non-elite users (return early before they execute).

---

## What does NOT change

- `plan_features.py` — Phase 2 keys already defined
- `planFeatures.ts` — Phase 2 keys already defined
- `UpgradeGate.tsx` — no changes
- `setup.py` / `SetupWizard.tsx` — fully unlocked, out of scope
- Existing DB data — no migration; `app.py` runtime guards silently skip elite features
  for non-elite users without touching stored values
- Phase 1 enforcement (backtesting, trust scores, confidence threshold, PDF reports,
  channel limits) — untouched
