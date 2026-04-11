"use client"

import { useState } from "react"
import { Phone, MessageSquare, Lock, RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ErrorAlert } from "../ErrorAlert"
import { api, ApiError } from "@/lib/api"
import type { StepProps } from "../SetupWizard"

type SubStep = "phone" | "code" | "2fa"

export function TelegramAuthStep({ data, onDataChange, onNext, onBack }: StepProps) {
  const [subStep, setSubStep] = useState<SubStep>("phone")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = () => setError(null)

  // ── Sub-step: telefono ───────────────────────────────────────────────────

  async function handleSendCode() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.requestCode(
        Number(data.apiId),
        data.apiHash,
        data.phone
      )
      onDataChange({ loginKey: res.login_key })
      setSubStep("code")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore imprevisto")
    } finally {
      setLoading(false)
    }
  }

  // ── Sub-step: codice OTP ─────────────────────────────────────────────────

  async function handleVerifyCode() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.verifyCode(data.loginKey, data.code)

      if ("error" in res && res.error === "2fa_required") {
        // Account con verifica in due passaggi
        setSubStep("2fa")
        return
      }

      // Login completato
      onDataChange({ userId: res.user_id })
      onNext()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore imprevisto")
    } finally {
      setLoading(false)
    }
  }

  // ── Sub-step: password 2FA ───────────────────────────────────────────────

  const [twoFaPassword, setTwoFaPassword] = useState("")

  async function handleVerifyPassword() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.verifyPassword(data.loginKey, twoFaPassword)
      onDataChange({ userId: res.user_id })
      onNext()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore imprevisto")
    } finally {
      setLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  function goBackToPhone() {
    setSubStep("phone")
    onDataChange({ code: "", loginKey: "" })
    clearError()
  }

  if (subStep === "phone") {
    return (
      <Card>
        <CardHeader className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
              2
            </div>
            <div>
              <CardTitle>Login Telegram</CardTitle>
              <CardDescription className="mt-0.5">
                Inserisci il numero del tuo account Telegram
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
                onChange={e => { onDataChange({ phone: e.target.value }); clearError() }}
                onKeyDown={e => e.key === "Enter" && !loading && data.phone.trim() && handleSendCode()}
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
              onClick={handleSendCode}
              disabled={!data.phone.trim() || loading}
              className="flex-1"
            >
              {loading ? <><Loader2 className="size-4 animate-spin" />Invio...</> : "Invia codice"}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (subStep === "code") {
    return (
      <Card>
        <CardHeader className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
              2
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
              onClick={goBackToPhone}
              className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              <RefreshCw className="size-3" />
              Cambia numero
            </button>
          </div>

          {error && <ErrorAlert message={error} />}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={goBackToPhone} disabled={loading} className="flex-1">
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

  // sub-step: 2FA
  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            2
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
          <Button variant="outline" onClick={() => { setSubStep("code"); clearError() }} disabled={loading} className="flex-1">
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
