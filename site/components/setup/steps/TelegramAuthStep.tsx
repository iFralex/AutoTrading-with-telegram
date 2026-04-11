"use client"

import { useState } from "react"
import { Phone, MessageSquare, RefreshCw, Loader2 } from "lucide-react"
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

export function TelegramAuthStep({
  data,
  onDataChange,
  onNext,
  onBack,
}: StepProps) {
  const [phoneSubmitted, setPhoneSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const handlePhoneSubmit = async () => {
    setLoading(true)
    // TODO: call backend API to send Telegram code
    await new Promise(r => setTimeout(r, 1500))
    setLoading(false)
    setPhoneSubmitted(true)
  }

  if (!phoneSubmitted) {
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
                Inserisci il numero di telefono del tuo account Telegram
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-8 pb-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Numero di telefono</Label>
            <div className="flex gap-2">
              <div className="flex h-10 items-center rounded-lg border border-input bg-input/30 px-3 text-sm text-muted-foreground shrink-0 gap-1.5">
                <Phone className="size-3.5" />
                +
              </div>
              <Input
                id="phone"
                type="tel"
                placeholder="39 333 123 4567"
                value={data.phone}
                onChange={e => onDataChange({ phone: e.target.value })}
                className="flex-1"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Formato internazionale senza il + (es:{" "}
              <span className="font-mono text-foreground/70">393331234567</span>)
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Indietro
            </Button>
            <Button
              onClick={handlePhoneSubmit}
              disabled={!data.phone.trim() || loading}
              className="flex-1"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Invio codice...
                </>
              ) : (
                "Invia codice"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

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
              Abbiamo inviato un codice a{" "}
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
              onChange={e =>
                onDataChange({ code: e.target.value.replace(/\D/g, "") })
              }
              className="pl-9 text-center tracking-[0.5em] text-lg font-mono"
            />
          </div>
          <button
            onClick={() => {
              setPhoneSubmitted(false)
              onDataChange({ code: "" })
            }}
            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            <RefreshCw className="size-3" />
            Cambia numero di telefono
          </button>
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            onClick={() => setPhoneSubmitted(false)}
            className="flex-1"
          >
            Indietro
          </Button>
          <Button
            onClick={onNext}
            disabled={data.code.length < 5}
            className="flex-1"
          >
            Verifica
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
