"use client"

import { useState, useEffect } from "react"
import { Search, Users, Hash, Check, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ErrorAlert } from "../ErrorAlert"
import { api, ApiError, type Group } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { StepProps } from "../SetupWizard"

export function GroupSelectStep({ data, onDataChange, onNext, onBack }: StepProps) {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  async function fetchGroups() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getGroups(data.loginKey)
      setGroups(res.groups)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore nel caricamento dei gruppi")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchGroups() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = groups.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Card>
      <CardHeader className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-bold text-sm">
            4
          </div>
          <div>
            <CardTitle>Seleziona il gruppo</CardTitle>
            <CardDescription className="mt-0.5">
              Scegli il canale o gruppo da cui ricevere i segnali
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-3">
        {/* Stato di caricamento */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Caricamento gruppi...</span>
          </div>
        )}

        {/* Errore di caricamento */}
        {!loading && error && (
          <div className="space-y-3 py-2">
            <ErrorAlert message={error} />
            <Button variant="outline" onClick={fetchGroups} className="w-full gap-2">
              <RefreshCw className="size-4" />
              Riprova
            </Button>
          </div>
        )}

        {/* Lista gruppi */}
        {!loading && !error && (
          <>
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
                    onClick={() => onDataChange({ groupId: group.id, groupName: group.name })}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl p-3 text-left transition-all border",
                      isSelected
                        ? "bg-primary/10 border-primary/25 text-foreground"
                        : "border-transparent hover:bg-white/[0.04] text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <div className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                      isSelected ? "bg-primary/20" : "bg-white/[0.06]"
                    )}>
                      {group.type === "channel"
                        ? <Hash className={cn("size-4", isSelected ? "text-primary" : "text-muted-foreground")} />
                        : <Users className={cn("size-4", isSelected ? "text-primary" : "text-muted-foreground")} />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium truncate", isSelected && "text-foreground")}>
                        {group.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.members > 0 ? `${group.members.toLocaleString("it-IT")} membri · ` : ""}
                        {group.type === "channel" ? "Canale" : "Gruppo"}
                      </p>
                    </div>
                    {isSelected && <Check className="size-4 text-primary shrink-0" />}
                  </button>
                )
              })}

              {filtered.length === 0 && !search && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Nessun gruppo o canale trovato
                </p>
              )}
              {filtered.length === 0 && search && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Nessun risultato per &ldquo;{search}&rdquo;
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {groups.length} gruppi e canali trovati
            </p>
          </>
        )}

        <div className="flex gap-3 pt-1">
          <Button variant="outline" onClick={onBack} disabled={loading} className="flex-1">
            Indietro
          </Button>
          <Button
            onClick={onNext}
            disabled={data.groupId === "" || loading}
            className="flex-1"
          >
            Continua
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
