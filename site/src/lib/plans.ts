/** Single source of truth for plan prices. Update here and everywhere else picks it up. */
export const PLAN_PRICES = {
  core:  "€39",
  pro:   "€89",
  elite: "€149",
} as const

export type PlanKey = keyof typeof PLAN_PRICES
