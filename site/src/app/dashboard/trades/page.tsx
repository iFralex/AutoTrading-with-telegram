"use client"

import { useState, useEffect, useCallback } from "react"
import {
  TrendingUp, TrendingDown, Minus, Download, FileText,
  History, AlertTriangle, Loader2, RefreshCw,
} from "lucide-react"
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts"
import { useDashboard } from "@/src/components/dashboard/DashboardContext"
import { api, type ClosedTrade, type TradeStats, type SavedReport } from "@/src/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null, d = 5): string {
  if (v === null || v === undefined) return "—"
  return v.toFixed(d)
}

function fmtProfit(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return (v >= 0 ? "+" : "") + "$" + Math.abs(v).toFixed(2)
}

function fmtTs(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    })
  } catch { return iso }
}

const MONTH_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DirectionBadge({ type }: { type: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
      type === "BUY"
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
        : "bg-red-500/10 text-red-400 border-red-500/20"
    }`}>{type}</span>
  )
}

function CloseBadge({ reason }: { reason: string | null }) {
  const r = reason ?? "—"
  const map: Record<string, string> = {
    TP:     "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    SL:     "bg-red-500/10 text-red-400 border-red-500/20",
    CLIENT: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    EXPERT: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[r] ?? "bg-white/[0.04] text-white/35 border-white/10"}`}>
      {r}
    </span>
  )
}

function ProfitCell({ profit }: { profit: number | null }) {
  if (profit === null) return (
    <span className="flex items-center gap-1 text-amber-400 text-xs">
      <AlertTriangle className="w-3 h-3" /> N/A
    </span>
  )
  const pos = profit > 0, zero = profit === 0
  return (
    <span className={`flex items-center gap-1 font-mono text-xs font-semibold ${pos ? "text-emerald-400" : zero ? "text-white/40" : "text-red-400"}`}>
      {pos ? <TrendingUp className="w-3 h-3" /> : zero ? <Minus className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {fmtProfit(profit)}
    </span>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] px-4 py-3"
      style={{ background: "rgba(255,255,255,0.025)" }}>
      <p className={`text-lg font-black ${accent ?? "text-white"}`}>{value}</p>
      <p className="text-[11px] text-white/30 mt-0.5">{label}</p>
    </div>
  )
}

