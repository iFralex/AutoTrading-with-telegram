import { Bot, Shield, TrendingUp, Zap, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { StepProps } from "../SetupWizard"

const features = [
  {
    icon: Shield,
    title: "Sicuro e affidabile",
    desc: "Credenziali cifrate, sessione persistente su VPS dedicata",
  },
  {
    icon: TrendingUp,
    title: "Trading automatico",
    desc: "I segnali Telegram vengono eseguiti su MetaTrader 5 in tempo reale",
  },
  {
    icon: Zap,
    title: "Sempre attivo",
    desc: "Il bot gira 24/7 su VPS indipendentemente dal tuo dispositivo",
  },
]

export function WelcomeStep({ onNext }: StepProps) {
  return (
    <Card>
      <CardContent className="pt-8 pb-6 px-8 flex flex-col items-center text-center gap-6">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
          <Bot className="size-8 text-primary" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Configura il tuo Trading Bot
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
            Collega Telegram e MetaTrader 5 in pochi passi. Il bot riceverà
            i segnali e aprirà le operazioni automaticamente sul tuo conto.
          </p>
        </div>

        <div className="w-full grid gap-2.5">
          {features.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-left"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <Button onClick={onNext} size="lg" className="w-full gap-2 mt-1">
          Inizia la configurazione
          <ArrowRight className="size-4" />
        </Button>

        <p className="text-xs text-muted-foreground -mt-2">
          Circa 3 minuti
        </p>
      </CardContent>
    </Card>
  )
}
