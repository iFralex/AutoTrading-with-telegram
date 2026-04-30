"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Radio, TrendingUp, Target, Layers,
  ArrowRight, CheckCircle2, XCircle, AlertCircle, Clock,
  BarChart3, Play, Loader2, LogOut, Wallet,
} from "lucide-react"
import { useDashboard } from "@/src/components/dashboard/DashboardContext"
import { api } from "@/src/lib/api"
import type { SignalLog } from "@/src/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit",
    })
  } catch { return iso }
}

function fmtCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent, icon: Icon,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: "emerald" | "cyan" | "amber" | "default"
  icon: React.ComponentType<{ className?: string }>
}) {
  const iconColors: Record<string, string> = {
    emerald: "text-emerald-400",
    cyan:    "text-cyan-400",
    amber:   "text-amber-400",
    default: "text-white/40",
  }
  const valColors: Record<string, string> = {
    emerald: "text-emerald-400",
    cyan:    "text-cyan-400",
    amber:   "text-amber-400",
    default: "text-white",
  }
  const a = accent ?? "default"
  return (
    <div className="rounded-2xl border border-white/[0.08] p-5 flex flex-col gap-3 hover:border-white/[0.14] transition-colors"
      style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white/35">{label}</span>
        <Icon className={`w-4 h-4 ${iconColors[a]}`} />
      </div>
      <p className={`text-3xl font-black leading-none ${valColors[a]}`}>{value}</p>
      {sub && <p className="text-xs text-white/35">{sub}</p>}
    </div>
  )
}

function ActivityRow({ log }: { log: SignalLog }) {
  const results   = log.results_json ?? []
  const okCount   = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length
  const hasOrder  = results.length > 0
  const hasError  = Boolean(log.error_step)

  const signal = log.signals_json?.[0]

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.05] hover:border-white/[0.10] hover:bg-white/[0.02] transition-all cursor-default">
      {/* Status icon */}
      <div className="shrink-0">
        {hasError
          ? <XCircle className="w-4 h-4 text-red-400" />
          : hasOrder && okCount > 0
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            : hasOrder && failCount > 0
              ? <XCircle className="w-4 h-4 text-red-400" />
              : log.is_signal
                ? <AlertCircle className="w-4 h-4 text-amber-400" />
                : <Clock className="w-4 h-4 text-white/20" />
        }
      </div>

      {/* Timestamp */}
      <span className="text-[11px] font-mono text-white/30 shrink-0 w-[102px]">{fmtTs(log.ts)}</span>

      {/* Signal badge */}
      {log.is_signal && signal && (
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
          signal.order_type === "BUY"
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-red-500/10 text-red-400 border-red-500/20"
        }`}>
          {signal.order_type} {signal.symbol}
        </span>
      )}
      {log.is_signal && !signal && (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20 shrink-0">
          Signal
        </span>
      )}

      {/* Order result */}
      {hasOrder && (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${
          okCount > 0
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-red-500/10 text-red-400 border-red-500/20"
        }`}>
          {okCount > 0 ? `✓ ${okCount} order${okCount > 1 ? "s" : ""}` : `✗ failed`}
        </span>
      )}

      {/* Message preview */}
      <span className="text-xs text-white/25 truncate flex-1 min-w-0 italic">
        {log.message_text.slice(0, 80)}
        {log.message_text.length > 80 ? "…" : ""}
      </span>
    </div>
  )
}

