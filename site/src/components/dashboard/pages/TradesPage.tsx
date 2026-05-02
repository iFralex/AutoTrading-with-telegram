"use client"

import { useState, useEffect, useCallback } from "react"
import { RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus, FileText, Download, History } from "lucide-react"
import { api, type ClosedTrade, type SavedReport } from "@/src/lib/api"

function fmt(v: number | null, decimals = 5): string {
  if (v === null || v === undefined) return "—"
  return v.toFixed(decimals)
}

function fmtProfit(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return (v >= 0 ? "+" : "") + v.toFixed(2)
}

function fmtTs(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch { return iso }
}

function ReasonBadge({ reason }: { reason: string | null }) {
  const r = reason ?? "—"
  const colors: Record<string, string> = {
    TP:     "bg-emerald-600/10 text-emerald-400 border-emerald-500/20",
    SL:     "bg-red-600/10 text-red-400 border-red-500/20",
    CLIENT: "bg-blue-600/10 text-blue-400 border-blue-500/20",
    EXPERT: "bg-violet-600/10 text-violet-400 border-violet-500/20",
  }
  const cls = colors[r] ?? "bg-white/[0.04] text-muted-foreground border-white/10"
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${cls}`}>
      {r}
    </span>
  )
}

function ProfitCell({ profit }: { profit: number | null }) {
  if (profit === null) {
    return (
      <span className="flex items-center gap-1 text-amber-400">
        <AlertTriangle className="w-3 h-3" />
        <span className="font-mono text-xs">N/A</span>
      </span>
    )
  }
  const pos = profit > 0
  const zero = profit === 0
  return (
    <span className={`flex items-center gap-1 font-mono text-xs font-semibold ${
      pos ? "text-emerald-400" : zero ? "text-muted-foreground" : "text-red-400"
    }`}>
      {pos ? <TrendingUp className="w-3 h-3" /> : zero ? <Minus className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {fmtProfit(profit)}
    </span>
  )
}

function ClosePriceCell({ closePrice }: { closePrice: number | null }) {
  if (closePrice === null) {
    return (
      <span className="flex items-center gap-1 text-amber-400">
        <AlertTriangle className="w-3 h-3" />
        <span className="font-mono text-xs">N/A</span>
      </span>
    )
  }
  return <span className="font-mono text-xs">{fmt(closePrice)}</span>
}

const _MONTH_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

function fmtReportSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function TradesPage({ userId }: { userId: string }) {
  const [trades, setTrades]             = useState<ClosedTrade[]>([])
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [limit, setLimit]               = useState(5)
  const [reportDays, setReportDays]     = useState(30)
  const [genLoading, setGenLoading]     = useState(false)
  const [genMsg, setGenMsg]             = useState<{ ok: boolean; text: string } | null>(null)
  const [savedReports, setSavedReports]       = useState<SavedReport[]>([])
  const [reportsLoading, setReportsLoading]   = useState(true)
  const [dlLoading, setDlLoading]             = useState<number | null>(null)

  const load = useCallback(async (n: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getRecentTrades(userId, n)
      setTrades(res.trades)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore nel caricamento")
    } finally {
      setLoading(false)
    }
  }, [userId])

  const loadSavedReports = useCallback(async () => {
    setReportsLoading(true)
    try {
      const res = await api.listReports(userId)
      setSavedReports(res.reports)
    } catch {
      // non-critical: silently ignore
    } finally {
      setReportsLoading(false)
    }
  }, [userId])

  const handleGenerateReport = async () => {
    setGenLoading(true)
    setGenMsg(null)
    try {
      await api.generateReport(userId, reportDays, true)
      setGenMsg({ ok: true, text: `${reportDays}-day report downloaded and sent to Telegram.` })
    } catch (e: unknown) {
      setGenMsg({ ok: false, text: e instanceof Error ? e.message : "Generation failed" })
    } finally {
      setGenLoading(false)
    }
  }

  const handleDownloadSaved = async (report: SavedReport) => {
    setDlLoading(report.id)
    try {
      await api.downloadSavedReport(userId, report.year, report.month)
    } catch {
      // silently ignore — browser will show nothing
    } finally {
      setDlLoading(null)
    }
  }

  useEffect(() => { load(limit) }, [load, limit])
  useEffect(() => { loadSavedReports() }, [loadSavedReports])

  const hasMissingData = trades.some(t => t.close_price === null || t.profit === null)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Recent Closed Positions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Raw data from MT5 — close price and profit as received
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground"
          >
            {[5, 10, 20, 50].map(n => (
              <option key={n} value={n}>{n} trades</option>
            ))}
          </select>
          <button
            onClick={() => load(limit)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Report on-demand */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-4 py-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground shrink-0">
          <FileText className="w-4 h-4 text-indigo-400" />
          Generate PDF Report
        </div>
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <select
            value={reportDays}
            onChange={e => setReportDays(Number(e.target.value))}
            className="text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-foreground"
          >
            {[7, 14, 30, 60, 90].map(d => (
              <option key={d} value={d}>Last {d} days</option>
            ))}
          </select>
          <button
            onClick={handleGenerateReport}
            disabled={genLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
          >
            <FileText className={`w-3 h-3 ${genLoading ? "animate-pulse" : ""}`} />
            {genLoading ? "Generating…" : "Generate & Download"}
          </button>
          {genMsg && (
            <span className={`text-xs ${genMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
              {genMsg.text}
            </span>
          )}
        </div>
      </div>

      {/* Saved monthly reports — always visible */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.07]">
          <History className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-sm font-medium text-foreground">Monthly Reports</span>
          {!reportsLoading && (
            <span className="ml-auto text-xs text-muted-foreground">
              {savedReports.length} report{savedReports.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {reportsLoading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading…
          </div>
        ) : savedReports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
            <History className="w-8 h-8 opacity-20" />
            <p className="text-sm">No monthly reports yet</p>
            <p className="text-xs opacity-60">Reports are generated automatically at the end of each month and sent to your Telegram.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {savedReports.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {_MONTH_EN[r.month - 1]} {r.year}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {fmtReportSize(r.size_bytes)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    {new Date(r.generated_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <button
                    onClick={() => handleDownloadSaved(r)}
                    disabled={dlLoading === r.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-foreground disabled:opacity-40 transition-colors"
                  >
                    <Download className={`w-3 h-3 ${dlLoading === r.id ? "animate-bounce" : ""}`} />
                    {dlLoading === r.id ? "…" : "Download"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {hasMissingData && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-600/5 text-sm text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Incomplete data detected</span>
            <span className="text-amber-400/80 ml-1">
              — some positions have close_price or profit = N/A. The MT5 deal was not yet in history at close time (race condition).
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-red-500/20 bg-red-600/5 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && trades.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No closed positions found.
        </div>
      )}

      {trades.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] bg-white/[0.02]">
                {["Ticket", "Symbol", "Dir", "Lots", "Entry", "Close", "SL", "TP", "Profit", "Reason", "Opened", "Closed"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
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
                    (t.close_price === null || t.profit === null) ? "bg-amber-900/5" : ""
                  }`}
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">#{t.ticket}</td>
                  <td className="px-3 py-2.5 font-semibold text-xs">{t.symbol}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                      t.order_type === "BUY"
                        ? "bg-emerald-600/10 text-emerald-400 border-emerald-500/20"
                        : "bg-red-600/10 text-red-400 border-red-500/20"
                    }`}>
                      {t.order_type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{fmt(t.lots, 2)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{fmt(t.entry_price)}</td>
                  <td className="px-3 py-2.5"><ClosePriceCell closePrice={t.close_price} /></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{fmt(t.sl)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{fmt(t.tp)}</td>
                  <td className="px-3 py-2.5"><ProfitCell profit={t.profit} /></td>
                  <td className="px-3 py-2.5"><ReasonBadge reason={t.reason} /></td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtTs(t.open_time)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtTs(t.close_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
