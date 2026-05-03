# Plan Feature Gating — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce Elite-only restrictions on management_strategy, deletion_strategy, trading_hours, eco_calendar, and community across backend routes and the dashboard UI.

**Architecture:** All enforcement imports from the existing `plan_features.py` (backend) and `planFeatures.ts` (frontend) singletons. Backend: add `require_feature` checks in `dashboard.py` PATCH and community routes + `has_feature` guards in `app.py` runtime loop. Frontend: add `UpgradeGate` wrappers per tab in `RoomCard`, an upgrade wall in `CommunityPage`, and skip API calls for non-elite users.

**Tech Stack:** FastAPI (Python), Next.js/React (TypeScript), Tailwind CSS, Lucide icons.

---

## File map

| Action | Path |
|---|---|
| Modify | `server/vps/api/routes/dashboard.py` |
| Modify | `server/vps/api/app.py` |
| Modify | `site/src/app/dashboard/rooms/page.tsx` |
| Modify | `site/src/app/dashboard/community/page.tsx` |

---

## Task 1 — Gate Phase 2 fields in `dashboard.py`

**Files:**
- Modify: `server/vps/api/routes/dashboard.py:231-240` (update_user_group)
- Modify: `server/vps/api/routes/dashboard.py:1026-1290` (community routes × 6)

Context: `from vps.api.plan_features import require_feature, channel_limit, has_feature` is already at line 31. No new import needed.

---

- [ ] **Step 1: Add Phase 2 field guards in `update_user_group`**

Open `server/vps/api/routes/dashboard.py`. Find the `update_user_group` function (line 217). Currently the body starts:

```python
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    # Core plan: non può impostare min_confidence > 0. ...
    if body.min_confidence is not None and body.min_confidence > 0:
        if not has_feature(current_user.get("plan"), "confidence_threshold"):
            body = body.model_copy(update={"min_confidence": 0})
    store = request.app.state.user_store
```

Replace the block from the ownership check through the store line with:

```python
    if user_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    # Core plan: non può impostare min_confidence > 0.
    if body.min_confidence is not None and body.min_confidence > 0:
        if not has_feature(current_user.get("plan"), "confidence_threshold"):
            body = body.model_copy(update={"min_confidence": 0})
    # Elite-only fields: block activation for non-elite users.
    if body.management_strategy is not None and body.management_strategy.strip():
        require_feature(current_user, "management_strategy")
    if body.deletion_strategy is not None and body.deletion_strategy.strip():
        require_feature(current_user, "deletion_strategy")
    if body.trading_hours_enabled is True:
        require_feature(current_user, "trading_hours")
    if body.eco_calendar_enabled is True:
        require_feature(current_user, "eco_calendar")
    store = request.app.state.user_store
```

- [ ] **Step 2: Gate `list_community_groups` (line 1026)**

Find the function `list_community_groups`. Its body starts with:

```python
    user_id = current_user["user_id"]
    store              = request.app.state.user_store
```

Insert `require_feature(current_user, "community")` as the very first line:

```python
    require_feature(current_user, "community")
    user_id = current_user["user_id"]
    store              = request.app.state.user_store
```

- [ ] **Step 3: Gate `get_community_group_detail` (line 1080)**

Its body starts with:

```python
    user_id = current_user["user_id"]
    store              = request.app.state.user_store
```

Replace with:

```python
    require_feature(current_user, "community")
    user_id = current_user["user_id"]
    store              = request.app.state.user_store
```

- [ ] **Step 4: Gate `follow_community_group` (line 1125)**

Read lines 1125–1135. Find the first line of the function body (after the docstring) and insert `require_feature(current_user, "community")` as the first line.

- [ ] **Step 5: Gate `unfollow_community_group` (line 1171)**

Read lines 1171–1185. Find the first line of the function body and insert `require_feature(current_user, "community")` as the first line.

- [ ] **Step 6: Gate `list_community_follows` (line 1231)**

Read lines 1231–1245. Find the first line of the function body and insert `require_feature(current_user, "community")` as the first line.

- [ ] **Step 7: Gate `update_community_follow_settings` (line 1281)**

Read lines 1281–1295. Find the first line of the function body and insert `require_feature(current_user, "community")` as the first line.

