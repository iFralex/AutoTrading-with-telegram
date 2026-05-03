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
