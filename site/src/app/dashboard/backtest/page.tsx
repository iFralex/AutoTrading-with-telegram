"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Play, RefreshCw, X, CheckCircle, AlertTriangle,
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Loader2, History,
} from "lucide-react"
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts"
import { useDashboard } from "@/src/components/dashboard/DashboardContext"
import { api, type BacktestRun, type BacktestTrade } from "@/src/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    })
  } catch { return iso }
}
function fmtPips(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return (v >= 0 ? "+" : "") + v.toFixed(1) + " pips"
}
function fmtUsd(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined) return "—"
  return (v >= 0 ? "+" : "") + "$" + Math.abs(v).toFixed(d)
}
function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return v.toFixed(1) + "%"
}
function fmtNum(v: number | null, d = 2): string {
  if (v === null || v === undefined) return "—"
  return v.toFixed(d)
}
function fmtDur(min: number | null): string {
  if (min === null || min === undefined) return "—"
  if (min < 60) return `${Math.round(min)}m`
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`
}

const STATUS_STEPS: { key: string; label: string; aiOnly?: boolean }[] = [
  { key: "running:telegram_fetch",    label: "Downloading messages" },
  { key: "running:signal_detection",  label: "Detecting signals" },
  { key: "running:signal_extraction", label: "Extracting signals" },
  { key: "running:ai_pretrade",       label: "Pre-trade analysis", aiOnly: true },
  { key: "running:mt5_bars",          label: "Fetching MT5 bars" },
  { key: "running:simulation",        label: "Simulating trades" },
]

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, positive }: {
  label: string; value: string; sub?: string; positive?: boolean | null
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] p-4"
      style={{ background: "rgba(255,255,255,0.025)" }}>
      <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-1.5">{label}</p>
      <p className={`text-xl font-black font-mono ${
        positive === true ? "text-emerald-400" :
        positive === false ? "text-red-400" : "text-white"
      }`}>{value}</p>
      {sub && <p className="text-[11px] text-white/30 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Outcome badge ─────────────────────────────────────────────────────────────

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  const map: Record<string, string> = {
    TP:             "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    SL:             "bg-red-500/10 text-red-400 border-red-500/20",
    open_at_end:    "bg-amber-500/10 text-amber-400 border-amber-500/20",
    not_filled:     "bg-white/[0.04] text-white/30 border-white/10",
    ai_rejected:    "bg-orange-500/10 text-orange-400 border-orange-500/20",
    invalid_signal: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  }
  const o = outcome ?? "—"
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${map[o] ?? "bg-white/[0.04] text-white/30 border-white/10"}`}>
      {o}
    </span>
  )
}

// ── History list ──────────────────────────────────────────────────────────────

