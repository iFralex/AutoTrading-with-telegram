import { ExternalLink, Info } from "lucide-react"
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

export function TelegramCredentialsStep({
  data,
  onDataChange,
  onNext,
  onBack,
}: StepProps) {
  const canNext = data.apiId.trim() !== "" && data.apiHash.trim() !== ""

  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            1
          </div>
          <div>
            <CardTitle>Credenziali Telegram API</CardTitle>
            <CardDescription className="mt-0.5">
              Ottieni l&apos;API ID e l&apos;API Hash della tua app Telegram
            </CardDescription>
          </div>
        </div>

        <div className="flex gap-2.5 rounded-xl bg-indigo-500/8 border border-indigo-500/15 p-3 mt-3">
          <Info className="size-4 text-indigo-400 mt-0.5 shrink-0" />
          <div className="text-xs text-indigo-300/90 space-y-1.5">
            <p>
              Accedi a{" "}
              <strong className="text-indigo-200">my.telegram.org</strong> con
              il tuo numero di telefono, vai su{" "}
              <strong className="text-indigo-200">API development tools</strong>{" "}
              e crea una nuova applicazione.
            </p>
            <a
              href="https://my.telegram.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-indigo-400 font-medium hover:text-indigo-300 transition-colors"
            >
              Apri my.telegram.org
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="apiId">API ID</Label>
          <Input
            id="apiId"
            type="number"
            placeholder="12345678"
            value={data.apiId}
            onChange={e => onDataChange({ apiId: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="apiHash">API Hash</Label>
          <Input
            id="apiHash"
            placeholder="0123456789abcdef0123456789abcdef"
            value={data.apiHash}
            onChange={e => onDataChange({ apiHash: e.target.value })}
            className="font-mono text-xs"
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
