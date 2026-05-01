"use client"

import { useCallback, useEffect, useState } from "react"
import {
  LayoutDashboard, Users, Bot, Radio, TrendingUp, Cpu,
  DollarSign, AlertCircle, RefreshCw, ChevronRight, ChevronDown,
  ArrowUpRight, ArrowDownRight, Activity, MessageSquare, Search, X,
} from "lucide-react"
import {
  adminApi,
  type AdminOverview,
  type AdminUser,
  type AdminUserDetail,
  type AiStats,
  type AiLog,
  type SignalStats,
  type SignalLog,
  type TradeStats,
  type StrategyLog,
  type Revenue,
  type MessageUser,
  type Message,
  type BotMessage,
} from "@/src/lib/admin-api"

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "overview" | "users" | "ai" | "signals" | "trades" | "strategy" | "revenue" | "messages"

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview",  label: "Overview",    Icon: LayoutDashboard },
  { id: "users",     label: "Users",       Icon: Users           },
  { id: "messages",  label: "Messages",    Icon: MessageSquare   },
  { id: "ai",        label: "AI & Costs",  Icon: Bot             },
  { id: "signals",   label: "Signals",     Icon: Radio           },
  { id: "trades",    label: "Trades",      Icon: TrendingUp      },
  { id: "strategy",  label: "Strategy",    Icon: Cpu             },
  { id: "revenue",   label: "Revenue",     Icon: DollarSign      },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return "—"
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtInt(n: number | null | undefined) {
  if (n == null) return "—"
  return n.toLocaleString("en-US")
}

function pct(wins: number, total: number) {
  if (!total) return "0%"
  return `${Math.round((wins / total) * 100)}%`
}

