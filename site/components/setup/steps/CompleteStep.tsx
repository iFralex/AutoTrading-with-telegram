"use client"

import { useState } from "react"
import {
  CheckCircle2, Bot, Hash, TrendingUp, ArrowRight, RotateCcw, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ErrorAlert } from "../ErrorAlert"
import { api, ApiError } from "@/lib/api"
import type { StepProps } from "../SetupWizard"

export function CompleteStep({ data, onBack }: StepProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const items = [
    {
      icon: Bot,
      label: "App Telegram",
      value: `API ID: ${data.apiId}`,
    },
    {
      icon: Hash,
      label: "Gruppo selezionato",
      value: data.groupName,
    },
    {
      icon: TrendingUp,
      label: "Conto MetaTrader 5",
      value: data.mt5AccountName
        ? `${data.mt5AccountName} · ${data.mt5Server}`
        : `${data.mt5Login} · ${data.mt5Server}`,
    },
  ]

  async function handleStart() {
    setLoading(true)
    setError(null)
    try {
      await api.completeSetup({
        login_key:    data.loginKey,
        user_id:      data.userId,
        api_id:       Number(data.apiId),
        api_hash:     data.apiHash,
        phone:        data.phone,
        group_id:     data.groupId,
        group_name:   data.groupName,
        mt5_login:    data.mt5Login ? Number(data.mt5Login) : undefined,
        mt5_password: data.mt5Password || undefined,
        mt5_server:   data.mt5Server || undefined,
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore imprevisto. Riprova.")
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <Card>
        <CardContent className="pt-10 pb-8 px-8 flex flex-col items-center gap-5 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/25">
            <CheckCircle2 className="size-8 text-emerald-400" strokeWidth={1.5} />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-foreground">Bot attivo!</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
              Il bot sta ascoltando i segnali su{" "}
              <strong className="text-foreground">{data.groupName}</strong> ed
              eseguirà le operazioni automaticamente.
            </p>
          </div>
          <div className="w-full rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-4">
            <p className="text-xs text-muted-foreground">
              Puoi chiudere questa pagina. Il bot continuerà a girare
              indipendentemente sul server.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="pt-8 pb-8 px-8 flex flex-col items-center gap-6">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
          <CheckCircle2 className="size-8 text-primary" strokeWidth={1.5} />
        </div>

        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-foreground">
            Configurazione completata
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
            Verifica il riepilogo e avvia il bot. Inizierà subito ad ascoltare
            i segnali e ad aprire le operazioni.
          </p>
        </div>

        {/* Riepilogo */}
        <div className="w-full rounded-xl border border-white/[0.07] overflow-hidden">
          {items.map(({ icon: Icon, label, value }, i) => (
            <div key={label}>
              {i > 0 && <Separator className="bg-white/[0.07]" />}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-medium text-foreground truncate">{value}</p>
                </div>
                <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
              </div>
            </div>
          ))}
        </div>

        {error && <ErrorAlert message={error} className="w-full" />}

        <div className="w-full space-y-2">
          <Button
            size="lg"
            className="w-full gap-2"
            onClick={handleStart}
            disabled={loading}
          >
            {loading
              ? <><Loader2 className="size-4 animate-spin" />Avvio in corso...</>
              : <><ArrowRight className="size-4" />Avvia il Bot</>
            }
          </Button>
          <Button
            variant="ghost"
            onClick={onBack}
            disabled={loading}
            className="w-full gap-2 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-4" />
            Modifica configurazione
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
