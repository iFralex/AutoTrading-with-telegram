"use client"

import { useState, useRef, useEffect } from "react"
import { api, type DashboardUserResponse, type UserGroup, type Group, type TrustScore } from "@/src/lib/api"
import {
  Check, Pencil, X, ChevronRight, ChevronDown,
  Plus, Trash2, Radio, Search, Hash, Users, Loader2, RefreshCw, Copy,
  ShieldAlert, Play,
} from "lucide-react"

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPage({
  data,
  onUserUpdate,
}: {
  data: DashboardUserResponse
  onUserUpdate: (d: DashboardUserResponse) => void
}) {
  const { user } = data

  const [trustScores, setTrustScores] = useState<Record<number, TrustScore>>({})
  const [drawdownStatus, setDrawdownStatus] = useState<{
    paused:      boolean
    threshold:   number | null
    period:      "daily" | "weekly" | "monthly" | "custom"
    period_days: number
    strategy:    string | null
  } | null>(null)
  const [drawdownLoading, setDrawdownLoading] = useState(false)

  useEffect(() => {
    api.getTrustScores(user.user_id)
      .then(res => {
        const map: Record<number, TrustScore> = {}
        for (const s of res.scores) map[s.group_id] = s
        setTrustScores(map)
      })
      .catch(() => {})
    api.getDrawdownStatus(user.user_id)
      .then(res => setDrawdownStatus(res))
      .catch(() => {})
  }, [user.user_id])

  const patchGroups = (groups: UserGroup[]) =>
    onUserUpdate({ ...data, user: { ...user, groups } })

  const updateGroup = (updated: UserGroup) =>
    patchGroups(user.groups.map(g => g.group_id === updated.group_id ? updated : g))

  const removeGroup = (groupId: number) =>
    patchGroups(user.groups.filter(g => g.group_id !== groupId))

  const addGroup = (g: UserGroup) =>
    patchGroups([...user.groups, g])

  const handleUpdateDrawdown = async (settings: {
    drawdown_alert_pct?:   number | null
    drawdown_period?:      "daily" | "weekly" | "monthly" | "custom"
    drawdown_period_days?: number
    drawdown_strategy?:    string | null
  }) => {
    setDrawdownLoading(true)
    try {
      await api.updateDrawdownSettings(user.user_id, settings)
      setDrawdownStatus(prev => {
        const base = prev ?? { paused: false, threshold: null, period: "daily" as const, period_days: 1, strategy: null }
        return {
          ...base,
          threshold:   settings.drawdown_alert_pct   !== undefined ? settings.drawdown_alert_pct   : base.threshold,
          period:      settings.drawdown_period       !== undefined ? settings.drawdown_period       : base.period,
          period_days: settings.drawdown_period_days  !== undefined ? settings.drawdown_period_days  : base.period_days,
          strategy:    settings.drawdown_strategy     !== undefined ? settings.drawdown_strategy     : base.strategy,
        }
      })
    } finally {
      setDrawdownLoading(false)
    }
  }

  const handleResumeDrawdown = async () => {
    setDrawdownLoading(true)
    try {
      await api.resumeDrawdown(user.user_id)
      setDrawdownStatus(prev => prev ? { ...prev, paused: false } : null)
    } finally {
      setDrawdownLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Configurazione</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Canali monitorati e impostazioni AI/ordini per ciascuno
        </p>
      </div>

      {/* ── Protezione account (drawdown) ───────────────────────────────── */}
      <DrawdownProtectionSection
        status={drawdownStatus}
        loading={drawdownLoading}
        onUpdate={handleUpdateDrawdown}
        onResume={handleResumeDrawdown}
      />

      {/* ── Lista gruppi ─────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {user.groups.map(group => (
          <GroupCard
            key={group.group_id}
            group={group}
            userId={user.user_id}
            trustScore={trustScores[group.group_id] ?? null}
            onUpdate={updateGroup}
            onRemove={() => removeGroup(group.group_id)}
            canRemove={user.groups.length > 1}
            otherGroups={user.groups.filter(g => g.group_id !== group.group_id)}
          />
        ))}

        {/* Aggiungi nuovo gruppo */}
        <AddGroupCard
          userId={user.user_id}
          onAdded={addGroup}
        />
      </div>
    </div>
  )
}

// ── Drawdown protection section ───────────────────────────────────────────────

function DrawdownProtectionSection({
  status,
  loading,
  onUpdate,
  onResume,
}: {
  status: {
    paused:      boolean
    threshold:   number | null
    period:      "daily" | "weekly" | "monthly" | "custom"
    period_days: number
    strategy:    string | null
  } | null
  loading: boolean
  onUpdate: (settings: {
    drawdown_alert_pct?:   number | null
    drawdown_period?:      "daily" | "weekly" | "monthly" | "custom"
    drawdown_period_days?: number
    drawdown_strategy?:    string | null
  }) => Promise<void>
  onResume: () => Promise<void>
}) {
  const [editing, setEditing]           = useState(false)
  const [draftPct, setDraftPct]         = useState<string>("")
  const [draftPeriod, setDraftPeriod]   = useState<"daily" | "weekly" | "monthly" | "custom">("daily")
  const [draftDays, setDraftDays]       = useState<number>(7)
  const [draftStrategy, setDraftStrategy] = useState<string>("")
  const [saveErr, setSaveErr]           = useState<string | null>(null)
  const [saved, setSaved]               = useState(false)

  const periodLabel = (p: string, days?: number) => {
    if (p === "daily")   return "Giornaliero"
    if (p === "weekly")  return "Settimanale"
    if (p === "monthly") return "Mensile"
    if (p === "custom")  return `Ultimi ${days ?? 7} giorni`
    return p
  }

  const startEdit = () => {
    setDraftPct(status?.threshold != null ? String(status.threshold) : "")
    setDraftPeriod(status?.period ?? "daily")
    setDraftDays(status?.period_days ?? 7)
    setDraftStrategy(status?.strategy ?? "")
    setSaveErr(null)
    setEditing(true)
  }

  const save = async () => {
    const pct = draftPct.trim() === "" ? null : parseFloat(draftPct)
    if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) {
      setSaveErr("Inserisci un valore tra 0 e 100")
      return
    }
    setSaveErr(null)
    try {
      await onUpdate({
        drawdown_alert_pct:   pct,
        drawdown_period:      draftPeriod,
        drawdown_period_days: draftPeriod === "custom" ? Math.max(1, draftDays) : undefined,
        drawdown_strategy:    draftStrategy.trim() || null,
      })
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Errore")
    }
  }

  const threshold = status?.threshold ?? null
  const period    = status?.period    ?? "daily"
  const paused    = status?.paused    ?? false

  return (
    <div className="rounded-xl border border-white/[0.07] bg-card/40 overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-3">
        <ShieldAlert className={`w-4 h-4 shrink-0 ${paused ? "text-red-400" : "text-muted-foreground"}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Protezione account</p>
          <p className="text-xs text-muted-foreground">Sospende il trading se il drawdown supera la soglia nel periodo selezionato</p>
        </div>
        {paused && (
          <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-600/15 border border-red-500/30 text-red-400 uppercase tracking-wide">
            Sospeso
          </span>
        )}
      </div>

      <div className="border-t border-white/[0.06] px-5 py-4 space-y-3">
        {paused && (
          <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-600/8 px-4 py-3">
            <p className="flex-1 text-xs text-red-300">Trading sospeso: soglia drawdown raggiunta. Riprendi manualmente quando sei pronto.</p>
            <button
              onClick={onResume}
              disabled={loading}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Riprendi
            </button>
          </div>
        )}

        {!editing ? (
          <div className="flex items-start justify-between gap-3">
            <div className={`flex-1 text-sm font-mono rounded-lg border px-3 py-2.5 space-y-1 ${
              threshold != null && threshold > 0
                ? "bg-black/15 border-white/[0.07] text-foreground/80"
                : "bg-black/10 border-white/[0.05] text-muted-foreground/50 italic"
            }`}>
              {threshold != null && threshold > 0 ? (
                <>
                  <p>Soglia: {threshold}% · {periodLabel(period, status?.period_days)}</p>
                  {status?.strategy && (
                    <p className="text-xs text-muted-foreground truncate">Strategia AI: {status.strategy}</p>
                  )}
                </>
              ) : (
                <p>Disabilitato</p>
              )}
            </div>
            <button onClick={startEdit} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all mt-1">
              {saved ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></> : <><Pencil className="w-3 h-3" />Modifica</>}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Threshold */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Soglia di drawdown (%)</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0} max={100} step={0.5}
                  value={draftPct}
                  onChange={e => setDraftPct(e.target.value)}
                  placeholder="Es: 5 (vuoto = disabilitato)"
                  className="flex-1 rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-sm font-mono text-foreground/90 focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-muted-foreground/30"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Percentuale massima di perdita nel periodo. Vuoto o 0 = disabilitato.</p>
            </div>

            {/* Period selector */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Periodo di calcolo</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(["daily", "weekly", "monthly", "custom"] as const).map(p => (
                  <button
                    key={p} type="button" onClick={() => setDraftPeriod(p)}
                    className={`text-left rounded-lg border px-3 py-2 transition-all ${
                      draftPeriod === p
                        ? "border-indigo-500/40 bg-indigo-600/8 text-foreground"
                        : "border-white/[0.07] text-muted-foreground hover:border-white/[0.15] hover:text-foreground hover:bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2.5 h-2.5 rounded-full border-2 shrink-0 ${draftPeriod === p ? "border-indigo-400 bg-indigo-400/30" : "border-white/20"}`} />
                      <span className="text-xs font-medium">{periodLabel(p)}</span>
                    </div>
                  </button>
                ))}
              </div>
              {draftPeriod === "custom" && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number" min={1} max={365}
                    value={draftDays}
                    onChange={e => setDraftDays(Math.max(1, Math.min(365, Number(e.target.value))))}
                    className="w-24 rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-sm font-mono text-foreground/90 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  />
                  <span className="text-xs text-muted-foreground">giorni (1–365)</span>
                </div>
              )}
            </div>

            {/* Strategy textarea */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Strategia AI al raggiungimento (opzionale)</p>
              <textarea
                value={draftStrategy}
                onChange={e => setDraftStrategy(e.target.value)}
                rows={3}
                placeholder="Es: Chiudi tutte le posizioni in perdita e sospendi nuovi ingressi per il resto del giorno"
                className="w-full rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2.5 text-sm font-mono text-foreground/90 resize-y focus:outline-none focus:border-indigo-500/50 placeholder:text-muted-foreground/30 transition-colors"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Se impostata, l&apos;AI agent eseguirà questa strategia invece di bloccare il trading.</p>
            </div>

            {saveErr && <p className="text-xs text-red-400">{saveErr}</p>}
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={loading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors">
                <Check className="w-3 h-3" />{loading ? "Salvataggio…" : "Salva"}
              </button>
              <button onClick={() => setEditing(false)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:text-foreground transition-all disabled:opacity-50">
                <X className="w-3 h-3" />Annulla
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Group card ────────────────────────────────────────────────────────────────

function GroupCard({
  group,
  userId,
  trustScore,
  onUpdate,
  onRemove,
  canRemove,
  otherGroups,
}: {
  group: UserGroup
  userId: string
  trustScore: TrustScore | null
  onUpdate: (g: UserGroup) => void
  onRemove: () => void
  canRemove: boolean
  otherGroups: UserGroup[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeErr, setRemoveErr] = useState<string | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyOk, setCopyOk] = useState(false)
  const copyRef = useRef<HTMLDivElement>(null)

  const patch = (fields: Partial<UserGroup>) => onUpdate({ ...group, ...fields })

  const handleRemove = async () => {
    if (!confirm(`Rimuovere il canale "${group.group_name}"?`)) return
    setRemoving(true)
    setRemoveErr(null)
    try {
      await api.removeUserGroup(userId, group.group_id)
      onRemove()
    } catch (e: unknown) {
      setRemoveErr(e instanceof Error ? e.message : "Errore")
      setRemoving(false)
    }
  }

  const handleCopyFrom = async (src: UserGroup) => {
    setCopyOpen(false)
    setCopying(true)
    const fields = {
      extraction_instructions: src.extraction_instructions,
      sizing_strategy:         src.sizing_strategy,
      management_strategy:     src.management_strategy,
      deletion_strategy:       src.deletion_strategy,
      range_entry_pct:         src.range_entry_pct,
      entry_if_favorable:      src.entry_if_favorable,
      trading_hours_enabled:   src.trading_hours_enabled,
      trading_hours_start:     src.trading_hours_start,
      trading_hours_end:       src.trading_hours_end,
      trading_hours_days:      src.trading_hours_days,
      min_confidence:          src.min_confidence,
      eco_calendar_enabled:    src.eco_calendar_enabled,
      eco_calendar_window:     src.eco_calendar_window,
      eco_calendar_strategy:   src.eco_calendar_strategy,
    }
    try {
      await api.updateUserGroup(userId, group.group_id, fields)
      patch(fields)
      setCopyOk(true)
      setTimeout(() => setCopyOk(false), 2000)
    } catch {
      // silently ignore — user can retry
    } finally {
      setCopying(false)
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!copyOpen) return
    const handler = (e: MouseEvent) => {
      if (copyRef.current && !copyRef.current.contains(e.target as Node))
        setCopyOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [copyOpen])

  return (
    <div className="rounded-xl border border-white/[0.07] bg-card/40 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{group.group_name}</p>
            <TrustScoreTag score={trustScore} />
          </div>
          <p className="text-xs text-muted-foreground font-mono">ID: {group.group_id}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Copy-from dropdown (only when multiple groups exist) */}
          {otherGroups.length > 0 && (
            <div className="relative" ref={copyRef}>
              <button
                onClick={() => setCopyOpen(o => !o)}
                disabled={copying}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-40 ${
                  copyOk
                    ? "border-emerald-500/30 text-emerald-400 bg-emerald-600/8"
                    : "border-white/[0.08] text-muted-foreground hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05]"
                }`}
                title="Copia impostazioni da un altro canale"
              >
                {copying ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : copyOk ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                {copyOk ? "Copiato" : "Copia da…"}
              </button>
              {copyOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-20 w-52 rounded-xl border border-white/[0.1] bg-[#0f0f1e] shadow-xl overflow-hidden">
                  <p className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Copia impostazioni da
                  </p>
                  {otherGroups.map(src => (
                    <button
                      key={src.group_id}
                      onClick={() => handleCopyFrom(src)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-white/[0.05] transition-colors"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="truncate text-xs text-foreground/80">{src.group_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {canRemove && (
            <button
              onClick={handleRemove}
              disabled={removing}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-600/8 transition-all disabled:opacity-40"
              title="Rimuovi canale"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {expanded ? "Chiudi" : "Impostazioni"}
          </button>
        </div>
      </div>

      {removeErr && (
        <p className="px-5 pb-3 text-xs text-red-400">{removeErr}</p>
      )}

      {/* Settings (expanded) */}
      {expanded && (
        <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
          {/* Name & ID */}
          <GroupSettingRow title="Nome e ID" badge="canale">
            <GroupNameField
              group={group}
              userId={userId}
              onSaved={updated => patch(updated)}
            />
          </GroupSettingRow>

          <GroupSettingRow title="Istruzioni di estrazione" badge="AI prompt"
            description="Regole custom iniettate nel prompt Pro per modificare il comportamento di estrazione">
            <TextareaField
              value={group.extraction_instructions}
              placeholder="Es: aggiungi .s a tutti i simboli"
              rows={3}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, { extraction_instructions: v })
                patch({ extraction_instructions: v })
              }}
            />
          </GroupSettingRow>

          <GroupSettingRow title="Sizing Strategy" badge="AI prompt"
            description="Istruzione iniettata nel prompt AI per il calcolo del lotto">
            <TextareaField
              value={group.sizing_strategy}
              placeholder="Es: Usa sempre il 2% del balance come rischio"
              rows={4}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, { sizing_strategy: v })
                patch({ sizing_strategy: v })
              }}
            />
          </GroupSettingRow>

          <GroupSettingRow title="Management Strategy" badge="AI agent"
            description="Strategia di gestione delle posizioni (eseguita dall'AI agent)">
            <TextareaField
              value={group.management_strategy}
              placeholder="Es: Sposta SL al break-even al 50% del target"
              rows={4}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, { management_strategy: v })
                patch({ management_strategy: v })
              }}
            />
          </GroupSettingRow>

          <GroupSettingRow title="Strategia messaggi eliminati" badge="AI agent"
            description="Cosa fare quando il canale elimina un messaggio segnale">
            <TextareaField
              value={group.deletion_strategy}
              placeholder="Es: Chiudi immediatamente tutte le posizioni correlate"
              rows={4}
              suggestions={DELETION_EXAMPLES}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, { deletion_strategy: v })
                patch({ deletion_strategy: v })
              }}
            />
          </GroupSettingRow>

          <GroupSettingRow title="Posizione nel range di ingresso" badge="ordini"
            description="Dove piazzare il limite quando il segnale indica un range di entry">
            <RangeField
              value={group.range_entry_pct ?? 0}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, { range_entry_pct: v })
                patch({ range_entry_pct: v })
              }}
            />
          </GroupSettingRow>

          <GroupSettingRow title="Ingresso a mercato se prezzo favorevole" badge="ordini"
            description="Entra subito a mercato se il prezzo è già oltre il target">
            <RadioField
              value={group.entry_if_favorable ?? false}
              options={[
                { val: true,  label: "Attivo",    desc: "Entra subito se prezzo già favorevole" },
                { val: false, label: "Disattivo", desc: "Piazza sempre l'ordine pendente al target" },
              ]}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, { entry_if_favorable: v })
                patch({ entry_if_favorable: v })
              }}
            />
          </GroupSettingRow>

          <GroupSettingRow title="Orari di trading" badge="filtro"
            description="Limita l'esecuzione degli ordini a giorni e fasce orarie specifiche (UTC)">
            <TradingHoursField
              value={{
                enabled: group.trading_hours_enabled ?? false,
                start:   group.trading_hours_start   ?? 0,
                end:     group.trading_hours_end      ?? 23,
                days:    group.trading_hours_days     ?? ["MON","TUE","WED","THU","FRI"],
              }}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, {
                  trading_hours_enabled: v.enabled,
                  trading_hours_start:   v.start,
                  trading_hours_end:     v.end,
                  trading_hours_days:    v.days,
                })
                patch({
                  trading_hours_enabled: v.enabled,
                  trading_hours_start:   v.start,
                  trading_hours_end:     v.end,
                  trading_hours_days:    v.days,
                })
              }}
            />
          </GroupSettingRow>

          <GroupSettingRow title="Soglia confidenza AI" badge="filtro"
            description="Scarta i segnali con confidenza di estrazione inferiore alla soglia (0 = accetta tutto)">
            <ConfidenceField
              value={group.min_confidence ?? 0}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, { min_confidence: v })
                patch({ min_confidence: v })
              }}
            />
          </GroupSettingRow>

          <GroupSettingRow title="Calendario economico" badge="filtro"
            description="Sospende o modifica l'estrazione nelle N minuti prima/dopo eventi macroeconomici ad alto impatto (ForexFactory)">
            <EcoCalendarField
              value={{
                enabled:  group.eco_calendar_enabled  ?? false,
                window:   group.eco_calendar_window   ?? 30,
                strategy: group.eco_calendar_strategy ?? null,
              }}
              onSave={async v => {
                await api.updateUserGroup(userId, group.group_id, {
                  eco_calendar_enabled:  v.enabled,
                  eco_calendar_window:   v.window,
                  eco_calendar_strategy: v.strategy,
                })
                patch({
                  eco_calendar_enabled:  v.enabled,
                  eco_calendar_window:   v.window,
                  eco_calendar_strategy: v.strategy,
                })
              }}
            />
          </GroupSettingRow>
        </div>
      )}
    </div>
  )
}

// ── Add group card ────────────────────────────────────────────────────────────

function AddGroupCard({
  userId,
  onAdded,
}: {
  userId: string
  onAdded: (g: UserGroup) => void
}) {
  const [open, setOpen]           = useState(false)
  const [groups, setGroups]       = useState<Group[]>([])
  const [fetchLoading, setFL]     = useState(false)
  const [fetchErr, setFetchErr]   = useState<string | null>(null)
  const [search, setSearch]       = useState("")
  const [selected, setSelected]   = useState<Group | null>(null)
  const [addLoading, setAddL]     = useState(false)
  const [addErr, setAddErr]       = useState<string | null>(null)

  const openPicker = async () => {
    setOpen(true)
    setSelected(null)
    setSearch("")
    setAddErr(null)
    setFL(true)
    setFetchErr(null)
    try {
      const res = await api.getAvailableGroups(userId)
      setGroups(res.groups)
    } catch (e: unknown) {
      setFetchErr(e instanceof Error ? e.message : "Errore caricamento")
    } finally {
      setFL(false)
    }
  }

  const confirm = async () => {
    if (!selected) return
    setAddL(true); setAddErr(null)
    try {
      await api.addUserGroup(userId, parseInt(selected.id, 10), selected.name)
      const res = await api.getUserGroups(userId)
      const newGroup = res.groups.find(g => String(g.group_id) === selected.id)
      if (newGroup) onAdded(newGroup)
      setOpen(false)
    } catch (e: unknown) {
      setAddErr(e instanceof Error ? e.message : "Errore")
    } finally {
      setAddL(false)
    }
  }

  const filtered = groups.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase())
  )

  if (!open) {
    return (
      <button
        onClick={openPicker}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/[0.1] text-muted-foreground hover:border-indigo-500/30 hover:text-indigo-300 hover:bg-indigo-600/5 transition-all text-sm font-medium"
      >
        <Plus className="w-4 h-4" />
        Aggiungi canale / gruppo
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-indigo-600/5 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Seleziona canale / gruppo</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Loading state */}
      {fetchLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Caricamento canali…</span>
        </div>
      )}

      {/* Fetch error */}
      {!fetchLoading && fetchErr && (
        <div className="space-y-2">
          <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">{fetchErr}</p>
          <button
            onClick={openPicker}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Riprova
          </button>
        </div>
      )}

      {/* Group list */}
      {!fetchLoading && !fetchErr && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
            <input
              type="text"
              placeholder="Cerca canali e gruppi…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg focus:outline-none focus:border-indigo-500/40 transition-all placeholder:text-muted-foreground/40"
            />
          </div>

          <div className="space-y-1 max-h-56 overflow-y-auto -mx-1 px-1">
            {filtered.map(g => {
              const isSelected = selected?.id === g.id
              return (
                <button
                  key={g.id}
                  onClick={() => setSelected(isSelected ? null : g)}
                  className={`w-full flex items-center gap-3 rounded-xl p-3 text-left transition-all border ${
                    isSelected
                      ? "bg-indigo-600/10 border-indigo-500/25 text-foreground"
                      : "border-transparent hover:bg-white/[0.04] text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className={`flex w-8 h-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    isSelected ? "bg-indigo-600/20" : "bg-white/[0.06]"
                  }`}>
                    {g.type === "channel"
                      ? <Hash className={`w-3.5 h-3.5 ${isSelected ? "text-indigo-400" : "text-muted-foreground"}`} />
                      : <Users className={`w-3.5 h-3.5 ${isSelected ? "text-indigo-400" : "text-muted-foreground"}`} />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isSelected ? "text-foreground" : ""}`}>{g.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {g.members > 0 ? `${g.members.toLocaleString("it-IT")} membri · ` : ""}
                      {g.type === "channel" ? "Canale" : "Gruppo"}
                    </p>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">
                {search ? `Nessun risultato per "${search}"` : "Nessun canale disponibile"}
              </p>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground text-center">
            {groups.length} {groups.length === 1 ? "canale trovato" : "canali trovati"}
          </p>
        </>
      )}

      {addErr && (
        <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">{addErr}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={confirm}
          disabled={!selected || addLoading}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
        >
          <Check className="w-3 h-3" />
          {addLoading ? "Aggiunta…" : "Aggiungi"}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={addLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all disabled:opacity-50"
        >
          <X className="w-3 h-3" />
          Annulla
        </button>
      </div>
    </div>
  )
}

// ── Group name/ID editor ──────────────────────────────────────────────────────

function GroupNameField({
  group,
  userId,
  onSaved,
}: {
  group: UserGroup
  userId: string
  onSaved: (fields: Partial<UserGroup>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(group.group_name)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)

  const save = async () => {
    if (!draftName.trim()) { setError("Il nome non può essere vuoto"); return }
    setLoading(true); setError(null)
    try {
      await api.updateUserGroup(userId, group.group_id, { group_name: draftName.trim() })
      onSaved({ group_name: draftName.trim() })
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore")
    } finally {
      setLoading(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 bg-black/15 border border-white/[0.07] rounded-lg px-3 py-2.5 font-mono text-sm text-foreground/80 space-y-0.5">
          <p className="font-semibold">{group.group_name}</p>
          <p className="text-xs text-muted-foreground">ID: {group.group_id}</p>
        </div>
        <button
          onClick={() => { setDraftName(group.group_name); setEditing(true) }}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all mt-1"
        >
          {saved
            ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></>
            : <><Pencil className="w-3 h-3" />Modifica</>}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={draftName}
        onChange={e => setDraftName(e.target.value)}
        className="w-full rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-sm font-mono text-foreground/90 focus:outline-none focus:border-indigo-500/50 transition-colors"
      />
      <p className="text-xs text-muted-foreground font-mono">ID (non modificabile): {group.group_id}</p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={loading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors">
          <Check className="w-3 h-3" />{loading ? "Salvataggio…" : "Salva"}
        </button>
        <button onClick={() => setEditing(false)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:text-foreground transition-all disabled:opacity-50">
          <X className="w-3 h-3" />Annulla
        </button>
      </div>
    </div>
  )
}

// ── Section row within a group ────────────────────────────────────────────────

function GroupSettingRow({
  title, badge, description, children,
}: {
  title: string; badge: string; description?: string; children: React.ReactNode
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-white/[0.04] border-white/[0.08] text-muted-foreground uppercase tracking-wide font-medium">
          {badge}
        </span>
      </div>
      {description && <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{description}</p>}
      {children}
    </div>
  )
}

// ── Textarea field with edit/save/cancel ──────────────────────────────────────

const DELETION_EXAMPLES = [
  "Chiudi immediatamente tutte le posizioni aperte correlate al segnale eliminato.",
  "Chiudi le posizioni solo se sono in profitto. Se in perdita, sposta lo stop loss al break-even e attendi.",
  "Analizza il P&L giornaliero: se positivo chiudi tutto, se negativo lascia aperto e sposta SL a break-even.",
  "Riduci di metà il volume delle posizioni aperte correlate e sposta lo SL al break-even.",
]

function TextareaField({
  value, placeholder, rows = 4, suggestions, onSave,
}: {
  value: string | null
  placeholder: string
  rows?: number
  suggestions?: string[]
  onSave: (v: string | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value ?? "")
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)

  const startEdit = () => { setDraft(value ?? ""); setError(null); setEditing(true) }
  const cancel    = () => { setEditing(false); setError(null) }

  const save = async () => {
    setLoading(true); setError(null)
    try {
      await onSave(draft.trim() || null)
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio")
    } finally {
      setLoading(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <p className={`flex-1 text-sm font-mono rounded-lg border px-3 py-2.5 min-h-[2.5rem] whitespace-pre-wrap break-words leading-relaxed ${
          value ? "bg-black/15 border-white/[0.07] text-foreground/80"
                : "bg-black/10 border-white/[0.05] text-muted-foreground/50 italic"
        }`}>
          {value ?? "Non configurata"}
        </p>
        <button onClick={startEdit} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all">
          {saved ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></> : <><Pencil className="w-3 h-3" />Modifica</>}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2.5 text-sm font-mono text-foreground/90 resize-y focus:outline-none focus:border-indigo-500/50 placeholder:text-muted-foreground/30 transition-colors"
      />
      {suggestions && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Esempi rapidi</p>
          {suggestions.map(s => (
            <button key={s} type="button" onClick={() => setDraft(s)}
              className="w-full text-left rounded-lg border border-white/[0.06] px-3 py-2 text-xs text-muted-foreground hover:border-indigo-500/25 hover:text-foreground hover:bg-indigo-600/5 transition-all flex items-start gap-2">
              <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground/40" />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={loading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors">
          <Check className="w-3 h-3" />{loading ? "Salvataggio…" : "Salva"}
        </button>
        <button onClick={cancel} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all disabled:opacity-50">
          <X className="w-3 h-3" />Annulla
        </button>
      </div>
    </div>
  )
}

// ── Range slider field ────────────────────────────────────────────────────────

function RangeField({ value, onSave }: { value: number; onSave: (v: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)

  const label = (pct: number) => {
    if (pct === 0)   return "0% — estremo favorevole"
    if (pct === 50)  return "50% — punto medio"
    if (pct === 100) return "100% — estremo opposto"
    return `${pct}% del range`
  }

  const save = async () => {
    setLoading(true); setError(null)
    try {
      await onSave(draft)
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore")
    } finally {
      setLoading(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-mono text-foreground/80 bg-black/15 border border-white/[0.07] rounded-lg px-3 py-2.5 flex-1">{label(value)}</p>
        <button onClick={() => { setDraft(value); setEditing(true) }} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all">
          {saved ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></> : <><Pencil className="w-3 h-3" />Modifica</>}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>0% — favorevole</span>
          <span className="font-mono font-semibold text-foreground text-sm">{draft}%</span>
          <span>100% — opposto</span>
        </div>
        <input type="range" min={0} max={100} step={5} value={draft} onChange={e => setDraft(Number(e.target.value))} className="w-full accent-indigo-500 cursor-pointer" />
        <p className="text-xs text-muted-foreground italic">{label(draft)}</p>
      </div>
      {error && <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={loading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors">
          <Check className="w-3 h-3" />{loading ? "Salvataggio…" : "Salva"}
        </button>
        <button onClick={() => setEditing(false)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:text-foreground transition-all disabled:opacity-50">
          <X className="w-3 h-3" />Annulla
        </button>
      </div>
    </div>
  )
}

// ── Trading hours field ───────────────────────────────────────────────────────

const ALL_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
const DAY_LABELS: Record<string, string> = {
  MON: "Lun", TUE: "Mar", WED: "Mer", THU: "Gio", FRI: "Ven", SAT: "Sab", SUN: "Dom",
}

function TradingHoursField({
  value,
  onSave,
}: {
  value: { enabled: boolean; start: number; end: number; days: string[] }
  onSave: (v: { enabled: boolean; start: number; end: number; days: string[] }) => Promise<void>
}) {
  const [editing,  setEditing]  = useState(false)
  const [enabled,  setEnabled]  = useState(value.enabled)
  const [start,    setStart]    = useState(value.start)
  const [end,      setEnd]      = useState(value.end)
  const [days,     setDays]     = useState(value.days)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [saved,    setSaved]    = useState(false)

  const startEdit = () => {
    setEnabled(value.enabled); setStart(value.start); setEnd(value.end)
    setDays(value.days); setError(null); setEditing(true)
  }

  const save = async () => {
    setLoading(true); setError(null)
    try {
      await onSave({ enabled, start, end, days })
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio")
    } finally {
      setLoading(false)
    }
  }

  const toggleDay = (day: string) =>
    setDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])

  const summaryLabel = () => {
    if (!value.enabled) return "24/7 — nessun limite"
    const daysStr = value.days.length === 7 ? "tutti i giorni"
      : value.days.length === 0 ? "nessun giorno"
      : value.days.map(d => DAY_LABELS[d] ?? d).join(", ")
    return `${String(value.start).padStart(2,"0")}:00–${String(value.end).padStart(2,"0")}:59 UTC · ${daysStr}`
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 bg-black/15 border border-white/[0.07] rounded-lg px-3 py-2.5">
          <p className={`text-sm font-mono ${value.enabled ? "text-foreground/80" : "text-muted-foreground/50 italic"}`}>
            {summaryLabel()}
          </p>
        </div>
        <button onClick={startEdit} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all mt-1">
          {saved ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></> : <><Pencil className="w-3 h-3" />Modifica</>}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Enable/disable */}
      <div className="space-y-2">
        {[
          { val: false, label: "Disattivo", desc: "Accetta segnali 24/7 senza restrizioni" },
          { val: true,  label: "Attivo",    desc: "Blocca i segnali fuori dalla fascia configurata" },
        ].map(opt => (
          <button key={String(opt.val)} type="button" onClick={() => setEnabled(opt.val)}
            className={`w-full text-left rounded-lg border px-4 py-3 transition-all ${
              enabled === opt.val
                ? "border-indigo-500/40 bg-indigo-600/8 text-foreground"
                : "border-white/[0.07] text-muted-foreground hover:border-white/[0.15] hover:text-foreground hover:bg-white/[0.02]"
            }`}>
            <div className="flex items-center gap-2">
              <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${enabled === opt.val ? "border-indigo-400 bg-indigo-400/30" : "border-white/20"}`} />
              <span className="text-sm font-medium">{opt.label}</span>
            </div>
            <p className="text-xs mt-0.5 ml-[22px] opacity-65 leading-relaxed">{opt.desc}</p>
          </button>
        ))}
      </div>

      {enabled && (
        <>
          {/* Hour range */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1.5">Ora inizio (UTC)</p>
              <input
                type="number" min={0} max={23} value={start}
                onChange={e => setStart(Math.min(23, Math.max(0, Number(e.target.value))))}
                className="w-full rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-sm font-mono text-foreground/90 focus:outline-none focus:border-indigo-500/50 transition-colors"
              />
            </div>
            <div className="pt-5 text-muted-foreground text-sm">→</div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1.5">Ora fine (UTC)</p>
              <input
                type="number" min={0} max={23} value={end}
                onChange={e => setEnd(Math.min(23, Math.max(0, Number(e.target.value))))}
                className="w-full rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-sm font-mono text-foreground/90 focus:outline-none focus:border-indigo-500/50 transition-colors"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1">
            {start <= end
              ? `Permesso dalle ${String(start).padStart(2,"0")}:00 alle ${String(end).padStart(2,"0")}:59 UTC`
              : `Overnight: dalle ${String(start).padStart(2,"0")}:00 alle ${String(end).padStart(2,"0")}:59 UTC (+1g)`}
          </p>

          {/* Day selector */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Giorni abilitati</p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_DAYS.map(day => (
                <button
                  key={day} type="button" onClick={() => toggleDay(day)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                    days.includes(day)
                      ? "border-indigo-500/40 bg-indigo-600/12 text-indigo-300"
                      : "border-white/[0.08] text-muted-foreground hover:border-white/[0.15] hover:text-foreground"
                  }`}
                >
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={loading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors">
          <Check className="w-3 h-3" />{loading ? "Salvataggio…" : "Salva"}
        </button>
        <button onClick={() => setEditing(false)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all disabled:opacity-50">
          <X className="w-3 h-3" />Annulla
        </button>
      </div>
    </div>
  )
}

// ── Trust Score tag ───────────────────────────────────────────────────────────

function TrustScoreTag({ score }: { score: TrustScore | null }) {
  if (score === null) return null
  if (score.score === null) return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-white/[0.03] border-white/[0.07] text-muted-foreground/50 font-medium">
      —
    </span>
  )
  const color =
    score.score >= 75 ? "text-emerald-400 border-emerald-500/30 bg-emerald-600/8"
    : score.score >= 55 ? "text-blue-400 border-blue-500/30 bg-blue-600/8"
    : score.score >= 35 ? "text-amber-400 border-amber-500/30 bg-amber-600/8"
    : "text-red-400 border-red-500/30 bg-red-600/8"
  const bd = score.breakdown
  const tooltipLines = [
    `Trust Score: ${score.score}/100 — ${score.label}`,
    `${score.trade_count} trade`,
    ...(score.win_rate    != null ? [`Win rate: ${score.win_rate}%`] : []),
    ...(score.profit_factor != null ? [`PF: ${score.profit_factor.toFixed(2)}`] : []),
    ...(score.max_consecutive_losses != null ? [`Max losses: ${score.max_consecutive_losses}`] : []),
    ...(bd ? [
      `Breakdown: WR ${bd.win_rate_pts}pt · PF ${bd.profit_factor_pts}pt · Vol ${bd.volume_pts}pt · Exec ${bd.exec_rate_pts}pt · Streak ${bd.streak_pts}pt`,
    ] : []),
  ]
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold shrink-0 cursor-help ${color}`}
      title={tooltipLines.join("\n")}>
      TS {score.score}
    </span>
  )
}

// ── Confidence filter field ───────────────────────────────────────────────────

function ConfidenceField({ value, onSave }: { value: number; onSave: (v: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)

  const label = (v: number) =>
    v === 0 ? "0 — Accetta tutti i segnali"
    : v >= 80 ? `${v} — Solo segnali molto chiari`
    : v >= 50 ? `${v} — Segnali sufficientemente chiari`
    : `${v} — Soglia bassa`

  const save = async () => {
    setLoading(true); setError(null)
    try {
      await onSave(draft)
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore")
    } finally {
      setLoading(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-mono flex-1 rounded-lg border px-3 py-2.5 ${
          value > 0
            ? "bg-black/15 border-white/[0.07] text-foreground/80"
            : "bg-black/10 border-white/[0.05] text-muted-foreground/50 italic"
        }`}>{label(value)}</p>
        <button onClick={() => { setDraft(value); setEditing(true) }} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all">
          {saved ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></> : <><Pencil className="w-3 h-3" />Modifica</>}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>0 — tutto</span>
          <span className="font-mono font-semibold text-foreground text-sm">{draft}</span>
          <span>100 — massima</span>
        </div>
        <input type="range" min={0} max={100} step={10} value={draft} onChange={e => setDraft(Number(e.target.value))} className="w-full accent-indigo-500 cursor-pointer" />
        <p className="text-xs text-muted-foreground italic">{label(draft)}</p>
      </div>
      {error && <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={loading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors">
          <Check className="w-3 h-3" />{loading ? "Salvataggio…" : "Salva"}
        </button>
        <button onClick={() => setEditing(false)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:text-foreground transition-all disabled:opacity-50">
          <X className="w-3 h-3" />Annulla
        </button>
      </div>
    </div>
  )
}

// ── Eco calendar field ────────────────────────────────────────────────────────

function EcoCalendarField({
  value,
  onSave,
}: {
  value: { enabled: boolean; window: number; strategy: string | null }
  onSave: (v: { enabled: boolean; window: number; strategy: string | null }) => Promise<void>
}) {
  const [editing, setEditing]       = useState(false)
  const [enabled, setEnabled]       = useState(value.enabled)
  const [window_, setWindow]        = useState(value.window)
  const [strategy, setStrategy]     = useState(value.strategy ?? "")
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [saved, setSaved]           = useState(false)

  const startEdit = () => {
    setEnabled(value.enabled); setWindow(value.window); setStrategy(value.strategy ?? "")
    setError(null); setEditing(true)
  }

  const save = async () => {
    setLoading(true); setError(null)
    try {
      await onSave({ enabled, window: window_, strategy: strategy.trim() || null })
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore")
    } finally {
      setLoading(false)
    }
  }

  const summaryLabel = () => {
    if (!value.enabled) return "Disabilitato"
    const base = `Attivo — finestra ±${value.window} minuti`
    return value.strategy ? `${base} · con strategia AI` : base
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 bg-black/15 border border-white/[0.07] rounded-lg px-3 py-2.5 space-y-0.5">
          <p className={`text-sm font-mono ${value.enabled ? "text-foreground/80" : "text-muted-foreground/50 italic"}`}>
            {summaryLabel()}
          </p>
          {value.enabled && value.strategy && (
            <p className="text-xs text-muted-foreground truncate">Strategia: {value.strategy}</p>
          )}
        </div>
        <button onClick={startEdit} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all mt-1">
          {saved ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></> : <><Pencil className="w-3 h-3" />Modifica</>}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {[
          { val: false, label: "Disabilitato", desc: "Non controlla il calendario economico" },
          { val: true,  label: "Attivo",       desc: "Agisce sui segnali vicino a eventi high-impact" },
        ].map(opt => (
          <button key={String(opt.val)} type="button" onClick={() => setEnabled(opt.val)}
            className={`w-full text-left rounded-lg border px-4 py-3 transition-all ${
              enabled === opt.val
                ? "border-indigo-500/40 bg-indigo-600/8 text-foreground"
                : "border-white/[0.07] text-muted-foreground hover:border-white/[0.15] hover:text-foreground hover:bg-white/[0.02]"
            }`}>
            <div className="flex items-center gap-2">
              <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${enabled === opt.val ? "border-indigo-400 bg-indigo-400/30" : "border-white/20"}`} />
              <span className="text-sm font-medium">{opt.label}</span>
            </div>
            <p className="text-xs mt-0.5 ml-[22px] opacity-65">{opt.desc}</p>
          </button>
        ))}
      </div>

      {enabled && (
        <>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Finestra (minuti prima/dopo l&apos;evento)</p>
            <div className="flex items-center gap-2">
              <input
                type="number" min={5} max={120} value={window_}
                onChange={e => setWindow(Math.min(120, Math.max(5, Number(e.target.value))))}
                className="w-24 rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-sm font-mono text-foreground/90 focus:outline-none focus:border-indigo-500/50 transition-colors"
              />
              <span className="text-xs text-muted-foreground">min (5–120)</span>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Strategia AI in caso di evento (opzionale)</p>
            <textarea
              value={strategy}
              onChange={e => setStrategy(e.target.value)}
              rows={3}
              placeholder="Es: Riduci il lotto al 50% e imposta SL più ampio del normale"
              className="w-full rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2.5 text-sm font-mono text-foreground/90 resize-y focus:outline-none focus:border-indigo-500/50 placeholder:text-muted-foreground/30 transition-colors"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Se impostata, l&apos;AI inietta questa strategia nel prompt invece di bloccare il segnale.
            </p>
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={loading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors">
          <Check className="w-3 h-3" />{loading ? "Salvataggio…" : "Salva"}
        </button>
        <button onClick={() => setEditing(false)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:text-foreground transition-all disabled:opacity-50">
          <X className="w-3 h-3" />Annulla
        </button>
      </div>
    </div>
  )
}

// ── Radio / option field ──────────────────────────────────────────────────────

function RadioField({
  value, options, onSave,
}: {
  value: boolean
  options: { val: boolean; label: string; desc: string }[]
  onSave: (v: boolean) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)

  const current = options.find(o => o.val === value)!

  const save = async () => {
    setLoading(true); setError(null)
    try {
      await onSave(draft)
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore")
    } finally {
      setLoading(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 bg-black/15 border border-white/[0.07] rounded-lg px-3 py-2.5">
          <p className="text-sm font-medium text-foreground/80">{current.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{current.desc}</p>
        </div>
        <button onClick={() => { setDraft(value); setEditing(true) }} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all mt-1">
          {saved ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></> : <><Pencil className="w-3 h-3" />Modifica</>}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {options.map(opt => (
          <button key={String(opt.val)} type="button" onClick={() => setDraft(opt.val)}
            className={`w-full text-left rounded-lg border px-4 py-3 transition-all ${
              draft === opt.val
                ? "border-indigo-500/40 bg-indigo-600/8 text-foreground"
                : "border-white/[0.07] text-muted-foreground hover:border-white/[0.15] hover:text-foreground hover:bg-white/[0.02]"
            }`}>
            <div className="flex items-center gap-2">
              <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${draft === opt.val ? "border-indigo-400 bg-indigo-400/30" : "border-white/20"}`} />
              <span className="text-sm font-medium">{opt.label}</span>
            </div>
            <p className="text-xs mt-0.5 ml-[22px] opacity-65 leading-relaxed">{opt.desc}</p>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={loading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors">
          <Check className="w-3 h-3" />{loading ? "Salvataggio…" : "Salva"}
        </button>
        <button onClick={() => setEditing(false)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:text-foreground transition-all disabled:opacity-50">
          <X className="w-3 h-3" />Annulla
        </button>
      </div>
    </div>
  )
}