function Pill({ children, color }: { children: React.ReactNode; color?: "green" | "red" | "amber" | "blue" | "purple" }) {
  const map = {
    green:  "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    red:    "bg-red-500/10 text-red-400 border-red-500/20",
    amber:  "bg-amber-500/10 text-amber-400 border-amber-500/20",
    blue:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  }
  const cls = map[color ?? "blue"]
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${cls}`}>
      {children}
    </span>
  )
}

function KpiCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: "up" | "down" | "neutral" }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-1.5">
      <p className="text-xs text-white/40 font-medium">{label}</p>
      <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
      {sub && (
        <p className={`text-xs flex items-center gap-1 ${
          trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-white/40"
        }`}>
          {trend === "up" && <ArrowUpRight className="w-3 h-3" />}
          {trend === "down" && <ArrowDownRight className="w-3 h-3" />}
          {sub}
        </p>
      )}
    </div>
  )
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-white/70">{title}</h2>
      {action}
    </div>
  )
}

function Table({ cols, rows }: { cols: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {cols.map(c => (
              <th key={c} className="text-left px-4 py-2.5 text-xs font-medium text-white/40 whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-white/70 whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="px-4 py-6 text-center text-white/30 text-xs">No data</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function DayRange({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-white/60 focus:outline-none"
    >
      {[7, 14, 30, 60, 90].map(d => (
        <option key={d} value={d}>{d}d</option>
      ))}
    </select>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: AdminOverview }) {
  const { users, signals, trades, ai, strategy, revenue } = data
  const winRate = trades.total > 0 ? Math.round((trades.wins / trades.total) * 100) : 0
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Users"    value={fmtInt(users.total)}    sub={`${users.active} active`} trend="neutral" />
        <KpiCard label="Monthly Revenue" value={`$${fmt(revenue.monthly_usd, 0)}`} sub="estimated MRR" trend="neutral" />
        <KpiCard label="Total Trades"   value={fmtInt(trades.total)}   sub={`${winRate}% win rate`} trend="neutral" />
        <KpiCard label="Total P&L"      value={`$${fmt(trades.total_pnl)}`} sub={`${fmtInt(trades.wins)} wins / ${fmtInt(trades.losses)} losses`} trend={trades.total_pnl >= 0 ? "up" : "down"} />
        <KpiCard label="Messages"       value={fmtInt(signals.total)}  sub={`${fmtInt(signals.signals)} signals`} trend="neutral" />
        <KpiCard label="Signal Errors"  value={fmtInt(signals.errors)} sub="processing failures" trend={signals.errors > 0 ? "down" : "neutral"} />
        <KpiCard label="AI Calls"       value={fmtInt(ai.calls)}       sub={`$${fmt(ai.total_cost, 4)} total cost`} trend="neutral" />
        <KpiCard label="Strategy Execs" value={fmtInt(strategy.total)} sub={`${fmtInt(strategy.errors)} errors`} trend={strategy.errors > 0 ? "down" : "neutral"} />
      </div>

      <div>
        <SectionHeader title="Revenue by plan" />
        <Table
          cols={["Plan", "Active users", "Price", "MRR"]}
          rows={revenue.by_plan.map(p => [
            <Pill key={p.plan} color={p.plan === "elite" ? "purple" : p.plan === "pro" ? "blue" : "green"}>{p.plan || "—"}</Pill>,
            fmtInt(p.cnt),
            `$${p.plan ? ({ core: 79, pro: 149, elite: 299 } as Record<string, number>)[p.plan] ?? 0 : 0}`,
            "",
          ])}
        />
      </div>
    </div>
  )
}

function UsersTab() {
  const [users, setUsers]     = useState<AdminUser[] | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [detail, setDetail]   = useState<AdminUserDetail | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    adminApi.getUsers()
      .then(setUsers)
      .catch(e => setError(String(e)))
  }, [])

  const openDetail = useCallback(async (uid: string) => {
    if (selected === uid) { setSelected(null); setDetail(null); return }
    setSelected(uid)
    setDetail(null)
    try {
      const d = await adminApi.getUserDetail(uid)
      setDetail(d)
    } catch {
      setDetail(null)
    }
  }, [selected])

  if (error) return <ErrorBanner message={error} />
  if (!users) return <Spinner />

  return (
    <div className="space-y-4">
      <p className="text-xs text-white/40">{users.length} users — click a row to expand</p>
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {["Phone", "Plan", "Status", "Signals", "Trades", "P&L", "AI Cost", "Joined", ""].map(c => (
                <th key={c} className="text-left px-4 py-2.5 text-xs font-medium text-white/40 whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <>
                <tr
                  key={u.user_id}
                  className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
                  onClick={() => openDetail(u.user_id)}
                >
                  <td className="px-4 py-2.5 font-mono text-white/70 text-xs">{u.phone}</td>
                  <td className="px-4 py-2.5"><Pill color={u.plan === "elite" ? "purple" : u.plan === "pro" ? "blue" : "green"}>{u.plan || "free"}</Pill></td>
                  <td className="px-4 py-2.5"><Pill color={u.active ? "green" : "amber"}>{u.active ? "active" : "paused"}</Pill></td>
                  <td className="px-4 py-2.5 text-white/60">{fmtInt(u.signal_count)}</td>
                  <td className="px-4 py-2.5 text-white/60">{fmtInt(u.trade_count)}</td>
                  <td className={`px-4 py-2.5 font-mono ${(u.total_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>${fmt(u.total_pnl)}</td>
                  <td className="px-4 py-2.5 text-white/60">${fmt(u.ai_cost, 4)}</td>
                  <td className="px-4 py-2.5 text-white/40 text-xs">{u.created_at.slice(0, 10)}</td>
                  <td className="px-4 py-2.5 text-white/30">
                    {selected === u.user_id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </td>
                </tr>
                {selected === u.user_id && (
                  <tr key={`${u.user_id}-detail`} className="border-b border-white/[0.04]">
                    <td colSpan={9} className="px-4 py-4 bg-white/[0.01]">
                      {!detail ? (
                        <div className="flex items-center gap-2 text-white/30 text-xs"><Activity className="w-3.5 h-3.5 animate-spin" />Loading…</div>
                      ) : (
                        <UserDetailPanel detail={detail} />
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function UserDetailPanel({ detail }: { detail: AdminUserDetail }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
      <div className="space-y-2">
        <p className="font-semibold text-white/60 uppercase tracking-wider">Account</p>
        <div className="space-y-1 text-white/50">
          <p>MT5 login: <span className="text-white/70 font-mono">{detail.user.mt5_login ?? "—"}</span></p>
          <p>Server: <span className="text-white/70">{detail.user.mt5_server ?? "—"}</span></p>
          <p>Drawdown alert: <span className="text-white/70">{detail.user.drawdown_alert_pct != null ? `${detail.user.drawdown_alert_pct}%` : "—"}</span></p>
        </div>
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-white/60 uppercase tracking-wider">Trades</p>
        <div className="space-y-1 text-white/50">
          <p>Total: <span className="text-white/70">{fmtInt(detail.trades.total)}</span></p>
          <p>Wins: <span className="text-white/70">{fmtInt(detail.trades.wins)} ({pct(detail.trades.wins, detail.trades.total)})</span></p>
          <p>P&L: <span className={`font-mono ${detail.trades.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>${fmt(detail.trades.total_pnl)}</span></p>
          <p>Avg: <span className="text-white/70 font-mono">${fmt(detail.trades.avg_pnl)}</span></p>
        </div>
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-white/60 uppercase tracking-wider">AI by type</p>
        <div className="space-y-1 text-white/50">
          {detail.ai_by_type.map(a => (
            <p key={a.call_type}>{a.call_type}: <span className="text-white/70">{fmtInt(a.calls)} calls · ${fmt(a.cost, 4)}</span></p>
          ))}
          {detail.ai_by_type.length === 0 && <p>No AI logs</p>}
        </div>
      </div>
      {detail.groups.length > 0 && (
        <div className="sm:col-span-3 space-y-2">
          <p className="font-semibold text-white/60 uppercase tracking-wider">Groups</p>
          <div className="flex flex-wrap gap-2">
            {detail.groups.map(g => (
              <span key={g.group_id} className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-white/60">
                {g.group_name} <span className="text-white/30">#{g.group_id}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AiTab() {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<AiStats | null>(null)
  const [logs, setLogs] = useState<{ total: number; logs: AiLog[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logOffset, setLogOffset] = useState(0)
  const LOG_LIMIT = 50

  const load = useCallback(async (d: number, offset = 0) => {
    setError(null)
    try {
      const [s, l] = await Promise.all([
        adminApi.getAiStats(d),
        adminApi.getAiLogs({ limit: LOG_LIMIT, offset }),
      ])
      setStats(s)
      setLogs(l)
      setLogOffset(offset)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => { load(days) }, [days, load])

  if (error) return <ErrorBanner message={error} />
  if (!stats || !logs) return <Spinner />

  const totalCost = stats.by_type.reduce((s, r) => s + (r.cost ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="AI Usage" />
        <DayRange value={days} onChange={d => { setDays(d); setLogOffset(0) }} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Cost" value={`$${fmt(totalCost, 4)}`} />
        <KpiCard label="Total Calls" value={fmtInt(stats.by_type.reduce((s, r) => s + r.calls, 0))} />
        <KpiCard label="Total Tokens" value={fmtInt(stats.by_type.reduce((s, r) => s + (r.tokens ?? 0), 0))} />
        <KpiCard label="Errors" value={fmtInt(stats.by_type.reduce((s, r) => s + r.errors, 0))} trend={stats.by_type.some(r => r.errors > 0) ? "down" : "neutral"} />
      </div>

      <div>
        <SectionHeader title="By call type" />
        <Table
          cols={["Type", "Calls", "Cost", "Tokens", "Avg latency", "Errors"]}
          rows={stats.by_type.map(r => [
            <Pill key={r.call_type} color="blue">{r.call_type}</Pill>,
            fmtInt(r.calls),
            `$${fmt(r.cost, 4)}`,
            fmtInt(r.tokens),
            r.avg_latency_ms ? `${fmtInt(r.avg_latency_ms)}ms` : "—",
            r.errors > 0 ? <span className="text-red-400">{r.errors}</span> : "0",
          ])}
        />
      </div>

      <div>
        <SectionHeader title="By model" />
        <Table
          cols={["Model", "Calls", "Cost", "Tokens"]}
          rows={stats.by_model.map(r => [
            <span key={r.model} className="font-mono text-xs text-white/60">{r.model}</span>,
            fmtInt(r.calls),
            `$${fmt(r.cost, 4)}`,
            fmtInt(r.tokens),
          ])}
        />
      </div>

      <div>
        <SectionHeader title={`Recent AI logs (${fmtInt(logs.total)} total)`} />
        <div className="space-y-2">
          {logs.logs.map(log => (
            <AiLogRow key={log.id} log={log} />
          ))}
        </div>
        <Pagination total={logs.total} limit={LOG_LIMIT} offset={logOffset} onChange={o => load(days, o)} />
      </div>
    </div>
  )
}

function AiLogRow({ log }: { log: AiLog }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-white/30 font-mono w-10 shrink-0">#{log.id}</span>
        <span className="text-white/40 shrink-0">{log.ts.slice(0, 16)}</span>
        <Pill color="blue">{log.call_type}</Pill>
        <span className="text-white/40 font-mono text-[10px] shrink-0">{log.model.split("-").slice(-2).join("-")}</span>
        <span className="text-white/50 font-mono shrink-0">${fmt(log.cost_usd, 5)}</span>
        <span className="text-white/40 shrink-0">{fmtInt(log.total_tokens)}tok</span>
        {log.error && <Pill color="red">error</Pill>}
        <span className="text-white/30 ml-auto font-mono text-[10px]">{log.user_id?.slice(-8)}</span>
        {open ? <ChevronDown className="w-3 h-3 text-white/30 shrink-0" /> : <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-white/[0.04] space-y-2 text-xs">
          {log.error && <p className="text-red-400 mt-2">Error: {log.error}</p>}
          {log.context && (
            <pre className="text-white/50 bg-white/[0.02] rounded-lg p-3 overflow-x-auto text-[11px] leading-relaxed max-h-60 overflow-y-auto">
              {JSON.stringify(log.context, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function SignalsTab() {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<SignalStats | null>(null)
  const [logs, setLogs] = useState<{ total: number; logs: SignalLog[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logOffset, setLogOffset] = useState(0)
  const [filterError, setFilterError] = useState<boolean | undefined>(undefined)
  const LOG_LIMIT = 50

  const load = useCallback(async (d: number, offset = 0, fe?: boolean) => {
    setError(null)
    try {
      const [s, l] = await Promise.all([
        adminApi.getSignalStats(d),
        adminApi.getSignalLogs({ hasError: fe, limit: LOG_LIMIT, offset }),
      ])
      setStats(s)
      setLogs(l)
      setLogOffset(offset)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => { load(days, 0, filterError) }, [days, filterError, load])

  if (error) return <ErrorBanner message={error} />
  if (!stats || !logs) return <Spinner />

  const detectionRate = stats.summary.messages > 0
    ? Math.round((stats.summary.signals / stats.summary.messages) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Signal Processing" />
        <DayRange value={days} onChange={d => { setDays(d); setLogOffset(0) }} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Messages" value={fmtInt(stats.summary.messages)} />
        <KpiCard label="Signals" value={fmtInt(stats.summary.signals)} sub={`${detectionRate}% detection rate`} />
        <KpiCard label="Total Errors" value={fmtInt(stats.summary.errors)} trend={stats.summary.errors > 0 ? "down" : "neutral"} />
        <KpiCard label="MT5 Errors" value={fmtInt(stats.summary.mt5_errors)} trend={stats.summary.mt5_errors > 0 ? "down" : "neutral"} />
      </div>

      {stats.by_error.length > 0 && (
        <div>
          <SectionHeader title="Errors by step" />
          <Table
            cols={["Step", "Count"]}
            rows={stats.by_error.map(r => [
              <Pill key={r.error_step} color="red">{r.error_step}</Pill>,
              fmtInt(r.cnt),
            ])}
          />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-white/70">Logs ({fmtInt(logs.total)} total)</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterError(filterError === true ? undefined : true)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${filterError === true ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-white/[0.08] text-white/40 hover:text-white/60"}`}
            >
              Errors only
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {logs.logs.map(log => (
            <SignalLogRow key={log.id} log={log} />
          ))}
        </div>
        <Pagination total={logs.total} limit={LOG_LIMIT} offset={logOffset} onChange={o => load(days, o, filterError)} />
      </div>
    </div>
  )
}

function SignalLogRow({ log }: { log: SignalLog }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-white/30 font-mono w-10 shrink-0">#{log.id}</span>
        <span className="text-white/40 shrink-0">{log.ts.slice(0, 16)}</span>
        <Pill color={log.is_signal ? "green" : "amber"}>{log.is_signal ? "signal" : "msg"}</Pill>
        {log.error_step && <Pill color="red">{log.error_step}</Pill>}
        <span className="truncate text-white/50 max-w-[200px]">{log.message_text.slice(0, 60)}</span>
        <span className="text-white/30 ml-auto font-mono text-[10px]">{log.group_name ?? log.user_id?.slice(-8)}</span>
        {open ? <ChevronDown className="w-3 h-3 text-white/30 shrink-0" /> : <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-white/[0.04] space-y-3 text-xs mt-2">
          <p className="text-white/60 leading-relaxed whitespace-pre-wrap">{log.message_text}</p>
          {log.error_msg && <p className="text-red-400">Error: {log.error_msg}</p>}
          {log.signals && (
            <pre className="text-white/50 bg-white/[0.02] rounded-lg p-3 overflow-x-auto text-[11px] max-h-48 overflow-y-auto">
              {JSON.stringify(log.signals, null, 2)}
            </pre>
          )}
          {log.results && (
            <pre className="text-white/50 bg-white/[0.02] rounded-lg p-3 overflow-x-auto text-[11px] max-h-48 overflow-y-auto">
              {JSON.stringify(log.results, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function TradesTab() {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<TradeStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    adminApi.getTradeStats(days).then(setStats).catch(e => setError(String(e)))
  }, [days])

  if (error) return <ErrorBanner message={error} />
  if (!stats) return <Spinner />

  const s = stats.summary
  const winRate = s.total > 0 ? Math.round((s.wins / s.total) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Trade Statistics" />
        <DayRange value={days} onChange={setDays} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Trades" value={fmtInt(s.total)} sub={`${winRate}% win rate`} />
        <KpiCard label="Total P&L"    value={`$${fmt(s.total_pnl)}`} trend={s.total_pnl >= 0 ? "up" : "down"} />
        <KpiCard label="Best Trade"   value={`$${fmt(s.best_trade)}`} trend="up" />
        <KpiCard label="Worst Trade"  value={`$${fmt(s.worst_trade)}`} trend="down" />
      </div>

      <div>
        <SectionHeader title="By symbol (top 20)" />
        <Table
          cols={["Symbol", "Trades", "Wins", "Win rate", "P&L"]}
          rows={stats.by_symbol.map(r => [
            <span key={r.symbol} className="font-mono text-white/70">{r.symbol}</span>,
            fmtInt(r.total),
            fmtInt(r.wins),
            pct(r.wins, r.total),
            <span key="pnl" className={`font-mono ${r.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>${fmt(r.pnl)}</span>,
          ])}
        />
      </div>

      <div>
        <SectionHeader title="Top users by P&L" />
        <Table
          cols={["User", "Trades", "P&L"]}
          rows={stats.by_user.map(r => [
            <span key={r.user_id} className="font-mono text-white/60 text-xs">{r.phone ?? r.user_id.slice(-8)}</span>,
            fmtInt(r.total),
            <span key="pnl" className={`font-mono ${r.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>${fmt(r.pnl)}</span>,
          ])}
        />
      </div>
    </div>
  )
}

function StrategyTab() {
  const [logs, setLogs] = useState<{ total: number; logs: StrategyLog[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logOffset, setLogOffset] = useState(0)
  const [filterError, setFilterError] = useState<boolean | undefined>(undefined)
  const LOG_LIMIT = 50

  const load = useCallback(async (offset = 0, fe?: boolean) => {
    setError(null)
    try {
      const l = await adminApi.getStrategyLogs({ hasError: fe, limit: LOG_LIMIT, offset })
      setLogs(l)
      setLogOffset(offset)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => { load(0, filterError) }, [filterError, load])

  if (error) return <ErrorBanner message={error} />
  if (!logs) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader title={`Strategy Executions (${fmtInt(logs.total)} total)`} />
        <button
          onClick={() => setFilterError(filterError === true ? undefined : true)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${filterError === true ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-white/[0.08] text-white/40 hover:text-white/60"}`}
        >
          Errors only
        </button>
      </div>
      <div className="space-y-2">
        {logs.logs.map(log => (
          <StrategyLogRow key={log.id} log={log} />
        ))}
      </div>
      <Pagination total={logs.total} limit={LOG_LIMIT} offset={logOffset} onChange={o => load(o, filterError)} />
    </div>
  )
}

function StrategyLogRow({ log }: { log: StrategyLog }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-white/30 font-mono w-10 shrink-0">#{log.id}</span>
        <span className="text-white/40 shrink-0">{log.ts.slice(0, 16)}</span>
        <Pill color="purple">{log.event_type}</Pill>
        {log.error_msg && <Pill color="red">error</Pill>}
        <span className="truncate text-white/50 max-w-[300px]">{log.management_strategy ?? "—"}</span>
        <span className="text-white/30 ml-auto font-mono text-[10px]">{log.user_id.slice(-8)}</span>
        {open ? <ChevronDown className="w-3 h-3 text-white/30 shrink-0" /> : <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-white/[0.04] space-y-3 text-xs mt-2">
          {log.final_response && (
            <div>
              <p className="text-white/40 mb-1">Final response</p>
              <p className="text-white/60 leading-relaxed whitespace-pre-wrap">{log.final_response}</p>
            </div>
          )}
          {log.error_msg && <p className="text-red-400">Error: {log.error_msg}</p>}
          {log.tool_calls && log.tool_calls.length > 0 && (
            <div>
              <p className="text-white/40 mb-1">Tool calls ({log.tool_calls.length})</p>
              <pre className="text-white/50 bg-white/[0.02] rounded-lg p-3 overflow-x-auto text-[11px] max-h-60 overflow-y-auto">
                {JSON.stringify(log.tool_calls, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

type MsgDirection = "incoming" | "bot"

function MessagesTab() {
  const [users, setUsers]               = useState<MessageUser[] | null>(null)
  const [selectedUser, setSelectedUser] = useState<MessageUser | null>(null)
  const [direction, setDirection]       = useState<MsgDirection>("incoming")
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null)
  const [search, setSearch]             = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [incoming, setIncoming]         = useState<{ total: number; messages: Message[] } | null>(null)
  const [botMsgs, setBotMsgs]           = useState<{ total: number; messages: BotMessage[] } | null>(null)
  const [offset, setOffset]             = useState(0)
  const [loadingMsgs, setLoadingMsgs]   = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [expandedId, setExpandedId]     = useState<number | null>(null)
  const LOG_LIMIT = 50

  useEffect(() => {
    adminApi.getMessageUsers()
      .then(setUsers)
      .catch(e => setError(String(e)))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const loadIncoming = useCallback(async (uid: string, gid: number | null, s: string, off: number) => {
    setLoadingMsgs(true)
    try {
      const res = await adminApi.getMessages({ userId: uid, groupId: gid ?? undefined, search: s || undefined, limit: LOG_LIMIT, offset: off })
      setIncoming(res)
      setOffset(off)
    } catch (e) { setError(String(e)) }
    finally { setLoadingMsgs(false) }
  }, [])

  const loadBot = useCallback(async (uid: string, s: string, off: number) => {
    setLoadingMsgs(true)
    try {
      const res = await adminApi.getBotMessages({ userId: uid, search: s || undefined, limit: LOG_LIMIT, offset: off })
      setBotMsgs(res)
      setOffset(off)
    } catch (e) { setError(String(e)) }
    finally { setLoadingMsgs(false) }
  }, [])

  useEffect(() => {
    if (!selectedUser) return
    setOffset(0)
    setExpandedId(null)
    if (direction === "incoming") loadIncoming(selectedUser.user_id, selectedGroup, debouncedSearch, 0)
    else loadBot(selectedUser.user_id, debouncedSearch, 0)
  }, [selectedUser, direction, selectedGroup, debouncedSearch, loadIncoming, loadBot])

  const selectUser = (u: MessageUser) => {
    setSelectedUser(u)
    setSelectedGroup(null)
    setSearch("")
    setIncoming(null)
    setBotMsgs(null)
    setExpandedId(null)
  }

  if (error) return <ErrorBanner message={error} />
  if (!users) return <Spinner />

  return (
    <div className="flex gap-4 h-[calc(100vh-120px)] min-h-0">

      {/* ── User list sidebar ── */}
      <div className="w-56 shrink-0 flex flex-col gap-1 overflow-y-auto rounded-xl border border-white/[0.06] p-2">
        <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider px-2 py-1">
          Users ({users.length})
        </p>
        {users.map(u => (
          <button
            key={u.user_id}
            onClick={() => selectUser(u)}
            className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
              selectedUser?.user_id === u.user_id
                ? "bg-amber-500/10 border border-amber-500/20 text-amber-300"
                : "border border-transparent text-white/50 hover:bg-white/[0.04] hover:text-white/70"
            }`}
          >
            <p className="text-xs font-mono truncate">{u.phone ?? u.user_id.slice(-8)}</p>
            <p className="text-[10px] text-white/30 mt-0.5">
              {fmtInt(u.msg_count)} in · {fmtInt(u.bot_msg_count)} bot
            </p>
          </button>
        ))}
      </div>

      {/* ── Message pane ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {!selectedUser ? (
          <div className="flex items-center justify-center h-full text-white/20 text-sm">
            Select a user to browse their messages
          </div>
        ) : (
          <>
            {/* Direction + group + search bar */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">

              {/* Direction toggle */}
              <div className="flex rounded-lg overflow-hidden border border-white/[0.08]">
                {(["incoming", "bot"] as MsgDirection[]).map(d => (
                  <button
                    key={d}
                    onClick={() => { setDirection(d); setSelectedGroup(null); setSearch("") }}
                    className={`text-xs px-3 py-1.5 transition-colors ${
                      direction === d
                        ? "bg-amber-500/15 text-amber-400"
                        : "text-white/40 hover:text-white/60 hover:bg-white/[0.04]"
                    }`}
                  >
                    {d === "incoming" ? `Incoming (${fmtInt(selectedUser.msg_count)})` : `Bot sent (${fmtInt(selectedUser.bot_msg_count)})`}
                  </button>
                ))}
              </div>

              {/* Group filter — only for incoming */}
              {direction === "incoming" && selectedUser.groups.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => setSelectedGroup(null)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${selectedGroup === null ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-white/[0.08] text-white/40 hover:text-white/60"}`}
                  >
                    All
                  </button>
                  {selectedUser.groups.map(g => (
                    <button
                      key={g.group_id}
                      onClick={() => setSelectedGroup(g.group_id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors max-w-[140px] truncate ${selectedGroup === g.group_id ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-white/[0.08] text-white/40 hover:text-white/60"}`}
                      title={g.group_name}
                    >
                      {g.group_name}
                    </button>
                  ))}
                </div>
              )}

              {/* Search */}
              <div className="relative ml-auto">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-48 pl-7 pr-7 py-1.5 text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg placeholder:text-white/20 text-white/60 focus:outline-none focus:border-amber-500/30"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            {loadingMsgs ? <Spinner /> : (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
                {direction === "incoming" && incoming && (
                  <>
                    <p className="text-[10px] text-white/30 px-1">{fmtInt(incoming.total)} messages</p>
                    {incoming.messages.map(msg => (
                      <MessageRow key={msg.id} msg={msg} open={expandedId === msg.id} onToggle={() => setExpandedId(expandedId === msg.id ? null : msg.id)} />
                    ))}
                    <Pagination total={incoming.total} limit={LOG_LIMIT} offset={offset} onChange={o => loadIncoming(selectedUser.user_id, selectedGroup, debouncedSearch, o)} />
                  </>
                )}
                {direction === "bot" && botMsgs && (
                  <>
                    <p className="text-[10px] text-white/30 px-1">{fmtInt(botMsgs.total)} messages</p>
                    {botMsgs.messages.map(msg => (
                      <BotMessageRow key={msg.id} msg={msg} open={expandedId === msg.id} onToggle={() => setExpandedId(expandedId === msg.id ? null : msg.id)} />
                    ))}
                    <Pagination total={botMsgs.total} limit={LOG_LIMIT} offset={offset} onChange={o => loadBot(selectedUser.user_id, debouncedSearch, o)} />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MessageRow({ msg, open, onToggle }: { msg: Message; open: boolean; onToggle: () => void }) {
  const isSignal = msg.is_signal === 1
  const hasError = !!msg.error_step

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${
      hasError ? "border-red-500/20 bg-red-500/[0.02]" :
      isSignal ? "border-emerald-500/15 bg-emerald-500/[0.02]" :
      "border-white/[0.06]"
    }`}>
      <button
        className="w-full flex items-start gap-3 px-4 py-2.5 text-xs hover:bg-white/[0.02] transition-colors text-left"
        onClick={onToggle}
      >
        {/* Timestamp + sender */}
        <div className="shrink-0 text-right w-28 space-y-0.5">
          <p className="text-white/30 font-mono">{msg.ts.slice(0, 16).replace("T", " ")}</p>
          {msg.sender_name && <p className="text-white/40 truncate">{msg.sender_name}</p>}
        </div>

        {/* Badges */}
        <div className="shrink-0 flex flex-col gap-1 items-start w-16 pt-0.5">
          {isSignal && <Pill color="green">signal</Pill>}
          {hasError && <Pill color="red">{msg.error_step}</Pill>}
          {!isSignal && !hasError && <Pill color="amber">msg</Pill>}
        </div>

        {/* Group */}
        {msg.group_name && (
          <span className="shrink-0 text-[10px] text-white/30 pt-0.5 max-w-[100px] truncate">{msg.group_name}</span>
        )}

        {/* Message preview */}
        <span className="flex-1 min-w-0 text-white/60 leading-relaxed line-clamp-2 whitespace-pre-wrap">
          {msg.message_text}
        </span>

        {open
          ? <ChevronDown className="w-3 h-3 text-white/20 shrink-0 mt-0.5" />
          : <ChevronRight className="w-3 h-3 text-white/20 shrink-0 mt-0.5" />
        }
      </button>

      {open && (
        <div className="px-4 pb-3 border-t border-white/[0.04] space-y-3 mt-0.5">
          <p className="text-white/70 text-xs leading-relaxed whitespace-pre-wrap mt-2">{msg.message_text}</p>
          {msg.error_step && (
            <p className="text-red-400 text-xs">Error at <strong>{msg.error_step}</strong></p>
          )}
          {msg.signals && msg.signals.length > 0 && (
            <div>
              <p className="text-[10px] text-white/30 mb-1 uppercase tracking-wider">Extracted signals</p>
              <pre className="text-white/50 bg-white/[0.02] rounded-lg p-3 overflow-x-auto text-[11px] max-h-48 overflow-y-auto">
                {JSON.stringify(msg.signals, null, 2)}
              </pre>
            </div>
          )}
          {msg.results && msg.results.length > 0 && (
            <div>
              <p className="text-[10px] text-white/30 mb-1 uppercase tracking-wider">MT5 results</p>
              <pre className="text-white/50 bg-white/[0.02] rounded-lg p-3 overflow-x-auto text-[11px] max-h-48 overflow-y-auto">
                {JSON.stringify(msg.results, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BotMessageRow({ msg, open, onToggle }: { msg: BotMessage; open: boolean; onToggle: () => void }) {
  const typeColor: Record<string, "green" | "amber" | "red" | "blue" | "purple"> = {
    trade_notification: "green",
    drawdown_alert:     "amber",
    drawdown_paused:    "red",
    weekly_report:      "blue",
    monthly_report:     "purple",
  }
  const color = typeColor[msg.message_type ?? ""] ?? "blue"

  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <button
        className="w-full flex items-start gap-3 px-4 py-2.5 text-xs hover:bg-white/[0.02] transition-colors text-left"
        onClick={onToggle}
      >
        <div className="shrink-0 text-right w-28">
          <p className="text-white/30 font-mono">{msg.ts.slice(0, 16).replace("T", " ")}</p>
        </div>
        <div className="shrink-0 w-28">
          <Pill color={color}>{msg.message_type ?? "notification"}</Pill>
        </div>
        <span className="flex-1 min-w-0 text-white/60 leading-relaxed line-clamp-2 whitespace-pre-wrap">
          {msg.message_text}
        </span>
        {open
          ? <ChevronDown className="w-3 h-3 text-white/20 shrink-0 mt-0.5" />
          : <ChevronRight className="w-3 h-3 text-white/20 shrink-0 mt-0.5" />
        }
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-white/[0.04] mt-0.5">
          <p className="text-white/70 text-xs leading-relaxed whitespace-pre-wrap mt-2">{msg.message_text}</p>
        </div>
      )}
    </div>
  )
}

function RevenueTab() {
  const [data, setData] = useState<Revenue | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminApi.getRevenue().then(setData).catch(e => setError(String(e)))
  }, [])

  if (error) return <ErrorBanner message={error} />
  if (!data) return <Spinner />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="Est. Monthly Revenue" value={`$${fmt(data.total_mrr_usd, 0)}`} trend="up" />
        <KpiCard label="Paying Users" value={fmtInt(data.by_plan.filter(p => p.plan).reduce((s, p) => s + (p.active_users || 0), 0))} />
        <KpiCard label="Total Users" value={fmtInt(data.by_plan.reduce((s, p) => s + p.users, 0))} />
      </div>

      <div>
        <SectionHeader title="Revenue by plan" />
        <Table
          cols={["Plan", "Total users", "Active", "Unit price", "MRR"]}
          rows={data.by_plan.map(r => [
            <Pill key={r.plan} color={r.plan === "elite" ? "purple" : r.plan === "pro" ? "blue" : r.plan === "core" ? "green" : "amber"}>{r.plan || "free"}</Pill>,
            fmtInt(r.users),
            fmtInt(r.active_users),
            r.price_usd > 0 ? `$${r.price_usd}` : "—",
            r.mrr_usd > 0 ? <span key="mrr" className="text-emerald-400 font-mono">${fmt(r.mrr_usd, 0)}</span> : "—",
          ])}
        />
      </div>

      <div>
        <SectionHeader title="Recent subscriptions" />
        <Table
          cols={["Phone", "Plan", "Status", "Joined"]}
          rows={data.recent_subscriptions.map(r => [
            <span key={r.user_id} className="font-mono text-xs text-white/60">{r.phone}</span>,
            <Pill key={r.plan} color={r.plan === "elite" ? "purple" : r.plan === "pro" ? "blue" : "green"}>{r.plan || "free"}</Pill>,
            <Pill key={r.active} color={r.active ? "green" : "amber"}>{r.active ? "active" : "paused"}</Pill>,
            r.created_at.slice(0, 10),
          ])}
        />
      </div>

      <div>
        <SectionHeader title="Monthly signups (last 12 months)" />
        <Table
          cols={["Month", "New users"]}
          rows={data.monthly_growth.map(r => [r.month, fmtInt(r.new_users)])}
        />
      </div>
    </div>
  )
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-5 h-5 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-red-500/20 bg-red-600/5 text-sm text-red-400">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  )
}

function Pagination({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (o: number) => void }) {
  const page    = Math.floor(offset / limit) + 1
  const pages   = Math.ceil(total / limit)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4 text-xs text-white/40">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        <button
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
          className="px-3 py-1.5 rounded-lg border border-white/[0.08] disabled:opacity-30 hover:bg-white/[0.04] transition-colors"
        >Prev</button>
        <button
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
          className="px-3 py-1.5 rounded-lg border border-white/[0.08] disabled:opacity-30 hover:bg-white/[0.04] transition-colors"
        >Next</button>
      </div>
    </div>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function AdminShell() {
  const [tab, setTab]           = useState<Tab>("overview")
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminApi.getOverview()
      setOverview(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "linear-gradient(135deg, #07090f 0%, #0b0f1a 100%)" }}
    >
      {/* Sidebar */}
      <aside className="shrink-0 w-[200px] flex flex-col border-r border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="flex items-center gap-2.5 h-14 border-b border-white/[0.06] px-4">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}>
            <span className="text-black text-[10px] font-black">A</span>
          </div>
          <span className="text-sm font-bold tracking-tight text-white select-none">Admin</span>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`
                  w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-all
                  ${active
                    ? "text-amber-400 border border-amber-500/20"
                    : "text-white/40 hover:text-white/70 border border-transparent hover:bg-white/[0.04]"
                  }
                `}
                style={active ? { background: "linear-gradient(90deg, rgba(245,158,11,0.10), transparent)" } : {}}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="font-medium">{label}</span>
              </button>
            )
          })}
        </nav>

        <div className="px-2 pb-3 border-t border-white/[0.05] pt-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header
          className="h-14 shrink-0 border-b border-white/[0.06] flex items-center gap-4 px-6"
          style={{ background: "rgba(7,9,15,0.8)", backdropFilter: "blur(12px)" }}
        >
          <h1 className="text-sm font-semibold text-white/80">
            {TABS.find(t => t.id === tab)?.label}
          </h1>
          {overview && !loading && (
            <div className="ml-auto flex items-center gap-3 text-xs text-white/40">
              <span>{overview.users.active} active users</span>
              <span>·</span>
              <span>${fmt(overview.revenue.monthly_usd, 0)}/mo</span>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

          {tab === "overview"  && (loading ? <Spinner /> : overview ? <OverviewTab data={overview} /> : null)}
          {tab === "users"     && <UsersTab />}
          {tab === "messages"  && <MessagesTab />}
          {tab === "ai"        && <AiTab />}
          {tab === "signals"   && <SignalsTab />}
          {tab === "trades"    && <TradesTab />}
          {tab === "strategy"  && <StrategyTab />}
          {tab === "revenue"   && <RevenueTab />}
        </main>
      </div>
    </div>
  )
}
