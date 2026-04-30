"use client"

import { useState, useCallback } from "react"
import {
  CheckCircle2, XCircle, Clock, AlertCircle,
  ChevronDown, Loader2, RefreshCw,
} from "lucide-react"
import { useDashboard } from "@/src/components/dashboard/DashboardContext"
import { api, type SignalLog } from "@/src/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch { return iso }
}

function entryLabel(ep: number | [number, number] | null): string {
  if (ep === null) return "Market"
  if (Array.isArray(ep)) return `${ep[0]}–${ep[1]}`
  return String(ep)
}

type Filter = "all" | "signals" | "orders"

function filterLogs(logs: SignalLog[], f: Filter): SignalLog[] {
  if (f === "signals") return logs.filter(l => l.is_signal)
  if (f === "orders")  return logs.filter(l => (l.results_json?.length ?? 0) > 0)
  return logs
}

// ── Row ───────────────────────────────────────────────────────────────────────

function LogRow({ log }: { log: SignalLog }) {
  const [expanded, setExpanded] = useState(false)
  const results  = log.results_json ?? []
  const okCount  = results.filter(r => r.success).length
  const hasOrder = results.length > 0
  const hasError = Boolean(log.error_step)
  const signal   = log.signals_json?.[0]

  return (
    <div className="rounded-xl border border-white/[0.07] overflow-hidden transition-colors hover:border-white/[0.12]"
      style={{ background: "rgba(255,255,255,0.025)" }}>

      {/* Main row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => (log.is_signal || hasError) && setExpanded(e => !e)}
      >
        {/* Status icon */}
        <div className="shrink-0">
          {hasError
            ? <XCircle className="w-4 h-4 text-red-400" />
            : hasOrder && okCount > 0
              ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              : hasOrder
                ? <XCircle className="w-4 h-4 text-red-400" />
                : log.is_signal
                  ? <AlertCircle className="w-4 h-4 text-amber-400" />
                  : <Clock className="w-4 h-4 text-white/15" />
          }
        </div>

        {/* Timestamp */}
        <span className="text-[11px] font-mono text-white/30 shrink-0 w-[136px]">{fmtTs(log.ts)}</span>

        {/* Sender */}
        {log.sender_name && (
          <span className="text-[11px] text-white/35 shrink-0 max-w-[90px] truncate">
            {log.sender_name}
          </span>
        )}

        {/* Badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          {log.is_signal && signal && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              signal.order_type === "BUY"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border-red-500/20"
            }`}>
              {signal.order_type} · {signal.symbol}
            </span>
          )}
          {log.is_signal && !signal && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">
              Signal
            </span>
          )}
          {hasOrder && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
              okCount > 0
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border-red-500/20"
            }`}>
              {okCount > 0 ? `✓ ${okCount}` : "✗ failed"}
            </span>
          )}
        </div>

        {/* Message preview */}
        <span className="text-xs text-white/20 truncate flex-1 min-w-0 italic hidden md:block">
          {log.message_text.slice(0, 100)}{log.message_text.length > 100 ? "…" : ""}
        </span>

        {/* Expand toggle */}
        {(log.is_signal || hasError) && (
          <ChevronDown className={`w-3.5 h-3.5 text-white/25 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-white/[0.06] px-4 py-4 space-y-4">

          {/* Raw message */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/25 mb-1.5">Message</p>
            <p className="text-xs text-white/55 leading-relaxed whitespace-pre-wrap font-mono">
              {log.message_text}
            </p>
          </div>

          {/* Signals extracted */}
          {(log.signals_json?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/25 mb-2">Detected signals</p>
              <div className="space-y-2">
                {log.signals_json!.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`font-bold px-2 py-0.5 rounded border ${
                      s.order_type === "BUY"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-red-500/10 text-red-400 border-red-500/20"
                    }`}>{s.order_type}</span>
                    <span className="font-mono font-semibold text-white/80">{s.symbol}</span>
                    <span className="text-white/35">@ {entryLabel(s.entry_price)}</span>
                    {s.stop_loss   && <span className="text-white/35">SL {s.stop_loss}</span>}
                    {s.take_profit && <span className="text-white/35">TP {s.take_profit}</span>}
                    {s.lot_size    && <span className="text-white/35">{s.lot_size} lots</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Order results */}
          {results.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/25 mb-2">Order results</p>
              <div className="space-y-1.5">
                {results.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                    r.success
                      ? "bg-emerald-500/8 border border-emerald-500/15"
                      : "bg-red-500/8 border border-red-500/15"
                  }`}>
                    {r.success
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    }
                    {r.success
                      ? <span className="text-emerald-400 font-medium">Order #{r.order_id} placed</span>
                      : <span className="text-red-400">{r.error ?? "Order failed"}</span>
                    }
                    {r.signal && (
                      <span className="text-white/30 ml-auto">
                        {r.signal.order_type} {r.signal.symbol}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SignalsPage() {
  const { user, logs: initialLogs, totalLogs, loading: ctxLoading } = useDashboard()
  const [logs, setLogs]     = useState(initialLogs)
  const [total, setTotal]   = useState(totalLogs)
  const [filter, setFilter] = useState<Filter>("all")
  const [loadingMore, setLoadingMore] = useState(false)

  // Sync with context when it updates
  if (logs !== initialLogs && initialLogs.length > 0 && logs.length === 0) {
    setLogs(initialLogs)
    setTotal(totalLogs)
  }

  const loadMore = useCallback(async () => {
    if (!user) return
    setLoadingMore(true)
    try {
      const res = await api.getDashboardLogs(user.user_id, 50, logs.length)
      setLogs(prev => [...prev, ...res.logs])
      setTotal(res.total)
    } catch { /* ignore */ }
    finally { setLoadingMore(false) }
  }, [user, logs.length])

  const visible = filterLogs(logs, filter)

  const signals   = logs.filter(l => l.is_signal).length
  const withOrders = logs.filter(l => (l.results_json?.length ?? 0) > 0).length
  const okOrders  = logs.flatMap(l => l.results_json ?? []).filter(r => r.success).length

  if (ctxLoading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-white/30">Connect your account to view signals.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-white">Signal Feed</h2>
          <p className="text-sm text-white/35 mt-0.5">
            Every message monitored by your bot — {total.toLocaleString()} total
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white/40 hover:text-white/70 border border-white/[0.07] hover:border-white/[0.14] transition-all"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Signals detected", value: signals, color: "text-amber-400" },
          { label: "Orders placed",    value: withOrders, color: "text-emerald-400" },
          { label: "Orders OK",        value: okOrders, color: "text-emerald-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-white/[0.07] px-4 py-3 flex flex-col gap-0.5"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className={`text-lg font-black ${color}`}>{value}</p>
            <p className="text-[11px] text-white/30">{label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        {(["all", "signals", "orders"] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${
              filter === f
                ? "text-white"
                : "text-white/35 hover:text-white/60"
            }`}
            style={filter === f ? { background: "rgba(255,255,255,0.08)" } : {}}
          >
            {f === "all" ? "All" : f === "signals" ? "Signals" : "With orders"}
          </button>
        ))}
      </div>

      {/* Log list */}
      {visible.length === 0 ? (
        <div className="text-center py-16">
          <Clock className="w-8 h-8 text-white/10 mx-auto mb-3" />
          <p className="text-sm text-white/25">
            {filter === "all" ? "No activity yet" : `No ${filter} found`}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map(log => <LogRow key={log.id} log={log} />)}
        </div>
      )}

      {/* Load more */}
      {logs.length < total && (
        <div className="text-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/8 disabled:opacity-40 transition-all"
          >
            {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
            {loadingMore ? "Loading…" : `Load more (${total - logs.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  )
}
