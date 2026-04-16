"use client"

import { Settings2 } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/src/components/ui/card"
import { Label } from "@/src/components/ui/label"
import type { StepProps } from "../SetupWizard"

const EXAMPLES = [
  "Sposta lo stop loss al break-even quando il prezzo raggiunge il 50% del target.",
  "Chiudi metà posizione al primo TP e lascia correre il resto con trailing stop.",
  "Nessuna gestione attiva: lascia le posizioni aperte fino a SL o TP.",
]

export function ManagementStrategyStep({ data, onDataChange, onNext, onBack }: StepProps) {
  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            7
          </div>
          <div>
            <CardTitle>Strategia di gestione</CardTitle>
            <CardDescription className="mt-0.5">
              Descrivi come l&apos;AI deve gestire le posizioni aperte (opzionale)
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="managementStrategy">Descrizione libera</Label>
          <textarea
            id="managementStrategy"
            rows={5}
            placeholder={"Esempio:\n" + EXAMPLES[0]}
            value={data.managementStrategy}
            onChange={e => onDataChange({ managementStrategy: e.target.value })}
            className={
              "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm " +
              "text-foreground placeholder:text-muted-foreground " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              "resize-none transition-shadow"
            }
          />
          <p className="text-xs text-muted-foreground">
            L&apos;AI agent utilizzerà questa descrizione per decidere come
            gestire le posizioni aperte (break-even, trailing stop, chiusura parziale, ecc.).
            Lascia vuoto per non applicare alcuna gestione attiva.
          </p>
        </div>

        {/* Esempi */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Esempi di strategia
          </p>
          <div className="space-y-1.5">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                type="button"
                onClick={() => onDataChange({ managementStrategy: ex })}
                className={
                  "w-full text-left rounded-lg border border-white/[0.07] px-3 py-2.5 " +
                  "text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground " +
                  "hover:bg-primary/5 transition-all flex items-start gap-2"
                }
              >
                <Settings2 className="size-3.5 mt-0.5 shrink-0 text-primary/60" />
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="outline" onClick={onBack} className="flex-1">
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