- [ ] **Step 8: Verify the file parses**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "import ast, pathlib; ast.parse(pathlib.Path('vps/api/routes/dashboard.py').read_text()); print('AST OK')"
```

Expected: `AST OK`

- [ ] **Step 9: Commit**

```bash
git add server/vps/api/routes/dashboard.py
git commit -m "feat: gate Phase 2 elite fields in update_user_group; gate all community routes"
```

---

## Task 2 — `app.py` runtime safety for Phase 2 features

**Files:**
- Modify: `server/vps/api/app.py:642` (trading_hours)
- Modify: `server/vps/api/app.py:659` (eco_calendar)
- Modify: `server/vps/api/app.py:763` (management_strategy)
- Modify: `server/vps/api/app.py:1033` (deletion_strategy)

Context: `from vps.api.plan_features import has_feature` is already imported (added in Phase 1). No new import needed.

---

- [ ] **Step 1: Wrap trading_hours check (line 642)**

Find this line (around line 642):

```python
        if group_settings and group_settings.get("trading_hours_enabled"):
```

Replace with:

```python
        if group_settings and group_settings.get("trading_hours_enabled") and has_feature(user.get("plan"), "trading_hours"):
```

- [ ] **Step 2: Wrap eco_calendar check (line 659)**

Find:

```python
        if group_settings and group_settings.get("eco_calendar_enabled"):
```

Replace with:

```python
        if group_settings and group_settings.get("eco_calendar_enabled") and has_feature(user.get("plan"), "eco_calendar"):
```

- [ ] **Step 3: Wrap management_strategy execution (line 763)**

Find:

```python
        if strategy_executor and management_strategy:
```

Replace with:

```python
        if strategy_executor and management_strategy and has_feature(user.get("plan"), "management_strategy"):
```

- [ ] **Step 4: Wrap deletion_strategy execution (line 1033)**

Find:

```python
            deletion_strategy = (del_group_settings or {}).get("deletion_strategy") or ""
            if not deletion_strategy.strip():
```

Replace with:

```python
            deletion_strategy = (del_group_settings or {}).get("deletion_strategy") or ""
            if not deletion_strategy.strip() or not has_feature(user.get("plan"), "deletion_strategy"):
```

- [ ] **Step 5: Verify the file parses**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "import ast, pathlib; ast.parse(pathlib.Path('vps/api/app.py').read_text()); print('AST OK')"
```

Expected: `AST OK`

- [ ] **Step 6: Commit**

```bash
git add server/vps/api/app.py
git commit -m "fix: skip Phase 2 elite features at runtime for non-elite users"
```

---

## Task 3 — `rooms/page.tsx` — UpgradeGate per tab + plan prop

**Files:**
- Modify: `site/src/app/dashboard/rooms/page.tsx`

Context: `UpgradeGate` is at `site/src/components/dashboard/UpgradeGate.tsx`. `hasPlanFeature` is at `site/src/lib/planFeatures.ts`. The file imports `useDashboard`, `api`, `UserGroup`, `TrustScore`, etc. at the top.

The `RoomCard` component starts at line 49. `RoomsPage` (the exported page component) starts at line 595.

---

- [ ] **Step 1: Add imports**

At the top of the file, the existing imports block ends with the lucide-react import. Add two lines after the `useDashboard` import:

```typescript
import { hasPlanFeature } from "@/src/lib/planFeatures"
import { UpgradeGate } from "@/src/components/dashboard/UpgradeGate"
```

- [ ] **Step 2: Fix `getTrustScores` call in `RoomsPage`**

In `RoomsPage` (around line 603), find:

```typescript
    api.getTrustScores(user.user_id).then(res => {
      const map: Record<number, TrustScore> = {}
      for (const s of res.scores) map[s.group_id] = s
      setTrustScores(map)
    }).catch(() => {})
```

Replace with:

```typescript
    if (hasPlanFeature(user.plan, "trust_scores")) {
      api.getTrustScores(user.user_id).then(res => {
        const map: Record<number, TrustScore> = {}
        for (const s of res.scores) map[s.group_id] = s
        setTrustScores(map)
      }).catch(() => {})
    }
```

