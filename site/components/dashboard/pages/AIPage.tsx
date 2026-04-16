"use client"

import { AILogsPanel } from "@/components/dashboard/AILogsPanel"

export function AIPage({ userId }: { userId: string }) {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">AI & Costi</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Utilizzo dei modelli Gemini, token consumati e costi per chiamata
        </p>
      </div>
      <AILogsPanel userId={userId} />
    </div>
  )
}
