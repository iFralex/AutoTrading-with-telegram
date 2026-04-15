"use client"

import { useEffect, useState, useCallback } from "react"
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts"
import { api, type AILog, type AIStats } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── Colori ────────────────────────────────────────────────────────────────────

const C = {
  indigo:  "#6366f1",
  amber:   "#f59e0b",
  emerald: "#10b981",
  red:     "#ef4444",
  violet:  "#8b5cf6",
  blue:    "#3b82f6",
}

const CALL_TYPE_COLOR: Record<string, string> = {
  flash_detect:      C.amber,
  pro_extract:       C.indigo,
  strategy_pretrade: C.emerald,
  strategy_event:    C.violet,
}

const CALL_TYPE_LABEL: Record<string, string> = {
  flash_detect:      "Flash (detect)",
  pro_extract:       "Pro (extract)",
  strategy_pretrade: "Strategy (pre-trade)",
  strategy_event:    "Strategy (event)",
}

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "#1e293b",
  border:          "1px solid #334155",
  borderRadius:    8,
  color:           "#f1f5f9",
  fontSize:        12,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—"
  return n.toLocaleString("it-IT", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtCost(n: number | null | undefined): string {
  if (n == null) return "—"
  if (n === 0) return "$0.00"
  if (n < 0.0001) return `$${n.toExponential(2)}`
  return `$${n.toFixed(6)}`
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function fmtLatency(ms: number | null | undefined): string {
  if (ms == null) return "—"
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function fmtDate(ts: string): string {
  try {
    return new Date(ts).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch {
    return ts
  }
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 flex flex-col gap-1">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-slate-100">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

// ── Log row ───────────────────────────────────────────────────────────────────

function LogRow({ log }: { log: AILog }) {
  const [expanded, setExpanded] = useState(false)
  const color = CALL_TYPE_COLOR[log.call_type] ?? C.blue
  const label = CALL_TYPE_LABEL[log.call_type] ?? log.call_type

  return (
    <div
      className="border border-slate-700 rounded-lg bg-slate-800/40 text-xs cursor-pointer select-none"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        {/* badge tipo */}
        <span
          className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: color + "33", color }}
        >
          {label}
        </span>
        {/* timestamp */}
        <span className="text-slate-400 shrink-0">{fmtDate(log.ts)}</span>
        {/* modello */}
        <span className="text-slate-500 truncate hidden sm:inline">{log.model}</span>
        {/* token / costo / latenza */}
        <span className="ml-auto flex gap-4 shrink-0 text-slate-300">
          <span title="Token totali">{fmtTokens(log.total_tokens)}</span>
          <span title="Costo stimato" className="text-emerald-400">{fmtCost(log.cost_usd)}</span>
          <span title="Latenza">{fmtLatency(log.latency_ms)}</span>
          {log.error && <span className="text-red-400" title={log.error}>⚠</span>}
        </span>
        <span className="text-slate-600">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="border-t border-slate-700 px-3 py-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <p className="text-slate-500 uppercase text-[10px]">Prompt token</p>
              <p className="text-slate-200">{log.prompt_tokens ?? "—"}</p>
            </div>
            <div>
              <p className="text-slate-500 uppercase text-[10px]">Output token</p>
              <p className="text-slate-200">{log.completion_tokens ?? "—"}</p>
            </div>
            <div>
              <p className="text-slate-500 uppercase text-[10px]">Costo</p>
              <p className="text-emerald-400">{fmtCost(log.cost_usd)}</p>
            </div>
            <div>
              <p className="text-slate-500 uppercase text-[10px]">Latenza</p>
              <p className="text-slate-200">{fmtLatency(log.latency_ms)}</p>
            </div>
          </div>
          {log.error && (
            <div className="rounded bg-red-900/30 border border-red-700 px-3 py-2 text-red-300">
              <span className="font-semibold">Errore: </span>{log.error}
            </div>
          )}
          {log.context && (
            <div className="space-y-1">
              {Object.entries(log.context).map(([k, v]) => v != null && (
                <div key={k} className="flex gap-2">
                  <span className="text-slate-500 shrink-0 w-40">{k}:</span>
                  <span className="text-slate-300 break-all">
                    {typeof v === "boolean" ? (v ? "sì" : "no")
                      : typeof v === "object" ? JSON.stringify(v)
                      : String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AILogsPanel({ userId }: { userId: string }) {
  const [stats,    setStats]    = useState<AIStats | null>(null)
  const [logs,     setLogs]     = useState<AILog[]>([])
  const [loading,  setLoading]  = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset,   setOffset]   = useState(0)
  const [hasMore,  setHasMore]  = useState(true)
  const PAGE = 50

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.getAIStats(userId),
      api.getAILogs(userId, PAGE, 0),
    ]).then(([s, l]) => {
      setStats(s)
      setLogs(l.logs)
      setHasMore(l.logs.length === PAGE)
      setOffset(PAGE)
    }).catch(console.error)
      .finally(() => setLoading(false))
  }, [userId])

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const res = await api.getAILogs(userId, PAGE, offset)
      setLogs(prev => [...prev, ...res.logs])
      setHasMore(res.logs.length === PAGE)
      setOffset(prev => prev + PAGE)
    } finally {
      setLoadingMore(false)
    }
  }, [userId, offset])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-400">
        Caricamento log AI…
      </div>
    )
  }

  if (!stats) return null

  return (
    <div className="space-y-6">
      {/* ── KPI aggregate ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <KPI label="Chiamate totali"  value={stats.total_calls.toLocaleString()} />
        <KPI label="Token totali"     value={fmtTokens(stats.total_tokens)} />
        <KPI label="Token input"      value={fmtTokens(stats.total_prompt_tokens)} />
        <KPI label="Token output"     value={fmtTokens(stats.total_completion_tokens)} />
        <KPI label="Costo totale"     value={fmtCost(stats.total_cost_usd)} />
        <KPI label="Latenza media"    value={fmtLatency(stats.avg_latency_ms)} />
        <KPI label="Errori"           value={stats.total_errors.toString()}
              sub={stats.total_calls > 0
                ? `${((stats.total_errors / stats.total_calls) * 100).toFixed(1)}% error rate`
                : undefined}
        />
      </div>

      {/* ── Per tipo di chiamata ──────────────────────────────────────────── */}
      {stats.by_call_type.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Chiamate per tipo</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats.by_call_type} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="call_type"
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    width={120}
                    tickFormatter={(v: string) => CALL_TYPE_LABEL[v] ?? v}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v) => [Number(v).toLocaleString(), "chiamate"]}
                  />
                  <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
                    {stats.by_call_type.map((row) => (
                      <rect key={row.call_type} fill={CALL_TYPE_COLOR[row.call_type] ?? C.blue} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Costo per tipo (USD)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-xs">
                {stats.by_call_type.map(row => (
                  <div key={row.call_type} className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: CALL_TYPE_COLOR[row.call_type] ?? C.blue }}
                    />
                    <span className="text-slate-300 w-44 shrink-0">
                      {CALL_TYPE_LABEL[row.call_type] ?? row.call_type}
                    </span>
                    <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: stats.total_cost_usd > 0
                            ? `${Math.min(100, (row.cost_usd / stats.total_cost_usd) * 100)}%`
                            : "0%",
                          background: CALL_TYPE_COLOR[row.call_type] ?? C.blue,
                        }}
                      />
                    </div>
                    <span className="text-emerald-400 shrink-0 w-24 text-right">{fmtCost(row.cost_usd)}</span>
                    <span className="text-slate-500 shrink-0 w-16 text-right">
                      {fmtLatency(row.avg_latency_ms)} avg
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Trend giornaliero (30 giorni) ─────────────────────────────────── */}
      {stats.daily.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Chiamate giornaliere (30 giorni)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={stats.daily} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="aiCallsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.indigo} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={C.indigo} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v) => [Number(v).toLocaleString(), "chiamate"]}
                  />
                  <Area
                    type="monotone" dataKey="calls"
                    stroke={C.indigo} fill="url(#aiCallsGrad)" strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Costo giornaliero (30 giorni)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={stats.daily} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="aiCostGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.emerald} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={C.emerald} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickFormatter={(v: number) => `$${v.toFixed(4)}`}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v) => [fmtCost(Number(v)), "costo"]}
                  />
                  <Area
                    type="monotone" dataKey="cost_usd"
                    stroke={C.emerald} fill="url(#aiCostGrad)" strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Per modello ───────────────────────────────────────────────────── */}
      {stats.by_model.length > 0 && (
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">Breakdown per modello</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-slate-300">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-500 uppercase text-[10px] tracking-wide">
                    <th className="text-left py-2 pr-4">Modello</th>
                    <th className="text-right py-2 pr-4">Chiamate</th>
                    <th className="text-right py-2 pr-4">Token input</th>
                    <th className="text-right py-2 pr-4">Token output</th>
                    <th className="text-right py-2 pr-4">Costo</th>
                    <th className="text-right py-2">Latenza avg</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_model.map(row => (
                    <tr key={row.model} className="border-b border-slate-800 hover:bg-slate-700/20">
                      <td className="py-2 pr-4 font-mono text-slate-200">{row.model}</td>
                      <td className="text-right py-2 pr-4">{row.calls.toLocaleString()}</td>
                      <td className="text-right py-2 pr-4">{fmtTokens(row.prompt_tokens)}</td>
                      <td className="text-right py-2 pr-4">{fmtTokens(row.completion_tokens)}</td>
                      <td className="text-right py-2 pr-4 text-emerald-400">{fmtCost(row.cost_usd)}</td>
                      <td className="text-right py-2">{fmtLatency(row.avg_latency_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Log recenti ───────────────────────────────────────────────────── */}
      <Card className="bg-slate-800/60 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-300">
            Log recenti ({logs.length} caricati)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {logs.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">Nessun log AI ancora registrato.</p>
          ) : (
            <>
              {logs.map(log => <LogRow key={log.id} log={log} />)}
              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full py-2 text-sm text-slate-400 border border-slate-700 rounded-lg
                             hover:border-slate-500 hover:text-slate-200 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? "Caricamento…" : "Carica altri"}
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
