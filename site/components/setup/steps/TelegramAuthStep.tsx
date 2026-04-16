"use client"

import { useState } from "react"
import { MessageSquare, Lock, RefreshCw, Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ErrorAlert } from "../ErrorAlert"
import { api, ApiError } from "@/lib/api"
import type { StepProps } from "../SetupWizard"

type SubStep = "code" | "2fa" | "done"

export function TelegramAuthStep({ data, onDataChange, onNext, onBack }: StepProps) {
  // Se userId è già impostato (ripresa sessione) → mostra la vista "done"
  const [subStep, setSubStep] = useState<SubStep>(data.userId ? "done" : "code")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [twoFaPassword, setTwoFaPassword] = useState("")

  const clearError = () => setError(null)

  // ── Sub-step: codice OTP ─────────────────────────────────────────────────

  async function handleVerifyCode() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.verifyCode(data.loginKey, data.code)

      if ("error" in res && res.error === "2fa_required") {
        setSubStep("2fa")
        return
      }

      const verified = res as import("@/lib/api").VerifyCodeResponse
      onDataChange({ userId: verified.user_id })
      // Salva subito in sessione con il valore fresco (non aspetta il re-render React)
      await api.saveSession({ phone: data.phone, user_id: verified.user_id })
      onNext()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore imprevisto")
    } finally {
      setLoading(false)
    }
  }

  // ── Sub-step: password 2FA ───────────────────────────────────────────────

  async function handleVerifyPassword() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.verifyPassword(data.loginKey, twoFaPassword)
      onDataChange({ userId: res.user_id })
      // Salva subito in sessione con il valore fresco (non aspetta il re-render React)
      await api.saveSession({ phone: data.phone, user_id: res.user_id })
      onNext()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore imprevisto")
    } finally {
      setLoading(false)
    }
  }

  // ── Sub-step: già autenticato (ripresa sessione) ─────────────────────────

  if (subStep === "done") {
    return (
      <Card>
        <CardHeader className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <CheckCircle2 className="size-4 text-emerald-400" />
            </div>
            <div>
              <CardTitle>Già autenticato</CardTitle>
              <CardDescription className="mt-0.5">
                Il tuo account Telegram è già stato verificato in questa sessione
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-8 pb-8 space-y-4">
          <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-4">
            <p className="text-sm text-muted-foreground">
              Puoi procedere direttamente al passo successivo oppure tornare
              indietro per modificare le credenziali Telegram.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                // Torna a credenziali: l'onBack del wizard pulirà login_key e userId
                onBack()
              }}
              className="flex-1"
            >
              Indietro
            </Button>
            <Button onClick={onNext} className="flex-1">
              Continua
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Sub-step: codice OTP ─────────────────────────────────────────────────

  if (subStep === "code") {
    return (
      <Card>
        <CardHeader className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
              3
            </div>
            <div>
              <CardTitle>Inserisci il codice</CardTitle>
              <CardDescription className="mt-0.5">
                Codice inviato a{" "}
                <strong className="text-foreground">+{data.phone}</strong>
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-8 pb-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Codice di verifica</Label>
            <div className="relative">
              <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                id="code"
                placeholder="1 2 3 4 5"
                maxLength={6}
                value={data.code}
                onChange={e => { onDataChange({ code: e.target.value.replace(/\D/g, "") }); clearError() }}
                onKeyDown={e => e.key === "Enter" && data.code.length >= 5 && !loading && handleVerifyCode()}
                className="pl-9 text-center tracking-[0.5em] text-lg font-mono"
                autoFocus
              />
            </div>
            <button
              onClick={() => { onDataChange({ code: "" }); onBack() }}
              className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              <RefreshCw className="size-3" />
              Cambia credenziali / numero
            </button>
          </div>

          {error && <ErrorAlert message={error} />}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={onBack} disabled={loading} className="flex-1">
              Indietro
            </Button>
            <Button
              onClick={handleVerifyCode}
              disabled={data.code.length < 5 || loading}
              className="flex-1"
            >
              {loading ? <><Loader2 className="size-4 animate-spin" />Verifica...</> : "Verifica"}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Sub-step: 2FA ────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            3
          </div>
          <div>
            <CardTitle>Verifica in due passaggi</CardTitle>
            <CardDescription className="mt-0.5">
              Il tuo account ha la 2FA attiva. Inserisci la password cloud Telegram.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="2fa">Password cloud Telegram</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              id="2fa"
              type="password"
              placeholder="••••••••"
              value={twoFaPassword}
              onChange={e => { setTwoFaPassword(e.target.value); clearError() }}
              onKeyDown={e => e.key === "Enter" && twoFaPassword && !loading && handleVerifyPassword()}
              className="pl-9"
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">
            È la password che hai impostato in Telegram → Impostazioni → Privacy e sicurezza → Verifica in due passaggi
          </p>
        </div>

        {error && <ErrorAlert message={error} />}

        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            onClick={() => { setSubStep("code"); clearError() }}
            disabled={loading}
            className="flex-1"
          >
            Indietro
          </Button>
          <Button
            onClick={handleVerifyPassword}
            disabled={!twoFaPassword || loading}
            className="flex-1"
          >
            {loading ? <><Loader2 className="size-4 animate-spin" />Accesso...</> : "Accedi"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
