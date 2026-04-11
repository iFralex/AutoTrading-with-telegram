"use client"

import { useState } from "react"
import { Eye, EyeOff, HelpCircle, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { StepProps } from "../SetupWizard"

export function MT5Step({ data, onDataChange, onNext, onBack }: StepProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const canNext =
    data.mt5Login.trim() !== "" &&
    data.mt5Password !== "" &&
    data.mt5Server.trim() !== ""

  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            4
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
            onChange={e => onDataChange({ mt5Login: e.target.value })}
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
              onChange={e => onDataChange({ mt5Password: e.target.value })}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? "Nascondi password" : "Mostra password"}
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
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
              {showHelp ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
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
                Il nome del server è visibile nella lista dei broker (es:{" "}
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
            onChange={e => onDataChange({ mt5Server: e.target.value })}
            className="font-mono"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Indietro
          </Button>
          <Button onClick={onNext} disabled={!canNext} className="flex-1">
            Continua
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