- [ ] **Step 3: Pass `plan` prop to `RoomCard` in `RoomsPage`**

In `RoomsPage`, find the `<RoomCard` element (around line 630):

```tsx
        <RoomCard
          key={group.group_id}
          group={group}
          userId={user.user_id}
          trustScore={trustScores[group.group_id] ?? null}
          canRemove={groups.length > 1}
          onUpdate={updateGroup}
          onRemove={() => removeGroup(group.group_id)}
        />
```

Replace with:

```tsx
        <RoomCard
          key={group.group_id}
          group={group}
          userId={user.user_id}
          plan={user.plan}
          trustScore={trustScores[group.group_id] ?? null}
          canRemove={groups.length > 1}
          onUpdate={updateGroup}
          onRemove={() => removeGroup(group.group_id)}
        />
```

- [ ] **Step 4: Add `plan` prop to `RoomCard` function signature**

Find the `RoomCard` function (line 49):

```typescript
function RoomCard({
  group, userId, trustScore, canRemove, onUpdate, onRemove,
}: {
  group: UserGroup
  userId: string
  trustScore: TrustScore | null
  canRemove: boolean
  onUpdate: (updated: UserGroup) => void
  onRemove: () => void
}) {
```

Replace with:

```typescript
function RoomCard({
  group, userId, plan, trustScore, canRemove, onUpdate, onRemove,
}: {
  group: UserGroup
  userId: string
  plan: string | null
  trustScore: TrustScore | null
  canRemove: boolean
  onUpdate: (updated: UserGroup) => void
  onRemove: () => void
}) {
```

- [ ] **Step 5: Add `isTabGated` derived value inside `RoomCard`**

Inside `RoomCard`, after the existing state declarations (after `const [err, setErr] = useState...`), add:

```typescript
  const isTabGated =
    (tab === "filters"   && !hasPlanFeature(plan, "trading_hours")) ||
    (tab === "community" && !hasPlanFeature(plan, "community"))
```

- [ ] **Step 6: Wrap management_strategy + deletion_strategy with `UpgradeGate`**

Inside the strategy tab section (around lines 217-238), find:

```tsx
                <div>
                  <label className={labelCls}>Management strategy</label>
                  <textarea
                    rows={3}
                    value={mgmt}
                    onChange={e => setMgmt(e.target.value)}
                    placeholder="e.g. Move SL to breakeven after 20 pips profit…"
                    className={inputCls}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className={labelCls}>Message deletion strategy</label>
                  <textarea
                    rows={2}
                    value={deletion}
                    onChange={e => setDeletion(e.target.value)}
                    placeholder="e.g. If original signal is deleted, close the position…"
                    className={inputCls}
                    style={inputStyle}
                  />
                </div>
```

Wrap it:

```tsx
                <UpgradeGate feature="management_strategy" plan={plan}>
                  <div className="space-y-5">
                    <div>
                      <label className={labelCls}>Management strategy</label>
                      <textarea
                        rows={3}
                        value={mgmt}
                        onChange={e => setMgmt(e.target.value)}
                        placeholder="e.g. Move SL to breakeven after 20 pips profit…"
                        className={inputCls}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Message deletion strategy</label>
                      <textarea
                        rows={2}
                        value={deletion}
                        onChange={e => setDeletion(e.target.value)}
                        placeholder="e.g. If original signal is deleted, close the position…"
                        className={inputCls}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </UpgradeGate>
```

- [ ] **Step 7: Wrap the entire filters tab content with `UpgradeGate`**

Find the filters tab (around line 290):

```tsx
            {tab === "filters" && (
              <>
                {/* Trading hours */}
                ...
                {/* Economic calendar */}
                ...
              </>
            )}
```

Replace with:

```tsx
            {tab === "filters" && (
              <UpgradeGate feature="trading_hours" plan={plan}>
                <>
                  {/* Trading hours */}
                  ...existing trading hours JSX unchanged...
                  {/* Economic calendar */}
                  ...existing eco calendar JSX unchanged...
                </>
              </UpgradeGate>
            )}
```

The inner JSX content is unchanged — only the `UpgradeGate` wrapper is added around the existing `<>...</>` fragment.

