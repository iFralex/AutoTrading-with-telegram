"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Phone, RotateCcw, ArrowRight, Loader2, History, LayoutDashboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ErrorAlert } from "../ErrorAlert"
import { api, ApiError, type SetupSession } from "@/lib/api"
import type { StepProps } from "../SetupWizard"

interface PhoneStepProps extends StepProps {
  onJumpToStep: (step: number, sessionData: SetupSession) => void
}

/** Calcola lo step di ripresa in base ai dati della sessione salvata. */
function getResumeStep(s: SetupSession): number {
  if (s.user_id) {
    if (s.group_id) {
      if (s.mt5_login) {
        if (s.sizing_strategy) return 7  // tutto completato → riepilogo
        return 6  // sizing
      }
      return 5  // MT5
    }
    return 4  // gruppo
  }
  // api_id impostato ma non ancora autenticati → ricomincia dalle credenziali
  if (s.api_id) return 2
  return 2  // primo step utile dopo il telefono
}

function stepLabel(step: number): string {
  const labels: Record<number, string> = {
    2: "Credenziali Telegram",
    4: "Selezione gruppo",
    5: "MetaTrader 5",
    6: "Strategia di sizing",
    7: "Riepilogo finale",
  }
  return labels[step] ?? "configurazione"
}

export function PhoneStep({ data, onDataChange, onNext, onBack, onJumpToStep }: PhoneStepProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [foundSession, setFoundSession] = useState<SetupSession | null>(null)
  const [resumeStep, setResumeStep] = useState(2)

  async function handleContinue() {
    const phone = data.phone.trim()
    if (!phone) return

    setLoading(true)
    setError(null)
    setFoundSession(null)

    try {
      const res = await api.getSession(phone)

      if (res.exists) {
        // Utente con setup già completato → vai direttamente alla dashboard
        if (res.setup_complete) {
          router.push(`/dashboard?phone=${encodeURIComponent(phone)}`)
          return
        }
        const step = getResumeStep(res)
        setFoundSession(res)
        setResumeStep(step)
      } else {
        // Nessuna sessione: crea la sessione e vai alle credenziali
        await api.saveSession({ phone })
        onDataChange({ phone })
        onNext()
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore imprevisto")
    } finally {
      setLoading(false)
    }
  }

  async function handleResume() {
    if (!foundSession) return
    setLoading(true)
    try {
      onDataChange({ phone: data.phone })
      onJumpToStep(resumeStep, foundSession)
    } finally {
      setLoading(false)
    }
  }

  async function handleRestart() {
    if (!foundSession) return
    setLoading(true)
    try {
      await api.deleteSession(data.phone.trim())
      await api.saveSession({ phone: data.phone.trim() })
      setFoundSession(null)
      onDataChange({ phone: data.phone.trim() })
      onNext()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore imprevisto")
    } finally {
      setLoading(false)
    }
  }

  // ── Vista: sessione trovata ───────────────────────────────────────────────

  if (foundSession) {
    return (
      <Card>
        <CardHeader className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 text-amber-400">
              <History className="size-4" />
            </div>
            <div>
              <CardTitle>Sessione trovata</CardTitle>
              <CardDescription className="mt-0.5">
                Hai già avviato il setup con <strong className="text-foreground">+{data.phone}</strong>
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-8 pb-8 space-y-4">
          <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 p-4 space-y-1">
            <p className="text-sm font-medium text-foreground">
              Ultimo passo completato
            </p>
            <p className="text-sm text-muted-foreground">
              Puoi riprendere da{" "}
              <span className="font-medium text-foreground">{stepLabel(resumeStep)}</span>
              {" "}senza dover reinserire i dati già salvati.
            </p>
          </div>

          {error && <ErrorAlert message={error} />}

          <div className="space-y-2 pt-1">
            <Button
              onClick={handleResume}
              disabled={loading}
              className="w-full gap-2"
              size="lg"
            >
              {loading
                ? <><Loader2 className="size-4 animate-spin" />Caricamento...</>
                : <><ArrowRight className="size-4" />Riprendi</>
              }
            </Button>
            <Button
              variant="outline"
              onClick={handleRestart}
              disabled={loading}
              className="w-full gap-2 text-muted-foreground"
            >
              <RotateCcw className="size-4" />
              Ricomincia da capo
            </Button>
            <Button
              variant="ghost"
              onClick={() => { setFoundSession(null); setError(null) }}
              disabled={loading}
              className="w-full text-muted-foreground hover:text-foreground"
            >
              Cambia numero
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Vista: inserimento numero ─────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            1
          </div>
          <div>
            <CardTitle>Numero di telefono</CardTitle>
            <CardDescription className="mt-0.5">
              Il numero associato al tuo account Telegram
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Numero di telefono</Label>
          <div className="flex gap-2">
            <div className="flex h-10 items-center rounded-lg border border-input bg-input/30 px-3 text-sm text-muted-foreground shrink-0 gap-1.5">
              <Phone className="size-3.5" />+
            </div>
            <Input
              id="phone"
              type="tel"
              placeholder="39 333 123 4567"
              value={data.phone}
              onChange={e => {
                // Rimuove tutto tranne le cifre (spazi, caratteri invisibili, ecc.)
                const clean = e.target.value.replace(/\D/g, "")
                onDataChange({ phone: clean })
                setError(null)
              }}
              onKeyDown={e => e.key === "Enter" && !loading && data.phone.trim() && handleContinue()}
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Formato internazionale senza il + (es:{" "}
            <span className="font-mono text-foreground/70">393331234567</span>)
          </p>
        </div>

        {error && <ErrorAlert message={error} />}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onBack} disabled={loading} className="flex-1">
            Indietro
          </Button>
          <Button
            onClick={handleContinue}
            disabled={!data.phone.trim() || loading}
            className="flex-1"
          >
            {loading
              ? <><Loader2 className="size-4 animate-spin" />Verifica...</>
              : "Continua"
            }
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
