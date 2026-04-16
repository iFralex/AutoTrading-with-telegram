"use client"

import { AlertTriangle } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/src/components/ui/card"
import { Label } from "@/src/components/ui/label"
import type { StepProps } from "../SetupWizard"

const EXAMPLES = [
  "Chiudi immediatamente tutte le posizioni aperte correlate al segnale eliminato.",
  "Chiudi le posizioni solo se sono in profitto. Se in perdita, sposta lo stop loss al break-even e attendi.",
  "Analizza il P&L giornaliero: se positivo chiudi tutto, se negativo lascia aperto e sposta SL a break-even.",
  "Riduci di metà il volume delle posizioni aperte correlate e sposta lo SL al break-even.",
]

export function DeletionStrategyStep({ data, onDataChange, onNext, onBack }: StepProps) {
  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            8
          </div>
          <div>
            <CardTitle>Strategia messaggi eliminati</CardTitle>
            <CardDescription className="mt-0.5">
              Cosa deve fare l&apos;AI quando il canale elimina un messaggio segnale (opzionale)
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-5">
        {/* Spiegazione del problema */}
        <div className="flex gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="size-4 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-xs text-amber-300/80 leading-relaxed">
            Le sale segnali spesso eliminano i messaggi per nascondere operazioni andate male.
            Qui puoi definire cosa deve fare l&apos;AI agent in quel caso: chiudere le posizioni,
            modificare SL/TP, o agire in base al profitto corrente.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="deletionStrategy">Descrizione libera</Label>
          <textarea
            id="deletionStrategy"
            rows={5}
            placeholder={"Esempio:\n" + EXAMPLES[0]}
            value={data.deletionStrategy}
            onChange={e => onDataChange({ deletionStrategy: e.target.value })}
            className={
              "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm " +
              "text-foreground placeholder:text-muted-foreground " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              "resize-none transition-shadow"
            }
          />
          <p className="text-xs text-muted-foreground">
            Lascia vuoto per ignorare le eliminazioni e non fare nulla.
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
                onClick={() => onDataChange({ deletionStrategy: ex })}
                className={
                  "w-full text-left rounded-lg border border-white/[0.07] px-3 py-2.5 " +
                  "text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground " +
                  "hover:bg-primary/5 transition-all flex items-start gap-2"
                }
              >
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-primary/60" />
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