- [ ] **Step 8: Wrap the entire community tab content with `UpgradeGate`**

Find the community tab (around line 385):

```tsx
            {tab === "community" && (
              <div className="space-y-4">
                ...
              </div>
            )}
```

Replace with:

```tsx
            {tab === "community" && (
              <UpgradeGate feature="community" plan={plan}>
                <div className="space-y-4">
                  ...existing community JSX unchanged...
                </div>
              </UpgradeGate>
            )}
```

- [ ] **Step 9: Hide Save button when current tab is fully gated**

Find the Save button (around line 448):

```tsx
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-black disabled:opacity-40 transition-all"
                style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
              >
                {saving
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : saved ? <Check className="w-4 h-4" /> : null
                }
                {saving ? "Saving…" : saved ? "Saved!" : "Save changes"}
              </button>
```

Replace with:

```tsx
              {!isTabGated && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-black disabled:opacity-40 transition-all"
                  style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
                >
                  {saving
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : saved ? <Check className="w-4 h-4" /> : null
                  }
                  {saving ? "Saving…" : saved ? "Saved!" : "Save changes"}
                </button>
              )}
```

- [ ] **Step 10: Verify TypeScript**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/site
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 11: Commit**

```bash
git add site/src/app/dashboard/rooms/page.tsx
git commit -m "feat: gate management_strategy, deletion_strategy, trading_hours, eco_calendar, community in RoomCard by plan"
```

---

## Task 4 — `community/page.tsx` — upgrade wall for non-elite

**Files:**
- Modify: `site/src/app/dashboard/community/page.tsx`

Context: The page uses `useDashboard()` to get `user`. The main `load()` function calls `api.listCommunityGroups()`. `loadFollows()` calls `api.listCommunityFollows()`. Both are called via `useEffect`. The main `return (` is at line 368.

---

- [ ] **Step 1: Add imports**

Add to the existing imports at the top of the file:

```typescript
import { hasPlanFeature } from "@/src/lib/planFeatures"
import { Lock } from "lucide-react"
```

(`Lock` should be added to the existing lucide-react import block.)

- [ ] **Step 2: Guard `load` and `loadFollows` callbacks**

Find `loadFollows` (line 335):

```typescript
  const loadFollows = useCallback(async () => {
    if (!user?.user_id) return
    setFollowsLoading(true)
```

Replace with:

```typescript
  const loadFollows = useCallback(async () => {
    if (!user?.user_id || !hasPlanFeature(user.plan ?? null, "community")) return
    setFollowsLoading(true)
```

Find `load` (line 345):

```typescript
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listCommunityGroups()
```

Replace with:

```typescript
  const load = useCallback(async () => {
    if (!hasPlanFeature(user?.plan ?? null, "community")) return
    setLoading(true)
    try {
      const res = await api.listCommunityGroups()
```

Also update the `useCallback` dependency arrays to include `user?.plan`:

```typescript
  }, [user?.user_id, user?.plan])      // loadFollows
  }, [user?.user_id, selected, user?.plan])  // load
```

- [ ] **Step 3: Add upgrade wall before `return (`**

Find `return (` at line 368. Insert the upgrade wall immediately before it:

```tsx
  if (!hasPlanFeature(user?.plan ?? null, "community")) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Lock className="w-6 h-6 text-amber-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Community requires Elite</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Browse and follow signal rooms from other Elite traders, or share your own
            room&apos;s performance on the leaderboard. Available on the Elite plan.
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

  return (
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/site
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add site/src/app/dashboard/community/page.tsx
git commit -m "feat: upgrade wall for non-elite users on Community page"
```

---

## Final verification

- [ ] **Step 1: Backend — full AST parse check**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/server
python -c "
import ast, pathlib
for f in ['vps/api/routes/dashboard.py', 'vps/api/app.py']:
    ast.parse(pathlib.Path(f).read_text())
    print(f'OK {f}')
print('All backend files OK')
"
```

Expected: both lines print `OK`, then `All backend files OK`.

- [ ] **Step 2: Frontend — full TypeScript check**

```bash
cd /Users/alessioantonucci/Downloads/telegram_mt5_bot/site
npx tsc --noEmit 2>&1
```

Expected: zero errors.
