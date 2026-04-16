"use client"

import { useState } from "react"
import { Trash2, AlertTriangle, Loader2 } from "lucide-react"
import { type DashboardUserResponse, type SignalLog, api } from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(iso: string, short = false): string {
  try {
    if (short) {
      return new Date(iso).toLocaleString("it-IT", {
        day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit",
      })
    }
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
  } catch { return iso }
}

// ── Overview page ─────────────────────────────────────────────────────────────

export function OverviewPage({
  data,
}: {
  data: DashboardUserResponse
  onUserUpdate: (d: DashboardUserResponse) => void
}) {
  const { user, logs, total_logs } = data
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  async function handleReset() {
    setResetLoading(true)
    setResetError(null)
    try {
      await api.resetUserStats(user.user_id)
      window.location.reload()
    } catch {
      setResetError("Errore durante il reset. Riprova.")
      setResetLoading(false)
    }
  }

  const signals    = logs.filter(l => l.is_signal).length
  const allResults = logs.flatMap(l => l.results_json ?? [])
  const okOrders   = allResults.filter(r => r.success).length
  const failOrders = allResults.filter(r => !r.success).length
  const errors     = logs.filter(l => l.error_step).length
  const signalRate = logs.length > 0 ? (signals / logs.length) * 100 : 0
  const execRate   = allResults.length > 0 ? (okOrders / allResults.length) * 100 : 0

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">

      {/* Page title */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Panoramica</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Riepilogo account e attività recente
        </p>
      </div>

      {/* Top section: profile + KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Profile card */}
        <ProfileCard user={user} />

        {/* KPI grid */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiTile
            icon="💬" label="Messaggi totali"
            value={total_logs}
            color="text-foreground"
          />
          <KpiTile
            icon="📡" label="Segnali rilevati"
            value={signals}
            sub={`${signalRate.toFixed(1)}% rilevati`}
            color="text-amber-400"
          />
          <KpiTile
            icon="📋" label="Ordini inviati"
            value={allResults.length}
            color="text-indigo-400"
          />
          <KpiTile
            icon="✅" label="Ordini OK"
            value={okOrders}
            sub={allResults.length > 0 ? `${execRate.toFixed(1)}% successo` : undefined}
            color="text-emerald-400"
          />
          <KpiTile
            icon="❌" label="Ordini falliti"
            value={failOrders}
            color={failOrders > 0 ? "text-red-400" : "text-muted-foreground"}
          />
          <KpiTile
            icon="⚠️" label="Errori pipeline"
            value={errors}
            color={errors > 0 ? "text-orange-400" : "text-muted-foreground"}
          />
        </div>
      </div>

      {/* Strategies quick-view */}
      <div>
        <SectionHeading>Strategie configurate</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <StrategyPreview label="Sizing" value={user.sizing_strategy} />
          <StrategyPreview label="Management" value={user.management_strategy} />
          <StrategyPreview label="Messaggi eliminati" value={user.deletion_strategy} />
          <div className="rounded-xl border border-white/[0.07] bg-card/40 px-4 py-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Parametri di ingresso
            </p>
            <div className="flex flex-col gap-1 text-xs font-mono text-foreground/80">
              <span>Range entry: <span className="text-indigo-300">{user.range_entry_pct ?? 0}%</span></span>
              <span>Favorevole: <span className={user.entry_if_favorable ? "text-emerald-400" : "text-muted-foreground"}>
                {user.entry_if_favorable ? "Attivo" : "Disattivo"}
              </span></span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div>
        <SectionHeading>Attività recente</SectionHeading>
        <div className="mt-3 space-y-2">
          {logs.slice(0, 8).map(log => (
            <RecentLogRow key={log.id} log={log} />
          ))}
          {logs.length === 0 && (
            <EmptyTableRow>Nessuna attività registrata</EmptyTableRow>
          )}
        </div>
      </div>

      {/* Danger zone */}
      <div>
        <SectionHeading>Zona pericolosa</SectionHeading>
        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Reimposta statistiche</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Elimina tutti i log segnali, i log AI e le operazioni chiuse. Le impostazioni,
                le strategie e le credenziali non vengono modificate.
              </p>
            </div>
          </div>

          {resetError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {resetError}
            </p>
          )}

          {!resetConfirm ? (
            <button
              type="button"
              onClick={() => setResetConfirm(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 rounded-lg px-3 py-1.5 transition-colors"
            >
              <Trash2 className="size-3.5" />
              Reimposta statistiche
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-xs text-red-300 font-medium">Sei sicuro? Questa azione è irreversibile.</p>
              <button
                type="button"
                onClick={handleReset}
                disabled={resetLoading}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60 rounded-lg px-3 py-1.5 transition-colors"
              >
                {resetLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {resetLoading ? "Reset…" : "Conferma reset"}
              </button>
              <button
                type="button"
                onClick={() => { setResetConfirm(false); setResetError(null) }}
                disabled={resetLoading}
                className="text-xs text-muted-foreground hover:text-foreground border border-white/[0.07] hover:border-white/[0.15] rounded-lg px-3 py-1.5 transition-colors"
              >
                Annulla
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProfileCard({ user }: { user: DashboardUserResponse["user"] }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-card/40 p-5 space-y-4">
      {/* Avatar row */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600/15 border border-indigo-500/25 flex items-center justify-center text-indigo-400 font-bold text-base select-none shrink-0">
          {user.phone.slice(-2)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{user.phone}</p>
          <p className="text-xs text-muted-foreground truncate">{user.group_name}</p>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-white/[0.06]" />

      {/* Fields */}
      <dl className="space-y-3">
        {[
          { label: "User ID",     value: user.user_id },
          { label: "Gruppo ID",   value: String(user.group_id) },
          { label: "MT5 Login",   value: user.mt5_login ? String(user.mt5_login) : "—" },
          { label: "MT5 Server",  value: user.mt5_server ?? "—" },
          { label: "Registrato",  value: formatTs(user.created_at) },
        ].map(({ label, value }) => (
          <div key={label}>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
              {label}
            </dt>
            <dd className="text-xs font-mono text-foreground/75 break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function KpiTile({
  icon, label, value, sub, color,
}: {
  icon: string
  label: string
  value: number
  sub?: string
  color: string
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-card/40 px-4 py-4 flex flex-col gap-1.5 hover:border-white/[0.12] transition-colors">
      <span className="text-lg leading-none">{icon}</span>
      <p className={`text-2xl font-bold font-mono leading-none mt-0.5 ${color}`}>
        {value.toLocaleString("it-IT")}
      </p>
      <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground/55 leading-tight">{sub}</p>}
    </div>
  )
}

function StrategyPreview({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-card/40 px-4 py-3 space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-xs font-mono text-foreground/70 line-clamp-2 leading-relaxed">
        {value ?? <span className="text-muted-foreground/40 italic">Non configurata</span>}
      </p>
    </div>
  )
}

function RecentLogRow({ log }: { log: SignalLog }) {
  const hasResults = log.results_json && log.results_json.length > 0
  const hasError   = Boolean(log.error_step)
  const okCount    = log.results_json?.filter(r => r.success).length ?? 0

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-card/30 px-4 py-2.5">
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 ${
        hasError    ? "bg-red-400" :
        hasResults  ? (okCount > 0 ? "bg-emerald-400" : "bg-red-400") :
        log.is_signal ? "bg-amber-400" :
        "bg-white/[0.15]"
      }`} />

      {/* Timestamp */}
      <span className="text-[11px] font-mono text-muted-foreground shrink-0 w-[108px]">
        {formatTs(log.ts, true)}
      </span>

      {/* Badges */}
      <div className="flex items-center gap-1.5 shrink-0">
        {log.is_signal && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-600/10 text-amber-400 border-amber-500/20">
            SIG
          </span>
        )}
        {hasResults && okCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-600/10 text-emerald-400 border-emerald-500/20">
            {okCount} OK
          </span>
        )}
        {hasError && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-600/10 text-red-400 border-red-500/20">
            ERR
          </span>
        )}
      </div>

      {/* Message preview */}
      <span className="text-xs text-muted-foreground/60 truncate italic flex-1 min-w-0">
        {log.message_text.slice(0, 72)}{log.message_text.length > 72 ? "…" : ""}
      </span>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-sm font-semibold text-foreground">{children}</h2>
      <div className="flex-1 h-px bg-white/[0.05]" />
    </div>
  )
}

function EmptyTableRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-card/30 px-4 py-10 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
