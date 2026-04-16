"use client"

import { StatsSection } from "@/components/dashboard/StatsSection"

export function AnalyticsPage({ userId }: { userId: string }) {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Statistiche</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Analisi segnali, performance di trading e distribuzione temporale
        </p>
      </div>
      <StatsSection userId={userId} />
    </div>
  )
}