function HistoryList({ runs, onSelect }: { runs: BacktestRun[]; onSelect: (r: BacktestRun) => void }) {
  const done = runs.filter(r => r.status === "done").slice(0, 8)
  if (done.length === 0) return (
    <p className="text-xs text-white/25 text-center py-4">No completed runs yet</p>
  )
  return (
    <div className="space-y-1">
      {done.map(r => {
        const pos = (r.total_pnl_pips ?? 0) >= 0
        return (
          <button
            key={r.id}
            onClick={() => onSelect(r)}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02] transition-all"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white/65 truncate">{r.group_name ?? "Unknown"}</p>
              <p className="text-[10px] text-white/30 mt-0.5">
                {fmtTs(r.started_at)}
                {r.win_rate !== null ? ` · ${r.win_rate.toFixed(1)}% WR` : ""}
                {r.total_messages ? ` · ${r.total_messages} msgs` : ""}
              </p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${
              pos ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
            }`}>
              {r.total_pnl_usd !== null ? `${r.total_pnl_usd >= 0 ? "+" : ""}$${Math.abs(r.total_pnl_usd).toFixed(0)}` : "—"}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Run form ──────────────────────────────────────────────────────────────────

function RunForm({ onStarted, disabled }: { onStarted: (id: string) => void; disabled: boolean }) {
  const { user } = useDashboard()
  const groups = user?.groups ?? []
  const [selectedGroupId, setSelectedGroupId] = useState<number>(groups[0]?.group_id ?? 0)
  const [mode, setMode]       = useState<"message_count" | "date_limit">("message_count")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo]     = useState("")
  const [countVal, setCountVal] = useState("1000")
  const [useAi, setUseAi]       = useState(false)
  const [balance, setBalance]   = useState("10000")
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  const selectedGroup = groups.find(g => g.group_id === selectedGroupId) ?? groups[0]

  const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm font-mono text-white placeholder:text-white/20 focus:outline-none transition-all"
  const inputStyle = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }

  async function submit() {
    if (!user || !selectedGroup) return
    setErr(null)
    const limitValue = mode === "date_limit" ? `${dateFrom}/${dateTo}` : countVal
    if (mode === "date_limit" && (!dateFrom || !dateTo)) { setErr("Select both dates"); return }
    if (mode === "date_limit" && dateFrom > dateTo) { setErr("Start date must be before end date"); return }
    setLoading(true)
    try {
      const res = await api.startBacktest({
        user_id:              user.user_id,
        group_id:             String(selectedGroup.group_id),
        group_name:           selectedGroup.group_name,
        mode,
        limit_value:          limitValue,
        use_ai:               useAi,
        starting_balance_usd: parseFloat(balance) || 10000,
      })
      onStarted(res.run_id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start backtest")
    } finally { setLoading(false) }
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] p-5 space-y-4"
      style={{ background: "rgba(255,255,255,0.03)" }}>
      <h3 className="text-sm font-bold text-white">New backtest</h3>

      {disabled && (
        <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/20 text-xs text-amber-400"
          style={{ background: "rgba(245,158,11,0.05)" }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          A backtest is already running. Wait for it to finish.
        </div>
      )}

      {groups.length > 1 && (
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">Room</label>
          <select
            value={selectedGroupId}
            onChange={e => setSelectedGroupId(Number(e.target.value))}
            className={inputCls} style={inputStyle}
          >
            {groups.map(g => (
              <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
            ))}
          </select>
        </div>
      )}
      {groups.length === 1 && (
        <p className="text-xs text-white/40">Room: <span className="text-white/65 font-medium">{groups[0].group_name}</span></p>
      )}

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">Mode</label>
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {(["message_count", "date_limit"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === m ? "text-white" : "text-white/35 hover:text-white/55"
              }`}
              style={mode === m ? { background: "rgba(255,255,255,0.08)" } : {}}
            >
              {m === "message_count" ? "Message count" : "Date range"}
            </button>
          ))}
        </div>
      </div>

      {mode === "message_count" ? (
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">Last N messages</label>
          <input
            type="number" min={10} max={50000} value={countVal}
            onChange={e => setCountVal(e.target.value)}
            className={inputCls} style={inputStyle}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">From</label>
            <input type="date" value={dateFrom} max={dateTo || undefined}
              onChange={e => setDateFrom(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">To</label>
            <input type="date" value={dateTo} min={dateFrom || undefined}
              onChange={e => setDateTo(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">Starting balance (USD)</label>
        <input
          type="number" min={100} max={1000000} step={100} value={balance}
          onChange={e => setBalance(e.target.value)}
          className={inputCls} style={inputStyle}
        />
      </div>

      <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06]"
        style={{ background: "rgba(255,255,255,0.02)" }}>
        <button
          role="switch"
          aria-checked={useAi}
          onClick={() => setUseAi(v => !v)}
          className={`shrink-0 w-9 h-5 rounded-full transition-all ${useAi ? "bg-emerald-500" : "bg-white/[0.12]"}`}
        >
          <span className={`block w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${useAi ? "translate-x-4" : "translate-x-0"}`} />
        </button>
        <div>
          <p className="text-xs font-semibold text-white/70">Use management strategy</p>
          <p className="text-[11px] text-white/30 mt-0.5">Apply AI pre-trade decisions (slower, more accurate)</p>
        </div>
      </div>

      {err && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {err}
        </p>
      )}

      <button
        onClick={submit}
        disabled={loading || disabled || !user}
        className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-black rounded-xl disabled:opacity-40 transition-all"
        style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        {loading ? "Starting…" : "Run backtest"}
      </button>
    </div>
  )
}

// ── Progress stepper ──────────────────────────────────────────────────────────

function RunProgress({ run, onRefresh, userId }: { run: BacktestRun; onRefresh: () => void; userId: string }) {
  const isRunning = run.status.startsWith("running")
  const [cancelling, setCancelling] = useState(false)

  const phases = STATUS_STEPS.filter(p => !p.aiOnly || run.use_ai)
  const currentIdx = phases.findIndex(p => p.key === run.status)

  function phaseState(idx: number): "done" | "active" | "pending" {
    if (currentIdx === -1) return idx === 0 ? "active" : "pending"
    if (idx < currentIdx) return "done"
    if (idx === currentIdx) return "active"
    return "pending"
  }

  async function cancel() {
    setCancelling(true)
    try { await api.cancelBacktest(run.id, userId) } catch { /* ignore */ }
    finally { setCancelling(false); setTimeout(onRefresh, 600) }
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] p-5 space-y-5"
      style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between">
        <div>
          {run.group_name && <p className="text-sm font-bold text-white mb-1">{run.group_name}</p>}
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border inline-flex items-center gap-1.5 ${
            run.status === "done"      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
            run.status === "error"     ? "bg-red-500/10 text-red-400 border-red-500/20" :
            run.status === "cancelled" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                                         "bg-blue-500/10 text-blue-400 border-blue-500/20"
          }`}>
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
            {run.status === "done" ? "Completed" :
             run.status === "error" ? "Error" :
             run.status === "cancelled" ? "Cancelled" : "Running"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              onClick={cancel}
              disabled={cancelling}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all disabled:opacity-50"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          )}
          <button onClick={onRefresh} className="text-white/25 hover:text-white/55 transition-colors">
            <RefreshCw className={`w-4 h-4 ${isRunning ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {run.error_msg && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-red-500/20 text-xs text-red-400"
          style={{ background: "rgba(239,68,68,0.05)" }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {run.error_msg}
        </div>
      )}

      <div className="space-y-0">
        {phases.map((phase, idx) => {
          const state = phaseState(idx)
          const isLast = idx === phases.length - 1
          return (
            <div key={phase.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
                  state === "done"   ? "bg-emerald-500/15 border-emerald-500/30" :
                  state === "active" ? "bg-blue-500/15 border-blue-500/30" :
                                       "bg-white/[0.03] border-white/[0.08]"
                }`}>
                  {state === "done"
                    ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    : state === "active"
                      ? <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                      : <div className="w-1.5 h-1.5 rounded-full bg-white/15" />
                  }
                </div>
                {!isLast && (
                  <div className={`w-px my-1 ${state === "done" ? "bg-emerald-500/20" : "bg-white/[0.06]"}`}
                    style={{ minHeight: 16 }} />
                )}
              </div>
              <div className={`pb-4 ${isLast ? "pb-0" : ""}`}>
                <p className={`text-xs font-medium leading-6 ${
                  state === "done"   ? "text-white/70" :
                  state === "active" ? "text-blue-300 font-semibold" :
                                       "text-white/25"
                }`}>{phase.label}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Run results ───────────────────────────────────────────────────────────────

function RunResults({ run }: { run: BacktestRun }) {
  const [trades, setTrades]         = useState<BacktestTrade[] | null>(null)
  const [loadingTrades, setLT]      = useState(false)
  const [showTrades, setShowTrades] = useState(false)

  const pnlPos = (run.total_pnl_pips ?? 0) > 0
  const wrGood = (run.win_rate ?? 0) >= 50

  async function loadTrades() {
    if (trades) { setShowTrades(v => !v); return }
    setLT(true)
    try {
      const r = await api.getBacktestTrades(run.id)
      setTrades(r.trades)
      setShowTrades(true)
    } catch { /* ignore */ }
    finally { setLT(false) }
  }

  const equityData = (run.equity_curve_json ?? []).map((p: { ts?: string; day?: string; cumul_usd?: number; cumul_pips?: number }) => ({
    time: p.ts ? new Date(p.ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) :
          p.day ? new Date(p.day).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "",
    value: p.cumul_usd ?? p.cumul_pips ?? 0,
  }))

  const symbolStats = run.symbol_stats_json ?? []

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          {run.group_name && <p className="text-sm font-bold text-white">{run.group_name}</p>}
          <p className="text-xs text-white/30 mt-0.5">
            {fmtTs(run.started_at)} · {run.total_messages ?? 0} messages
          </p>
        </div>
        {run.use_ai && (
          <span className="text-[10px] px-2.5 py-1 rounded-full border border-violet-500/20 text-violet-400 font-semibold"
            style={{ background: "rgba(139,92,246,0.08)" }}>
            AI mode
          </span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="P&L" value={fmtPips(run.total_pnl_pips)}
          sub={run.total_pnl_usd !== null ? fmtUsd(run.total_pnl_usd) : undefined}
          positive={pnlPos} />
        <KpiCard label="Final balance" value={run.final_balance_usd !== null ? `$${run.final_balance_usd?.toFixed(2)}` : "—"}
          sub={`from $${run.starting_balance_usd?.toFixed(0) ?? 1000}`}
          positive={run.final_balance_usd !== null ? run.final_balance_usd > (run.starting_balance_usd ?? 1000) : null} />
        <KpiCard label="Win rate" value={fmtPct(run.win_rate)}
          sub={`${run.winning_trades ?? 0}W / ${run.losing_trades ?? 0}L`}
          positive={wrGood ? true : false} />
        <KpiCard label="Profit factor" value={run.profit_factor !== null ? fmtNum(run.profit_factor) : "—"}
          positive={run.profit_factor !== null ? run.profit_factor > 1 : null} />
        <KpiCard label="Sharpe ratio" value={run.sharpe_ratio !== null ? fmtNum(run.sharpe_ratio) : "—"}
          positive={run.sharpe_ratio !== null ? run.sharpe_ratio > 0 : null} />
        <KpiCard label="Max drawdown" value={run.max_drawdown_pips !== null ? `${fmtNum(run.max_drawdown_pips, 1)} pips` : "—"}
          sub={run.max_drawdown_usd !== null ? fmtUsd(-(run.max_drawdown_usd ?? 0)) : undefined}
          positive={false} />
        <KpiCard label="Avg trade" value={fmtPips(run.avg_pnl_pips)}
          sub={`duration: ${fmtDur(run.avg_trade_duration_min)}`} />
        <KpiCard label="Best trade" value={fmtPips(run.best_trade_pips)}
          sub={run.best_trade_usd !== null ? fmtUsd(run.best_trade_usd) : undefined}
          positive={true} />
      </div>

      {/* Equity curve */}
      {equityData.length > 1 && (
        <div className="rounded-2xl border border-white/[0.07] p-5"
          style={{ background: "rgba(255,255,255,0.025)" }}>
          <p className="text-xs font-semibold text-white/50 mb-4">Equity curve</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="btGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} tickLine={false} axisLine={false} width={50} />
                <Tooltip
                  contentStyle={{ background: "#0b0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: "rgba(255,255,255,0.5)" }}
                  itemStyle={{ color: "#10b981" }}
                />
                <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fill="url(#btGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Symbol breakdown */}
      {symbolStats.length > 0 && (
        <div className="rounded-2xl border border-white/[0.07] overflow-hidden"
          style={{ background: "rgba(255,255,255,0.025)" }}>
          <div className="px-5 py-3 border-b border-white/[0.06]">
            <p className="text-xs font-semibold text-white/50">Performance by symbol</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
              <thead>
                <tr className="border-b border-white/[0.05]" style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["Symbol", "Trades", "Win rate", "P&L (pips)"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-white/25">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {symbolStats.map((s, i) => (
                  <tr key={s.symbol}
                    className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i === symbolStats.length - 1 ? "border-b-0" : ""}`}>
                    <td className="px-4 py-2.5 font-bold text-xs text-white">{s.symbol}</td>
                    <td className="px-4 py-2.5 text-xs text-white/55">{s.trades} ({s.wins}W / {s.losses}L)</td>
                    <td className="px-4 py-2.5 text-xs font-mono">
                      <span className={s.win_rate >= 55 ? "text-emerald-400" : s.win_rate >= 40 ? "text-amber-400" : "text-red-400"}>
                        {s.win_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono">
                      <span className={s.pnl_pips >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {s.pnl_pips >= 0 ? "+" : ""}{s.pnl_pips.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trades toggle */}
      <button
        onClick={loadTrades}
        disabled={loadingTrades}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white/50 hover:text-white/75 border border-white/[0.07] hover:border-white/[0.14] transition-all"
        style={{ background: "rgba(255,255,255,0.025)" }}
      >
        {loadingTrades
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : showTrades ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
        }
        {showTrades ? "Hide trades" : `View all trades (${run.trades_filled ?? 0})`}
      </button>

      {/* Trades table */}
      {showTrades && trades && trades.length > 0 && (
        <div className="rounded-2xl border border-white/[0.07] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-white/[0.07]" style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["Symbol","Dir","P&L (pips)","P&L (USD)","Entry","Exit","Outcome","Duration"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-white/25">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={t.id ?? i} className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i === trades.length - 1 ? "border-b-0" : ""}`}>
                    <td className="px-3 py-2 font-bold text-xs text-white">{t.symbol}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        t.order_type === "BUY"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-red-500/10 text-red-400 border-red-500/20"
                      }`}>{t.order_type}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <span className={t.pnl_pips !== null && t.pnl_pips > 0 ? "text-emerald-400" : t.pnl_pips !== null && t.pnl_pips < 0 ? "text-red-400" : "text-white/40"}>
                        {fmtPips(t.pnl_pips)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <span className={t.pnl_usd !== null && t.pnl_usd > 0 ? "text-emerald-400" : t.pnl_usd !== null && t.pnl_usd < 0 ? "text-red-400" : "text-white/40"}>
                        {fmtUsd(t.pnl_usd)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-white/50">{t.actual_entry?.toFixed(5) ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-white/50">{t.exit_price?.toFixed(5) ?? "—"}</td>
                    <td className="px-3 py-2"><OutcomeBadge outcome={t.outcome} /></td>
                    <td className="px-3 py-2 text-xs text-white/30">{fmtDur(t.duration_min)}</td>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BacktestPage() {
  const { user } = useDashboard()
  const [runId, setRunId]       = useState<string | null>(null)
  const [run, setRun]           = useState<BacktestRun | null>(null)
  const [polling, setPolling]   = useState(false)
  const [history, setHistory]   = useState<BacktestRun[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const intervalRef             = useRef<ReturnType<typeof setInterval> | null>(null)

  const isRunning = run ? run.status.startsWith("running") : false

  const fetchRun = useCallback(async (id: string) => {
    try {
      const r = await api.getBacktest(id)
      setRun(r)
      return r
    } catch { return null }
  }, [])

  const loadHistory = useCallback(async () => {
    if (!user) return
    try {
      const res = await api.listBacktests(user.user_id)
      setHistory(res.runs)
    } catch { /* ignore */ }
  }, [user])

  useEffect(() => { if (user) loadHistory() }, [user, loadHistory])

  useEffect(() => {
    if (!runId) return
    setPolling(true)
    fetchRun(runId)

    intervalRef.current = setInterval(async () => {
      const r = await fetchRun(runId)
      if (r && !r.status.startsWith("running")) {
        clearInterval(intervalRef.current!)
        setPolling(false)
        loadHistory()
      }
    }, 3000)

    return () => { clearInterval(intervalRef.current!) }
  }, [runId, fetchRun, loadHistory])

  function handleStarted(id: string) {
    setRunId(id)
    setRun(null)
  }

  void polling

  if (!user) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-white/30">Connect your account to run backtests.</p>
    </div>
  )

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-black text-white">Backtest</h2>
        <p className="text-sm text-white/35 mt-0.5">Simulate your signal room on historical messages</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Form + history */}
        <div className="lg:col-span-2 space-y-3">
          <RunForm onStarted={handleStarted} disabled={isRunning} />

          {/* Previous runs */}
          <div className="rounded-2xl border border-white/[0.07] overflow-hidden"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <button
              onClick={() => setShowHistory(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-white/30" />
                <span className="text-xs font-semibold text-white/45">
                  Previous runs {history.filter(r => r.status === "done").length > 0 && `(${history.filter(r => r.status === "done").length})`}
                </span>
              </div>
              {showHistory ? <ChevronUp className="w-3.5 h-3.5 text-white/25" /> : <ChevronDown className="w-3.5 h-3.5 text-white/25" />}
            </button>
            {showHistory && (
              <div className="px-3 pb-3">
                <HistoryList
                  runs={history}
                  onSelect={r => { setRun(r); setRunId(r.id) }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Results panel */}
        <div className="lg:col-span-3">
          {!run && !runId && (
            <div className="rounded-2xl border border-white/[0.07] p-10 text-center h-full flex flex-col items-center justify-center gap-3"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.15)" }}>
                <TrendingUp className="w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-white/40">Configure and run a backtest to see results here</p>
              {history.filter(r => r.status === "done").length > 0 && (
                <p className="text-xs text-white/25">Or select a previous run from the history panel</p>
              )}
            </div>
          )}

          {run && run.status !== "done" && run.status !== "error" && run.status !== "cancelled" && (
            <RunProgress run={run} onRefresh={() => runId && fetchRun(runId)} userId={user.user_id} />
          )}

          {run && run.status === "done" && (
            <RunResults run={run} />
          )}

          {run && (run.status === "error" || run.status === "cancelled") && (
            <RunProgress run={run} onRefresh={() => runId && fetchRun(runId)} userId={user.user_id} />
          )}
        </div>
      </div>
    </div>
  )
}
