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
