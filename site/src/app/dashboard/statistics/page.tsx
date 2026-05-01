"use client"

import { useDashboard } from "@/src/components/dashboard/DashboardContext"
import { AnalyticsPage } from "@/src/components/dashboard/pages/AnalyticsPage"
import { Loader2 } from "lucide-react"

export default function StatisticsPage() {
  const { user, loading } = useDashboard()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full pb-16">
        <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
      </div>
    )
  }

  if (!user) return null

  return <AnalyticsPage userId={user.user_id} groups={user.groups} />
}
