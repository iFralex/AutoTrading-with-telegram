"use client"

import { useState } from "react"
import { Search, Users, Hash, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { StepProps } from "../SetupWizard"

// Mock data — in produzione questi vengono caricati dal backend dopo il login Telegram
const MOCK_GROUPS = [
  { id: "-100111111", name: "Forex Signals Premium", type: "channel", members: 4821 },
  { id: "-100222222", name: "Gold & Crypto Signals", type: "channel", members: 2340 },
  { id: "-100333333", name: "EUR/USD Daily Calls", type: "group", members: 891 },
  { id: "-100444444", name: "Trading Room Pro", type: "group", members: 1205 },
  { id: "-100555555", name: "Scalping Alerts", type: "channel", members: 7631 },
]

export function GroupSelectStep({
  data,
  onDataChange,
  onNext,
  onBack,
}: StepProps) {
  const [search, setSearch] = useState("")

  const filtered = MOCK_GROUPS.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            3
          </div>
          <div>
            <CardTitle>Seleziona il gruppo</CardTitle>
            <CardDescription className="mt-0.5">
              Scegli il canale o gruppo Telegram da cui ricevere i segnali
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Cerca gruppi e canali..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="space-y-1 max-h-60 overflow-y-auto -mx-1 px-1">
          {filtered.map(group => {
            const isSelected = data.groupId === group.id
            return (
              <button
                key={group.id}
                onClick={() =>
                  onDataChange({ groupId: group.id, groupName: group.name })
                }
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl p-3 text-left transition-all",
                  "border",
                  isSelected
                    ? "bg-primary/10 border-primary/25 text-foreground"
                    : "border-transparent hover:bg-white/[0.04] text-muted-foreground hover:text-foreground"
                )}
              >
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                    isSelected ? "bg-primary/20" : "bg-white/[0.06]"
                  )}
                >
                  {group.type === "channel" ? (
                    <Hash
                      className={cn(
                        "size-4",
                        isSelected ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                  ) : (
                    <Users
                      className={cn(
                        "size-4",
                        isSelected ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium truncate",
                      isSelected && "text-foreground"
                    )}
                  >
                    {group.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {group.members.toLocaleString()} membri ·{" "}
                    {group.type === "channel" ? "Canale" : "Gruppo"}
                  </p>
                </div>
                {isSelected && (
                  <Check className="size-4 text-primary shrink-0" />
                )}
              </button>
            )
          })}

          {filtered.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nessun gruppo trovato
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Vengono mostrati i gruppi e canali a cui sei iscritto
        </p>

        <div className="flex gap-3 pt-1">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Indietro
          </Button>
          <Button
            onClick={onNext}
            disabled={data.groupId === ""}
            className="flex-1"
          >
            Continua
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
