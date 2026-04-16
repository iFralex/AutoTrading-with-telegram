"use client"

import { useState } from "react"
import { api, type DashboardUserResponse } from "@/src/lib/api"
import { Check, Pencil, X, ChevronRight } from "lucide-react"

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPage({
  data,
  onUserUpdate,
}: {
  data: DashboardUserResponse
  onUserUpdate: (d: DashboardUserResponse) => void
}) {
  const { user } = data

  const patch = (fields: Partial<typeof user>) =>
    onUserUpdate({ ...data, user: { ...user, ...fields } })

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">

      <div>
        <h1 className="text-xl font-semibold text-foreground">Configurazione</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Strategie AI e parametri di esecuzione per questo utente
        </p>
      </div>

      {/* ── Extraction instructions ──────────────────────────────────────── */}
      <SettingsSection
        title="Istruzioni di estrazione"
        description="Regole custom iniettate nel prompt Pro per modificare il comportamento di estrazione dei segnali. Es: aggiungi .s a tutti i simboli (EURUSD → EURUSD.s)"
        badge="AI prompt"
      >
        <TextareaField
          value={user.extraction_instructions}
          placeholder={"Es: Per tutti i simboli, aggiungi il suffisso .s alla fine (es: EURUSD → EURUSD.s, XAUUSD → XAUUSD.s)."}
          rows={3}
          onSave={async v => {
            await api.updateExtractionInstructions(user.user_id, v)
            patch({ extraction_instructions: v })
          }}
        />
      </SettingsSection>

      {/* ── Sizing strategy ──────────────────────────────────────────────── */}
      <SettingsSection
        title="Sizing Strategy"
        description="Istruzione iniettata nel prompt AI per il calcolo del lotto"
        badge="AI prompt"
      >
        <TextareaField
          value={user.sizing_strategy}
          placeholder="Es: Usa sempre il 2% del balance come rischio per trade, con SL in pips dal segnale."
          rows={4}
          onSave={async v => {
            await api.updateSizingStrategy(user.user_id, v)
            patch({ sizing_strategy: v })
          }}
        />
      </SettingsSection>

      {/* ── Management strategy ──────────────────────────────────────────── */}
      <SettingsSection
        title="Management Strategy"
        description="Descrizione della strategia di gestione delle posizioni (eseguita dall'AI agent)"
        badge="AI agent"
      >
        <TextareaField
          value={user.management_strategy}
          placeholder="Es: Sposta lo stop loss al break-even quando il prezzo raggiunge il 50% del target. Chiudi metà posizione al primo TP."
          rows={4}
          onSave={async v => {
            await api.updateManagementStrategy(user.user_id, v)
            patch({ management_strategy: v })
          }}
        />
      </SettingsSection>

      {/* ── Deletion strategy ────────────────────────────────────────────── */}
      <SettingsSection
        title="Strategia messaggi eliminati"
        description="Cosa deve fare l'AI quando il canale elimina un messaggio che aveva generato segnali"
        badge="AI agent"
      >
        <TextareaField
          value={user.deletion_strategy}
          placeholder="Es: Chiudi immediatamente tutte le posizioni aperte correlate al segnale eliminato."
          rows={5}
          suggestions={DELETION_EXAMPLES}
          onSave={async v => {
            await api.updateDeletionStrategy(user.user_id, v)
            patch({ deletion_strategy: v })
          }}
        />
      </SettingsSection>

      {/* ── Range entry pct ──────────────────────────────────────────────── */}
      <SettingsSection
        title="Posizione nel range di ingresso"
        description="Dove piazzare il limite quando il segnale indica un range di entry"
        badge="ordini"
      >
        <RangeField
          value={user.range_entry_pct ?? 0}
          onSave={async v => {
            await api.updateRangeEntryPct(user.user_id, v)
            patch({ range_entry_pct: v })
          }}
        />
      </SettingsSection>

      {/* ── Entry if favorable ───────────────────────────────────────────── */}
      <SettingsSection
        title="Ingresso a mercato se prezzo favorevole"
        description="Se il prezzo corrente è già più favorevole del target calcolato, entra subito a mercato invece di piazzare un ordine pendente"
        badge="ordini"
      >
        <RadioField
          value={user.entry_if_favorable ?? false}
          options={[
            {
              val: true,
              label: "Attivo",
              desc: "Se ask (BUY) o bid (SELL) è già dentro/oltre il target, entra a mercato immediatamente",
            },
            {
              val: false,
              label: "Disattivo",
              desc: "Piazza sempre l'ordine pendente al prezzo target calcolato (comportamento predefinito)",
            },
          ]}
          onSave={async v => {
            await api.updateEntryIfFavorable(user.user_id, v)
            patch({ entry_if_favorable: v })
          }}
        />
      </SettingsSection>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function SettingsSection({
  title,
  description,
  badge,
  children,
}: {
  title: string
  description: string
  badge: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-card/40 overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-white/[0.04] border-white/[0.08] text-muted-foreground uppercase tracking-wide font-medium">
                {badge}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          </div>
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
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
  value,
  placeholder,
  rows = 4,
  suggestions,
  onSave,
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
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio")
    } finally {
      setLoading(false)
    }
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <p className={`flex-1 text-sm font-mono rounded-lg border px-3 py-2.5 min-h-[2.5rem] whitespace-pre-wrap break-words leading-relaxed ${
            value
              ? "bg-black/15 border-white/[0.07] text-foreground/80"
              : "bg-black/10 border-white/[0.05] text-muted-foreground/50 italic"
          }`}>
            {value ?? "Non configurata"}
          </p>
          <button
            onClick={startEdit}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all"
          >
            {saved
              ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></>
              : <><Pencil className="w-3 h-3" />Modifica</>
            }
          </button>
        </div>
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
        className="
          w-full rounded-lg border border-white/[0.1] bg-black/25
          px-3 py-2.5 text-sm font-mono text-foreground/90
          resize-y focus:outline-none focus:border-indigo-500/50
          placeholder:text-muted-foreground/30
          transition-colors
        "
      />

      {suggestions && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            Esempi rapidi
          </p>
          {suggestions.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setDraft(s)}
              className="w-full text-left rounded-lg border border-white/[0.06] px-3 py-2 text-xs text-muted-foreground hover:border-indigo-500/25 hover:text-foreground hover:bg-indigo-600/5 transition-all flex items-start gap-2"
            >
              <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground/40" />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors"
        >
          <Check className="w-3 h-3" />
          {loading ? "Salvataggio…" : "Salva"}
        </button>
        <button
          onClick={cancel}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all disabled:opacity-50"
        >
          <X className="w-3 h-3" />
          Annulla
        </button>
      </div>
    </div>
  )
}

// ── Range slider field ────────────────────────────────────────────────────────

function RangeField({
  value,
  onSave,
}: {
  value: number
  onSave: (v: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)

  const label = (pct: number) => {
    if (pct === 0)   return "Estremo favorevole (0% — BUY al minimo, SELL al massimo)"
    if (pct === 50)  return "Punto medio del range (50%)"
    if (pct === 100) return "Estremo opposto (100% — BUY al massimo, SELL al minimo)"
    return `${pct}% del range`
  }

  const save = async () => {
    setLoading(true); setError(null)
    try {
      await onSave(draft)
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio")
    } finally {
      setLoading(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-mono text-foreground/80 bg-black/15 border border-white/[0.07] rounded-lg px-3 py-2.5 flex-1">
          {label(value)}
        </p>
        <button
          onClick={() => { setDraft(value); setEditing(true) }}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all"
        >
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
        <input
          type="range"
          min={0} max={100} step={5}
          value={draft}
          onChange={e => setDraft(Number(e.target.value))}
          className="w-full accent-indigo-500 cursor-pointer"
        />
        <p className="text-xs text-muted-foreground italic">{label(draft)}</p>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors"
        >
          <Check className="w-3 h-3" />
          {loading ? "Salvataggio…" : "Salva"}
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all disabled:opacity-50"
        >
          <X className="w-3 h-3" />
          Annulla
        </button>
      </div>
    </div>
  )
}

// ── Radio / option field ──────────────────────────────────────────────────────

function RadioField({
  value,
  options,
  onSave,
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
      setEditing(false)
      setSaved(true)
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
        <div className="flex-1 bg-black/15 border border-white/[0.07] rounded-lg px-3 py-2.5">
          <p className="text-sm font-medium text-foreground/80">{current.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{current.desc}</p>
        </div>
        <button
          onClick={() => { setDraft(value); setEditing(true) }}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all mt-1"
        >
          {saved ? <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Salvato</span></> : <><Pencil className="w-3 h-3" />Modifica</>}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {options.map(opt => (
          <button
            key={String(opt.val)}
            type="button"
            onClick={() => setDraft(opt.val)}
            className={`w-full text-left rounded-lg border px-4 py-3 transition-all ${
              draft === opt.val
                ? "border-indigo-500/40 bg-indigo-600/8 text-foreground"
                : "border-white/[0.07] text-muted-foreground hover:border-white/[0.15] hover:text-foreground hover:bg-white/[0.02]"
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${
                draft === opt.val ? "border-indigo-400 bg-indigo-400/30" : "border-white/20"
              }`} />
              <span className="text-sm font-medium">{opt.label}</span>
            </div>
            <p className="text-xs mt-0.5 ml-5.5 opacity-65 leading-relaxed">{opt.desc}</p>
          </button>
        ))}
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-600/8 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors"
        >
          <Check className="w-3 h-3" />
          {loading ? "Salvataggio…" : "Salva"}
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-white/[0.08] hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.05] transition-all disabled:opacity-50"
        >
          <X className="w-3 h-3" />
          Annulla
        </button>
      </div>
    </div>
  )
}