// ── Loading screen ─────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-3">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
        <p className="text-sm text-white/40">Loading your account…</p>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { user, logs, totalLogs, loading, reload, logout } = useDashboard()
  const [pausing, setPausing] = useState(false)

  if (loading && !user) return <LoadingScreen />

  if (!user) return null

  // Compute KPIs from recent logs
  const signals     = logs.filter(l => l.is_signal).length
  const allResults  = logs.flatMap(l => l.results_json ?? [])
  const okOrders    = allResults.filter(r => r.success).length
  const winRate     = allResults.length > 0 ? (okOrders / allResults.length) * 100 : null
  const activeRooms = user.groups.filter(g => g.active).length

  const lastAccount = logs.find(l => l.account_info)?.account_info

  async function handleResume() {
    if (!user) return
    setPausing(true)
    try {
      await api.resumeDrawdown(user.user_id)
      await reload()
    } catch { /* ignore */ }
    finally { setPausing(false) }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white">Overview</h2>
          <p className="text-sm text-white/35 mt-0.5">
            {totalLogs.toLocaleString()} messages monitored across {user.groups.length} room{user.groups.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!user.active && (
            <button
              onClick={handleResume}
              disabled={pausing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/10 transition-all"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              {pausing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Resume bot
            </button>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-white/[0.08] text-white/35 hover:text-white/60 hover:border-white/[0.16] transition-all"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </div>

      {/* ── KPI row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Signals detected" value={signals} sub={`of ${logs.length} messages`} accent="cyan" icon={Radio} />
        <KpiCard label="Orders executed" value={okOrders} sub={`${allResults.length} attempts`} accent="emerald" icon={TrendingUp} />
        <KpiCard label="Win rate" value={winRate !== null ? `${winRate.toFixed(1)}%` : "—"} sub="executed orders" accent={winRate !== null && winRate >= 60 ? "emerald" : "amber"} icon={Target} />
        <KpiCard label="Active rooms" value={activeRooms} sub={`${user.groups.length} total`} icon={Layers} />
      </div>

      {/* ── Account info + Activity ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Account card */}
        <div className="rounded-2xl border border-white/[0.08] p-5 space-y-4"
          style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">MT5 Account</span>
            <Wallet className="w-4 h-4 text-white/25" />
          </div>

          {lastAccount ? (
            <div className="space-y-3">
              {[
                { label: "Balance", value: fmtCurrency(lastAccount.balance, lastAccount.currency) },
                { label: "Equity",  value: fmtCurrency(lastAccount.equity, lastAccount.currency) },
                { label: "Free margin", value: fmtCurrency(lastAccount.free_margin, lastAccount.currency) },
                { label: "Leverage", value: `1:${lastAccount.leverage}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-white/35">{label}</span>
                  <span className="text-sm font-mono font-semibold text-white">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center">
              <p className="text-xs text-white/25">No account snapshot available yet.</p>
              <p className="text-[11px] text-white/15 mt-1">Will appear after the first signal.</p>
            </div>
          )}

          {/* MT5 server info */}
          <div className="pt-3 border-t border-white/[0.06] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25 uppercase tracking-wider">Login</span>
              <span className="text-[11px] font-mono text-white/40">{user.mt5_login ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25 uppercase tracking-wider">Server</span>
              <span className="text-[11px] font-mono text-white/40 truncate max-w-[140px]">{user.mt5_server ?? "—"}</span>
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div className="lg:col-span-2 rounded-2xl border border-white/[0.08] p-5 space-y-3"
          style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">Recent activity</span>
            <Link
              href="/dashboard/signals"
              className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {logs.length === 0 ? (
            <div className="py-10 text-center">
              <BarChart3 className="w-8 h-8 text-white/10 mx-auto mb-2" />
              <p className="text-sm text-white/25">No activity yet</p>
              <p className="text-xs text-white/15 mt-1">Signals will appear here once your bot starts processing messages</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {logs.slice(0, 8).map(log => (
                <ActivityRow key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Quick links ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { href: "/dashboard/trades",    label: "View trades",    Icon: TrendingUp, color: "text-emerald-400" },
          { href: "/dashboard/backtest",  label: "Run backtest",   Icon: BarChart3,  color: "text-cyan-400" },
          { href: "/dashboard/community", label: "Community",      Icon: Target,     color: "text-amber-400" },
          { href: "/dashboard/rooms",     label: "Manage rooms",   Icon: Layers,     color: "text-white/50" },
        ].map(({ href, label, Icon, color }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02] transition-all group"
          >
            <Icon className={`w-4 h-4 ${color} shrink-0`} />
            <span className="text-xs font-medium text-white/50 group-hover:text-white/70 transition-colors">{label}</span>
            <ArrowRight className="w-3 h-3 text-white/20 ml-auto group-hover:text-white/40 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}
