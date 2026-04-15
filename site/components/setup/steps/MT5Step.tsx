"use client"

import { useState } from "react"
import {
  Eye, EyeOff, HelpCircle, ChevronDown, ChevronUp,
  Loader2, CheckCircle2, AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ErrorAlert } from "../ErrorAlert"
import { api, ApiError, type MT5Account } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { StepProps } from "../SetupWizard"

export function MT5Step({ data, onDataChange, onNext, onBack }: StepProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verified, setVerified] = useState<MT5Account | null>(null)
  // mt5Unavailable = true se il server risponde 503 (non è su Windows)
  const [mt5Unavailable, setMt5Unavailable] = useState(false)

  const allFilled =
    data.mt5Login.trim() !== "" &&
    data.mt5Password !== "" &&
    data.mt5Server.trim() !== ""

  function handleChange(partial: Partial<typeof data>) {
    onDataChange(partial)
    setVerified(null)
    setError(null)
    setMt5Unavailable(false)
  }

  async function handleVerify() {
    setLoading(true)
    setError(null)
    setVerified(null)
    setMt5Unavailable(false)
    try {
      const res = await api.verifyMt5(
        Number(data.mt5Login),
        data.mt5Password,
        data.mt5Server,
        data.phone || undefined
      )
      setVerified(res.account)
      onDataChange({ mt5AccountName: res.account.name })
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setMt5Unavailable(true)
      } else {
        setError(err instanceof ApiError ? err.message : "Errore imprevisto")
      }
    } finally {
      setLoading(false)
    }
  }

  // Può procedere se verificato OPPURE se il server non ha MT5 (bypass)
  const canContinue = verified !== null || mt5Unavailable

  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            5
          </div>
          <div>
            <CardTitle>Credenziali MetaTrader 5</CardTitle>
            <CardDescription className="mt-0.5">
              Inserisci i dati di accesso al tuo conto MT5
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="mt5Login">Numero conto</Label>
          <Input
            id="mt5Login"
            type="number"
            placeholder="12345678"
            value={data.mt5Login}
            onChange={e => handleChange({ mt5Login: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="mt5Password">Password</Label>
          <div className="relative">
            <Input
              id="mt5Password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={data.mt5Password}
              onChange={e => handleChange({ mt5Password: e.target.value })}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? "Nascondi" : "Mostra"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="mt5Server">Nome server</Label>
            <button
              onClick={() => setShowHelp(v => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <HelpCircle className="size-3" />
              Dove lo trovo?
              {showHelp ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>
          </div>

          {showHelp && (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3 text-xs text-muted-foreground space-y-1.5 step-enter">
              <p>
                Apri MetaTrader 5 →{" "}
                <strong className="text-foreground">File</strong> →{" "}
                <strong className="text-foreground">Accesso al conto</strong>.
              </p>
              <p>
                Il nome del server è visibile nella lista (es:{" "}
                <code className="font-mono text-primary bg-primary/10 px-1 rounded">
                  ICMarkets-Live01
                </code>
                ).
              </p>
            </div>
          )}

          <Input
            id="mt5Server"
            placeholder="ICMarkets-Live01"
            value={data.mt5Server}
            onChange={e => handleChange({ mt5Server: e.target.value })}
            className="font-mono"
          />
        </div>

        {/* Feedback verifica ─────────────────────────────────────────────── */}

        {verified && (
          <div className="flex items-start gap-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/20 p-3 step-enter">
            <CheckCircle2 className="size-4 text-emerald-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-emerald-300">Conto verificato</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                {verified.name} · {verified.server} ·{" "}
                {verified.balance.toLocaleString("it-IT", {
                  style: "currency",
                  currency: verified.currency,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          </div>
        )}

        {mt5Unavailable && (
          <div className={cn(
            "flex items-start gap-2.5 rounded-xl p-3 step-enter",
            "bg-amber-500/8 border border-amber-500/20"
          )}>
            <AlertTriangle className="size-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-300/90 space-y-1">
              <p className="font-medium text-amber-300">Verifica non disponibile</p>
              <p>
                MetaTrader 5 non è installato sul server. Le credenziali verranno
                salvate ma la verifica avverrà al primo avvio su Windows.
              </p>
            </div>
          </div>
        )}

        {error && <ErrorAlert message={error} />}

        {/* Bottone verifica ──────────────────────────────────────────────── */}
        {!verified && !mt5Unavailable && (
          <Button
            variant="outline"
            onClick={handleVerify}
            disabled={!allFilled || loading}
            className="w-full gap-2"
          >
            {loading
              ? <><Loader2 className="size-4 animate-spin" />Verifica in corso...</>
              : "Verifica credenziali MT5"
            }
          </Button>
        )}

        <div className="flex gap-3 pt-1">
          <Button variant="outline" onClick={onBack} disabled={loading} className="flex-1">
            Indietro
          </Button>
          <Button
            onClick={onNext}
            disabled={!canContinue || loading}
            className="flex-1"
          >
            Continua
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
