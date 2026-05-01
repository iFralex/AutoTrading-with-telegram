"use client"

import { useState } from "react"
import { StatsSection } from "@/src/components/dashboard/StatsSection"
import { type UserGroup } from "@/src/lib/api"

export function AnalyticsPage({ userId, groups }: { userId: string; groups: UserGroup[] }) {
  const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>(undefined)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-white">Statistics</h1>
          <p className="text-sm text-white/40 mt-0.5">
            Signal analysis, trading performance and time distribution
          </p>
        </div>

        {/* Group filter */}
        {groups.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setSelectedGroupId(undefined)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                selectedGroupId === undefined
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "text-white/40 border-white/[0.08] hover:bg-white/[0.04] hover:text-white/70"
              }`}
            >
              All groups
            </button>
            {groups.map(g => (
              <button
                key={g.group_id}
                onClick={() => setSelectedGroupId(g.group_id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors max-w-[180px] truncate ${
                  selectedGroupId === g.group_id
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "text-white/40 border-white/[0.08] hover:bg-white/[0.04] hover:text-white/70"
                }`}
                title={g.group_name}
              >
                {g.group_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <StatsSection userId={userId} groupId={selectedGroupId} />
    </div>
  )
}