function EquityChart({ stats }: { stats: TradeStats }) {
  if (!stats.cumulative_pnl || stats.cumulative_pnl.length < 2) return null
  const data = stats.cumulative_pnl.map(p => ({
    time: new Date(p.ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    value: p.cumulative,
  }))
  const last = data[data.length - 1]?.value ?? 0
  const color = last >= 0 ? "#10b981" : "#ef4444"
  return (
    <div className="rounded-2xl border border-white/[0.07] p-5"
      style={{ background: "rgba(255,255,255,0.025)" }}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-white/50">Cumulative P&L</p>
        <span className={`text-sm font-bold font-mono ${last >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {last >= 0 ? "+" : ""}${last.toFixed(2)}
        </span>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="tradeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} tickLine={false} axisLine={false} width={52}
              tickFormatter={(v: number) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: "#0b0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
              labelStyle={{ color: "rgba(255,255,255,0.5)" }}
              formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, "Cumulative P&L"]}
            />
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#tradeGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ReasonBreakdown({ stats }: { stats: TradeStats }) {
  if (!stats.by_reason || stats.by_reason.length === 0) return null
  const cfg: Record<string, { bg: string; border: string; text: string }> = {
    TP:     { bg: "rgba(16,185,129,0.08)",  border: "rgba(16,185,129,0.2)",  text: "#34d399" },
    SL:     { bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)",   text: "#f87171" },
    CLIENT: { bg: "rgba(59,130,246,0.08)",  border: "rgba(59,130,246,0.2)",  text: "#60a5fa" },
    EXPERT: { bg: "rgba(139,92,246,0.08)",  border: "rgba(139,92,246,0.2)",  text: "#a78bfa" },
  }
  return (
    <div className="rounded-2xl border border-white/[0.07] p-5 space-y-3"
      style={{ background: "rgba(255,255,255,0.025)" }}>
      <p className="text-xs font-semibold text-white/50">Close reason breakdown</p>
      <div className="grid grid-cols-2 gap-2">
        {stats.by_reason.map(r => {
          const c = cfg[r.reason] ?? { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)", text: "rgba(255,255,255,0.4)" }
          return (
            <div key={r.reason} className="rounded-xl px-3 py-2.5"
              style={{ background: c.bg, border: `1px solid ${c.border}` }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold" style={{ color: c.text }}>{r.reason}</span>
                <span className="text-xs text-white/40">{r.count} trades</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-white/40">
                <span>avg {r.avg_profit >= 0 ? "+" : ""}${r.avg_profit.toFixed(2)}</span>
                <span className="text-white/20">·</span>
                <span style={{ color: r.total_profit >= 0 ? c.text : "#f87171" }}>
                  total {r.total_profit >= 0 ? "+" : ""}${r.total_profit.toFixed(2)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SymbolTable({ stats }: { stats: TradeStats }) {
  if (!stats.by_symbol || stats.by_symbol.length === 0) return null
  return (
    <div className="rounded-2xl border border-white/[0.07] overflow-hidden"
      style={{ background: "rgba(255,255,255,0.025)" }}>
      <div className="px-5 py-3 border-b border-white/[0.06]">
        <p className="text-xs font-semibold text-white/50">Performance by symbol</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="border-b border-white/[0.05]" style={{ background: "rgba(255,255,255,0.02)" }}>
              {["Symbol", "Trades", "Win rate", "Avg P&L", "Total P&L"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-white/25">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.by_symbol.map((s, i) => (
              <tr key={s.symbol}
                className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i === stats.by_symbol.length - 1 ? "border-b-0" : ""}`}>
                <td className="px-4 py-2.5 font-bold text-xs text-white">{s.symbol}</td>
                <td className="px-4 py-2.5 text-xs text-white/55">{s.total} ({s.wins}W / {s.losses}L)</td>
                <td className="px-4 py-2.5 text-xs font-mono">
                  <span className={s.win_rate >= 55 ? "text-emerald-400" : s.win_rate >= 40 ? "text-amber-400" : "text-red-400"}>
                    {s.win_rate.toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs font-mono">
                  <span className={s.avg_profit >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {s.avg_profit >= 0 ? "+" : ""}${s.avg_profit.toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs font-mono font-semibold">
                  <span className={s.total_profit >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {s.total_profit >= 0 ? "+" : ""}${s.total_profit.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TradesPage() {
  const { user } = useDashboard()
  const [trades, setTrades]             = useState<ClosedTrade[]>([])
  const [stats, setStats]               = useState<TradeStats | null>(null)
  const [loading, setLoading]           = useState(false)
  const [limit, setLimit]               = useState(20)
  const [reportDays, setReportDays]     = useState(30)
  const [genLoading, setGenLoading]     = useState(false)
  const [genMsg, setGenMsg]             = useState<{ ok: boolean; text: string } | null>(null)
  const [savedReports, setSavedReports] = useState<SavedReport[]>([])
  const [dlLoading, setDlLoading]       = useState<number | null>(null)
  const [showReports, setShowReports]   = useState(false)

  const load = useCallback(async (n: number) => {
    if (!user) return
    setLoading(true)
    try {
      const [tradesRes, statsRes] = await Promise.all([
        api.getRecentTrades(user.user_id, n),
        api.getTradeStats(user.user_id),
      ])
      setTrades(tradesRes.trades)
      setStats(statsRes)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [user])

  const loadReports = useCallback(async () => {
    if (!user) return
    try {
      const res = await api.listReports(user.user_id)
      setSavedReports(res.reports)
    } catch { /* ignore */ }
  }, [user])

  useEffect(() => { if (user) { load(limit); loadReports() } }, [user, load, loadReports, limit])

  const generateReport = async () => {
    if (!user) return
    setGenLoading(true)
    setGenMsg(null)
    try {
      await api.generateReport(user.user_id, reportDays, true)
      setGenMsg({ ok: true, text: `Report for last ${reportDays} days downloaded and sent to Telegram.` })
      loadReports()
    } catch (e) {
      setGenMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to generate report" })
    } finally { setGenLoading(false) }
  }

  const downloadSaved = async (r: SavedReport) => {
    if (!user) return
    setDlLoading(r.id)
    try { await api.downloadSavedReport(user.user_id, r.year, r.month) }
    catch { /* ignore */ }
    finally { setDlLoading(null) }
  }

  if (!user) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-white/30">Connect your account to view trades.</p>
    </div>
  )

  const hasMissingData = trades.some(t => t.close_price === null || t.profit === null)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-white">Trade History</h2>
          <p className="text-sm text-white/35 mt-0.5">Closed positions from your MT5 account</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="text-xs font-medium px-3 py-2 rounded-xl border border-white/[0.08] text-white/60 focus:outline-none"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} trades</option>)}
          </select>
          <button
            onClick={() => load(limit)}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white/50 hover:text-white/80 border border-white/[0.08] hover:border-white/[0.15] transition-all"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total trades" value={String(stats.total_trades)} />
          <StatCard
            label="Win rate"
            value={`${stats.win_rate.toFixed(1)}%`}
            accent={stats.win_rate >= 55 ? "text-emerald-400" : "text-amber-400"}
          />
          <StatCard
            label="Total P&L"
            value={(stats.total_profit >= 0 ? "+" : "") + "$" + Math.abs(stats.total_profit).toFixed(2)}
            accent={stats.total_profit >= 0 ? "text-emerald-400" : "text-red-400"}
          />
          <StatCard
            label="Profit factor"
            value={stats.profit_factor !== null ? stats.profit_factor.toFixed(2) : "—"}
            accent={stats.profit_factor !== null && stats.profit_factor > 1 ? "text-emerald-400" : "text-red-400"}
          />
        </div>
      )}

      {/* Equity curve */}
      {stats && <EquityChart stats={stats} />}

      {/* Analytics: by reason + by symbol */}
      {stats && (stats.by_reason.length > 0 || stats.by_symbol.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ReasonBreakdown stats={stats} />
          <SymbolTable stats={stats} />
        </div>
      )}

      {/* PDF Report bar */}
      <div className="rounded-xl border border-white/[0.07] px-4 py-3.5 flex flex-wrap items-center gap-3"
        style={{ background: "rgba(255,255,255,0.02)" }}>
        <FileText className="w-4 h-4 text-white/35 shrink-0" />
        <span className="text-sm font-medium text-white/55 shrink-0">Generate PDF report</span>
        <select
          value={reportDays}
          onChange={e => setReportDays(Number(e.target.value))}
          className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.08] text-white/55 focus:outline-none"
          style={{ background: "rgba(255,255,255,0.04)" }}
        >
          {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <button
          onClick={generateReport}
          disabled={genLoading}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold text-black disabled:opacity-40 transition-all"
          style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
        >
          {genLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {genLoading ? "Generating…" : "Generate & Download"}
        </button>
        {genMsg && (
          <span className={`text-xs ${genMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{genMsg.text}</span>
        )}
        {savedReports.length > 0 && (
          <button
            onClick={() => setShowReports(s => !s)}
            className="ml-auto text-xs text-white/30 hover:text-white/55 flex items-center gap-1 transition-colors"
          >
            <History className="w-3.5 h-3.5" />
            {savedReports.length} saved
          </button>
        )}
      </div>

      {/* Saved reports list */}
      {showReports && savedReports.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] overflow-hidden"
          style={{ background: "rgba(255,255,255,0.02)" }}>
          {savedReports.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i < savedReports.length - 1 ? "border-b border-white/[0.05]" : ""}`}
            >
              <div className="flex items-center gap-3">
                <FileText className="w-3.5 h-3.5 text-white/25" />
                <span className="text-sm font-medium text-white/65">{MONTH_EN[r.month - 1]} {r.year}</span>
                <span className="text-xs text-white/25">{fmtBytes(r.size_bytes)}</span>
              </div>
              <button
                onClick={() => downloadSaved(r)}
                disabled={dlLoading === r.id}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg text-white/50 hover:text-white/80 border border-white/[0.07] hover:border-white/[0.15] transition-all"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <Download className={`w-3 h-3 ${dlLoading === r.id ? "animate-bounce" : ""}`} />
                {dlLoading === r.id ? "…" : "Download"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Missing data warning */}
      {hasMissingData && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-amber-500/20 text-sm text-amber-400"
          style={{ background: "rgba(245,158,11,0.05)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Some trades show N/A — MT5 deal history wasn&apos;t available at close time. Data will update automatically.</span>
        </div>
      )}

      {/* Loading */}
      {loading && trades.length === 0 && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 text-emerald-400 animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && trades.length === 0 && (
        <div className="text-center py-16">
          <TrendingUp className="w-8 h-8 text-white/10 mx-auto mb-3" />
          <p className="text-sm text-white/25">No closed trades yet</p>
        </div>
      )}

      {/* Table */}
      {trades.length > 0 && (
        <div className="rounded-2xl border border-white/[0.07] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[780px]">
              <thead>
                <tr className="border-b border-white/[0.07]"
                  style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["Ticket","Symbol","Dir","Lots","Entry","Close","SL","TP","Profit","Close reason","Opened","Closed"].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-white/30 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr
                    key={t.ticket}
                    className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${
                      (t.close_price === null || t.profit === null) ? "bg-amber-500/[0.03]" : ""
                    } ${i === trades.length - 1 ? "border-b-0" : ""}`}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs text-white/30">#{t.ticket}</td>
                    <td className="px-3 py-2.5 font-bold text-xs text-white">{t.symbol}</td>
                    <td className="px-3 py-2.5"><DirectionBadge type={t.order_type} /></td>
                    <td className="px-3 py-2.5 font-mono text-xs text-white/55">{fmt(t.lots, 2)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-white/70">{fmt(t.entry_price)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {t.close_price === null
                        ? <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />N/A</span>
                        : <span className="text-white/70">{fmt(t.close_price)}</span>
                      }
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-white/30">{fmt(t.sl)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-white/30">{fmt(t.tp)}</td>
                    <td className="px-3 py-2.5"><ProfitCell profit={t.profit} /></td>
                    <td className="px-3 py-2.5"><CloseBadge reason={t.reason} /></td>
                    <td className="px-3 py-2.5 text-xs text-white/30 whitespace-nowrap">{fmtTs(t.open_time)}</td>
                    <td className="px-3 py-2.5 text-xs text-white/30 whitespace-nowrap">{fmtTs(t.close_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
