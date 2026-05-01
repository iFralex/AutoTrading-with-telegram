"use client"

import { useDashboard } from "@/src/components/dashboard/DashboardContext"
import { ManualOrderPage } from "@/src/components/dashboard/pages/ManualOrderPage"
import { Loader2 } from "lucide-react"

export default function OrdersPage() {
  const { user, loading } = useDashboard()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full pb-16">
        <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
      </div>
    )
  }

  if (!user) return null

  return <ManualOrderPage userId={user.user_id} />
}
