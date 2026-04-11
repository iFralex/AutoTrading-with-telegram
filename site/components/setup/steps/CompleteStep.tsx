import { CheckCircle2, Bot, Hash, TrendingUp, ArrowRight, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { StepProps } from "../SetupWizard"

export function CompleteStep({ data, onBack }: StepProps) {
  const items = [
    {
      icon: Bot,
      label: "App Telegram",
      value: `API ID: ${data.apiId}`,
    },
    {
      icon: Hash,
      label: "Gruppo selezionato",
      value: data.groupName,
    },
    {
      icon: TrendingUp,
      label: "Conto MetaTrader 5",
      value: `${data.mt5Login} · ${data.mt5Server}`,
    },
  ]

  return (
    <Card>
      <CardContent className="pt-8 pb-8 px-8 flex flex-col items-center gap-6">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/25">
          <CheckCircle2
            className="size-8 text-emerald-400"
            strokeWidth={1.5}
          />
        </div>

        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-foreground">
            Configurazione completata!
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
            Il bot è pronto per essere avviato. Monitorerà i segnali e
            aprirà le operazioni automaticamente sul tuo conto.
          </p>
        </div>

        <div className="w-full rounded-xl border border-white/[0.07] overflow-hidden">
          {items.map(({ icon: Icon, label, value }, i) => (
            <div key={label}>
              {i > 0 && <Separator className="bg-white/[0.07]" />}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-medium text-foreground truncate">
                    {value}
                  </p>
                </div>
                <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
              </div>
            </div>
          ))}
        </div>

        <div className="w-full space-y-2">
          <Button size="lg" className="w-full gap-2">
            Avvia il Bot
            <ArrowRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={onBack}
            className="w-full gap-2 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-4" />
            Modifica configurazione
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
