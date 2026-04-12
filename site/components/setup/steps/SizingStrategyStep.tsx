"use client"

import { BarChart2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import type { StepProps } from "../SetupWizard"

const EXAMPLES = [
  "Usa sempre 0.1 lot per ogni operazione.",
  "Rischia il 2% del balance per trade, calcolato sulla distanza dallo stop loss.",
  "Usa 0.01 lot per ogni $1.000 di balance.",
]

export function SizingStrategyStep({ data, onDataChange, onNext, onBack }: StepProps) {
  const canContinue = data.sizingStrategy.trim().length > 0

  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            6
          </div>
          <div>
            <CardTitle>Strategia di sizing</CardTitle>
            <CardDescription className="mt-0.5">
              Descrivi come vuoi calcolare la dimensione delle posizioni
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="sizingStrategy">Descrizione libera</Label>
          <textarea
            id="sizingStrategy"
            rows={5}
            placeholder={"Esempio:\n" + EXAMPLES[0]}
            value={data.sizingStrategy}
            onChange={e => onDataChange({ sizingStrategy: e.target.value })}
            className={
              "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm " +
              "text-foreground placeholder:text-muted-foreground " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              "resize-none transition-shadow"
            }
          />
          <p className="text-xs text-muted-foreground">
            L&apos;AI utilizzerà questa descrizione insieme alle informazioni
            del conto (balance, equity, margine libero, leva) per calcolare
            il lot size ottimale ad ogni segnale.
          </p>
        </div>

        {/* Esempi ─────────────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Esempi di strategia
          </p>
          <div className="space-y-1.5">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                type="button"
                onClick={() => onDataChange({ sizingStrategy: ex })}
                className={
                  "w-full text-left rounded-lg border border-white/[0.07] px-3 py-2.5 " +
                  "text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground " +
                  "hover:bg-primary/5 transition-all flex items-start gap-2"
                }
              >
                <BarChart2 className="size-3.5 mt-0.5 shrink-0 text-primary/60" />
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Indietro
          </Button>
          <Button
            onClick={onNext}
            disabled={!canContinue}
            className="flex-1"
          >
            Continua
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
