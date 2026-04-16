"use client"

import { Sparkles } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/src/components/ui/card"
import { Label } from "@/src/components/ui/label"
import type { StepProps } from "../SetupWizard"

const EXAMPLES = [
  "Per tutti i simboli, aggiungi il suffisso .s alla fine (es: EURUSD → EURUSD.s, XAUUSD → XAUUSD.s).",
  "Converti tutti i simboli in maiuscolo e rimuovi eventuali slash (es: EUR/USD → EURUSD).",
  "Se il simbolo contiene 'Gold' o 'XAU', usare sempre 'XAUUSD.s' come simbolo.",
  "I Take Profit multipli devono essere emessi come oggetti separati con lo stesso entry e stop loss.",
]

export function ExtractionInstructionsStep({ data, onDataChange, onNext, onBack }: StepProps) {
  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            7
          </div>
          <div>
            <CardTitle>Istruzioni di estrazione</CardTitle>
            <CardDescription className="mt-0.5">
              Regole custom per il modello di estrazione segnali (opzionale)
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-5">
        {/* Spiegazione */}
        <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <Sparkles className="size-4 shrink-0 text-primary mt-0.5" />
          <p className="text-xs text-foreground/75 leading-relaxed">
            Queste istruzioni vengono iniettate direttamente nel prompt del modello Pro
            durante l&apos;estrazione dei segnali. Usale per correggere automaticamente i
            simboli, imporre formati specifici del tuo broker o definire comportamenti
            personalizzati. Lasciale vuote se non ti servono.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="extractionInstructions">Istruzioni personalizzate</Label>
          <textarea
            id="extractionInstructions"
            rows={4}
            placeholder={"Esempio:\n" + EXAMPLES[0]}
            value={data.extractionInstructions}
            onChange={e => onDataChange({ extractionInstructions: e.target.value })}
            className={
              "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm " +
              "text-foreground placeholder:text-muted-foreground " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              "resize-none transition-shadow"
            }
          />
          <p className="text-xs text-muted-foreground">
            Lascia vuoto per usare il comportamento predefinito del modello.
          </p>
        </div>

        {/* Esempi */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Esempi
          </p>
          <div className="space-y-1.5">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                type="button"
                onClick={() => onDataChange({ extractionInstructions: ex })}
                className={
                  "w-full text-left rounded-lg border border-white/[0.07] px-3 py-2.5 " +
                  "text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground " +
                  "hover:bg-primary/5 transition-all flex items-start gap-2"
                }
              >
                <Sparkles className="size-3.5 mt-0.5 shrink-0 text-primary/60" />
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
