"use client"

import { useEffect, useState } from "react"
import {
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts"
import { Loader2, AlertTriangle } from "lucide-react"
import { api, type DashboardStats, type TradeStats, type TrustScore } from "@/src/lib/api"

// ── Colour constants ──────────────────────────────────────────────────────────

const C = {
  emerald: "#10b981",
  cyan:    "#06b6d4",
  amber:   "#f59e0b",
  red:     "#ef4444",
  violet:  "#8b5cf6",
  indigo:  "#6366f1",
  blue:    "#3b82f6",
  orange:  "#f97316",
}

const MODE_PALETTE = [C.emerald, C.cyan, C.amber, C.violet]

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "rgba(5,5,10,0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "12px",
  color: "#e5e7eb",
  fontSize: "12px",
  padding: "8px 12px",
}

const AXIS_TICK = { fill: "rgba(255,255,255,0.25)", fontSize: 10 }

// ── Primitives ────────────────────────────────────────────────────────────────

function SectionLabel({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-white/35">
        {children}
      </h3>
      {sub && <p className="text-[10px] text-white/20 mt-0.5">{sub}</p>}
    </div>
  )
}

function StatCard({
  label, value, sub, valueClass = "text-white", icon,
}: {
  label: string; value: string | number; sub?: string; valueClass?: string; icon: string
}) {
  return (
    <div
      className="rounded-2xl border border-white/[0.08] p-4 flex flex-col gap-2 hover:border-white/[0.14] transition-colors"
      style={{ background: "rgba(255,255,255,0.03)" }}
    >
      <span className="text-lg leading-none">{icon}</span>
      <p className={`text-2xl font-bold font-mono leading-none ${valueClass}`}>{value}</p>
      <p className="text-[11px] text-white/40 leading-tight">{label}</p>
      {sub && <p className="text-[10px] text-white/25 leading-tight">{sub}</p>}
    </div>
  )
}

function InlineBar({ pct, colorClass = "bg-emerald-500" }: { pct: number; colorClass?: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${colorClass}`}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  )
}

function ChartWrap({ children, height = 200 }: { children: React.ReactNode; height?: number }) {
  return (
    <div
      className="rounded-2xl border border-white/[0.08] p-4"
      style={{ height: height + 32, background: "rgba(255,255,255,0.02)" }}
    >
      <ResponsiveContainer width="100%" height={height}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  )
}

function PanelBox({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.08] p-4 ${className}`}
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      {children}
    </div>
  )
}

function CustomBarTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="text-[11px] text-white/40 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-[12px]" style={{ color: p.color }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

function PnlValue({ value, suffix = "" }: { value: number; suffix?: string }) {
  const pos = value > 0
  const neg = value < 0
  return (
    <span className={`font-mono font-bold ${pos ? "text-emerald-400" : neg ? "text-red-400" : "text-white/40"}`}>
      {pos ? "+" : ""}{value.toFixed(2)}{suffix}
    </span>
  )
}

// ── Loading / Error ───────────────────────────────────────────────────────────

function StatsLoading() {
  return (
    <div className="flex items-center gap-3 text-white/40 py-12 justify-center">
      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      <span className="text-sm">Loading statistics…</span>
    </div>
  )
}

function StatsError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 text-red-400 py-8 justify-center">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  )
}

// ── Trade Performance section ─────────────────────────────────────────────────

function TradePerformanceSection({ ts }: { ts: TradeStats }) {
  const {
    total_trades, wins, losses, win_rate,
    avg_profit, median_profit, total_profit,
    gross_profit, gross_loss, profit_factor,
    best_trade, worst_trade, avg_win, avg_loss,
    avg_tp_profit, avg_sl_loss,
    max_consecutive_wins, max_consecutive_losses,
    avg_trades_per_day, active_trading_days,
    by_reason, daily_pnl, weekly_pnl, by_symbol, cumulative_pnl,
  } = ts

  const reasonColor    = (r: string) => r === "TP" ? "text-emerald-400" : r === "SL" ? "text-red-400" : r === "CLIENT" ? "text-blue-400" : "text-white/40"
  const reasonBarColor = (r: string) => r === "TP" ? "bg-emerald-500/60" : r === "SL" ? "bg-red-500/60" : r === "CLIENT" ? "bg-blue-500/60" : "bg-white/20"
  const maxReasonCount = Math.max(...by_reason.map(r => r.count), 1)

  const dailyChartData = daily_pnl.map(d => ({
    day:    d.day.slice(5),
    pnl:    Math.round(d.pnl * 100) / 100,
    trades: d.trades,
    wins:   d.wins,
    losses: d.losses,
  }))

  const cumData = cumulative_pnl.map(p => ({
    ...p,
    fill: p.profit >= 0 ? C.emerald : C.red,
  }))

  const wrColor = win_rate >= 60 ? "text-emerald-400" : win_rate >= 40 ? "text-amber-400" : "text-red-400"

  return (
    <div className="space-y-8">

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-white/[0.06]" />
        <span className="text-[11px] uppercase tracking-widest text-emerald-400 font-semibold px-2">
          📈 Closed Trade Performance
        </span>
        <div className="h-px flex-1 bg-white/[0.06]" />
      </div>

      {/* Performance KPIs */}
      <div>
        <SectionLabel>Performance Metrics</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon="🎯" label="Total trades"   value={total_trades}          />
          <StatCard icon="✅" label="Win rate"        value={`${win_rate}%`}         valueClass={wrColor}
            sub={`${wins} wins / ${losses} losses`} />
          <StatCard icon="📊" label="Profit factor"  value={profit_factor ?? "—"}   valueClass={profit_factor && profit_factor > 1 ? "text-emerald-400" : "text-red-400"}
            sub="gross profit / gross loss" />
          <StatCard icon="💰" label="Total P&L"      value={`${total_profit >= 0 ? "+" : ""}${total_profit.toFixed(2)}`}
            valueClass={total_profit >= 0 ? "text-emerald-400" : "text-red-400"} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard icon="📈" label="Avg P&L / trade"   value={`${avg_profit >= 0 ? "+" : ""}${avg_profit.toFixed(2)}`}        valueClass={avg_profit >= 0 ? "text-emerald-400" : "text-red-400"} />
          <StatCard icon="〰️" label="Median P&L"        value={`${median_profit >= 0 ? "+" : ""}${median_profit.toFixed(2)}`}  valueClass={median_profit >= 0 ? "text-emerald-400" : "text-red-400"} />
          <StatCard icon="🏆" label="Best trade"         value={`+${best_trade.toFixed(2)}`}   valueClass="text-emerald-400" />
          <StatCard icon="💀" label="Worst trade"        value={worst_trade.toFixed(2)}         valueClass="text-red-400" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard icon="📅" label="Active trading days"    value={active_trading_days}      valueClass="text-cyan-400" />
          <StatCard icon="⚡" label="Trades/day (avg)"       value={avg_trades_per_day}       valueClass="text-violet-400" />
          <StatCard icon="🔴" label="Max consecutive losses" value={max_consecutive_losses}   valueClass="text-red-400" />
          <StatCard icon="🟢" label="Max consecutive wins"   value={max_consecutive_wins}     valueClass="text-emerald-400" />
        </div>
      </div>

      {/* Close reason + avg by type */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <SectionLabel sub="TP = Take Profit · SL = Stop Loss · CLIENT = manual close">Close Reason</SectionLabel>
          <PanelBox className="space-y-3">
            {by_reason.map(r => {
              const pct = (r.count / total_trades) * 100
              return (
                <div key={r.reason} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-bold ${reasonColor(r.reason)}`}>{r.reason}</span>
                      <span className="text-white/30">{r.count} trades ({pct.toFixed(1)}%)</span>
                    </div>
                    <PnlValue value={r.avg_profit} />
                  </div>
                  <InlineBar pct={(r.count / maxReasonCount) * 100} colorClass={reasonBarColor(r.reason)} />
                </div>
              )
            })}
          </PanelBox>
        </div>

        <div>
          <SectionLabel sub="Average gain by exit type">Avg Gain by Type</SectionLabel>
          <PanelBox className="space-y-4">
            {[
              { label: "Avg winning trade",  value: avg_win,       icon: "✅", cls: "text-emerald-400" },
              { label: "Avg losing trade",   value: avg_loss,      icon: "❌", cls: "text-red-400"     },
              { label: "Avg TP close",       value: avg_tp_profit, icon: "🎯", cls: "text-emerald-400" },
              { label: "Avg SL close",       value: avg_sl_loss,   icon: "🛑", cls: "text-red-400"     },
              { label: "Total gross profit", value: gross_profit,  icon: "📈", cls: "text-emerald-400" },
              { label: "Total gross loss",   value: -gross_loss,   icon: "📉", cls: "text-red-400"     },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <span>{row.icon}</span>
                  <span>{row.label}</span>
                </div>
                <PnlValue value={row.value} />
              </div>
            ))}
          </PanelBox>
        </div>
      </div>

      {/* Daily P&L */}
      {dailyChartData.length > 0 && (
        <div>
          <SectionLabel sub="Net profit/loss per day (last 90 days)">Daily P&amp;L</SectionLabel>
          <ChartWrap height={200}>
            <BarChart data={dailyChartData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} interval="preserveStartEnd" />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={45} tickFormatter={v => (v >= 0 ? `+${v}` : `${v}`)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "rgba(255,255,255,0.5)", marginBottom: 4 }}
                formatter={(val) => [`${Number(val) >= 0 ? "+" : ""}${Number(val).toFixed(2)}`, "P&L"]} />
              <Bar dataKey="pnl" name="P&L" radius={[2, 2, 0, 0]} fill={C.emerald}>
                {dailyChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? C.emerald : C.red} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ChartWrap>
        </div>
      )}

      {/* Cumulative P&L */}
      {cumData.length > 1 && (
        <div>
          <SectionLabel sub="Cumulative equity curve across all trades">Cumulative P&amp;L</SectionLabel>
          <ChartWrap height={200}>
            <LineChart data={cumData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="index" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                label={{ value: "Trade #", position: "insideBottom", offset: -2, fill: "rgba(255,255,255,0.2)", fontSize: 10 }} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={55}
                tickFormatter={v => (v >= 0 ? `+${v.toFixed(0)}` : `${v.toFixed(0)}`)} />
              <Tooltip contentStyle={TOOLTIP_STYLE}
                labelFormatter={(_, payload) => {
                  const ts = payload?.[0]?.payload?.ts
                  return ts ? new Date(ts).toLocaleString("en-GB") : ""
                }}
                formatter={(val, name) => [`${Number(val) >= 0 ? "+" : ""}${Number(val).toFixed(2)}`, name as string]} />
              <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", paddingTop: "8px" }} />
              <Line type="monotone" dataKey="cumulative" name="Cumulative P&L" stroke={C.emerald} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="profit"     name="Single trade"   stroke={C.amber}   strokeWidth={1} dot={false} strokeOpacity={0.5} strokeDasharray="2 2" />
            </LineChart>
          </ChartWrap>
        </div>
      )}

      {/* Performance by symbol */}
      {by_symbol.length > 0 && (
        <div>
          <SectionLabel sub="Real stats from closed trades per instrument">Performance by Symbol</SectionLabel>
          <div className="rounded-2xl border border-white/[0.08] overflow-x-auto" style={{ background: "rgba(255,255,255,0.02)" }}>
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["Symbol","Trades","Win Rate","Total P&L","Avg P&L","Best","Worst","TP","SL"].map((h, i) => (
                    <th key={h} className={`px-4 py-2.5 text-[10px] uppercase tracking-wider text-white/30 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {by_symbol.map((sym, i) => (
                  <tr key={sym.symbol} className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i % 2 === 1 ? "bg-white/[0.01]" : ""}`}>
                    <td className="px-4 py-3 font-mono font-bold text-white">{sym.symbol}</td>
                    <td className="px-4 py-3 text-right font-mono text-white/70">{sym.total}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono ${sym.win_rate >= 60 ? "text-emerald-400" : sym.win_rate >= 40 ? "text-amber-400" : "text-red-400"}`}>{sym.win_rate}%</span>
                    </td>
                    <td className="px-4 py-3 text-right"><PnlValue value={sym.total_profit} /></td>
                    <td className="px-4 py-3 text-right"><PnlValue value={sym.avg_profit} /></td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-400">+{sym.best_trade.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-400">{sym.worst_trade.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-400">{sym.tp_count}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-400">{sym.sl_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Weekly P&L summary */}
      {weekly_pnl.length > 0 && (
        <div>
          <SectionLabel sub="Results per week (most recent first)">Weekly P&amp;L Summary</SectionLabel>
          <div className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["Week","Trades","Wins","Losses","Win Rate","P&L"].map((h, i) => (
                    <th key={h} className={`px-4 py-2.5 text-[10px] uppercase tracking-wider text-white/30 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...weekly_pnl].reverse().map((w, i) => {
                  const wr = w.trades > 0 ? Math.round(w.wins / w.trades * 100) : 0
                  return (
                    <tr key={w.week} className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i === 0 ? "bg-emerald-500/[0.03]" : i % 2 === 1 ? "bg-white/[0.01]" : ""}`}>
                      <td className="px-4 py-2.5 font-mono text-white/60">
                        {i === 0 && <span className="inline-block mr-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">current</span>}
                        {w.week}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-white/70">{w.trades}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{w.wins}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-red-400">{w.losses}</td>
                      <td className={`px-4 py-2.5 text-right font-mono ${wr >= 60 ? "text-emerald-400" : wr >= 40 ? "text-amber-400" : "text-red-400"}`}>{wr}%</td>
                      <td className="px-4 py-2.5 text-right"><PnlValue value={w.pnl} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Trust Score Section ───────────────────────────────────────────────────────

function TrustScoreSection({ scores }: { scores: TrustScore[] }) {
  if (scores.length === 0) return null

  const labelColor = (label: string) =>
    label === "Excellent" ? "text-emerald-400"
      : label === "Good"  ? "text-cyan-400"
      : label === "Fair"  ? "text-amber-400"
      : "text-red-400"

  const scoreBarColor = (score: number | null) =>
    !score ? "bg-white/20"
      : score >= 75 ? "bg-emerald-500"
      : score >= 55 ? "bg-cyan-500"
      : score >= 35 ? "bg-amber-500"
      : "bg-red-500"

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-white/[0.06]" />
        <span className="text-[11px] uppercase tracking-widest text-cyan-400 font-semibold px-2">
          🏅 Trust Scores
        </span>
        <div className="h-px flex-1 bg-white/[0.06]" />
      </div>

      <div>
        <SectionLabel sub="Signal quality score per group (0–100) based on win rate, profit factor, volume, exec rate and streak">Group Performance Score</SectionLabel>
        <div className="space-y-3">
          {scores.map(s => (
            <PanelBox key={s.group_id}>
              <div className="flex items-center gap-4 flex-wrap">
                {/* Score ring */}
                <div className="flex flex-col items-center gap-1 shrink-0 w-16">
                  <span className={`text-3xl font-bold font-mono ${s.score !== null ? labelColor(s.label) : "text-white/20"}`}>
                    {s.score ?? "—"}
                  </span>
                  <span className={`text-[10px] font-semibold ${s.score !== null ? labelColor(s.label) : "text-white/20"}`}>
                    {s.label}
                  </span>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white/80 truncate">{s.group_name}</span>
                    <span className="text-xs text-white/30 shrink-0">{s.trade_count} trades</span>
                  </div>
                  <div className="w-full">
                    <InlineBar pct={s.score ?? 0} colorClass={scoreBarColor(s.score)} />
                  </div>
                  {s.breakdown && s.breakdown.win_rate_score != null && (
                    <div className="flex gap-4 flex-wrap text-[10px] text-white/30">
                      <span>Win rate: <span className="text-emerald-400">{s.breakdown.win_rate_score.toFixed(1)}pt</span></span>
                      <span>PF: <span className="text-cyan-400">{s.breakdown.profit_factor_score.toFixed(1)}pt</span></span>
                      <span>Volume: <span className="text-violet-400">{s.breakdown.volume_score.toFixed(1)}pt</span></span>
                      <span>Exec: <span className="text-amber-400">{s.breakdown.exec_rate_score.toFixed(1)}pt</span></span>
                      <span>Streak: <span className="text-indigo-400">{s.breakdown.streak_score.toFixed(1)}pt</span></span>
                    </div>
                  )}
                </div>

                {/* Quick stats */}
                <div className="flex gap-4 text-xs shrink-0">
                  {s.win_rate !== null && (
                    <div className="text-center">
                      <p className={`font-mono font-bold ${s.win_rate >= 60 ? "text-emerald-400" : s.win_rate >= 40 ? "text-amber-400" : "text-red-400"}`}>{s.win_rate}%</p>
                      <p className="text-white/30">Win rate</p>
                    </div>
                  )}
                  {s.profit_factor !== null && (
                    <div className="text-center">
                      <p className={`font-mono font-bold ${s.profit_factor > 1 ? "text-emerald-400" : "text-red-400"}`}>{s.profit_factor.toFixed(2)}</p>
                      <p className="text-white/30">PF</p>
                    </div>
                  )}
                  {s.max_consecutive_losses !== null && (
                    <div className="text-center">
                      <p className="font-mono font-bold text-red-400">{s.max_consecutive_losses}</p>
                      <p className="text-white/30">Max losses</p>
                    </div>
                  )}
                </div>
              </div>
            </PanelBox>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function StatsSection({ userId, groupId }: { userId: string; groupId?: number }) {
  const [stats,       setStats]       = useState<DashboardStats | null>(null)
  const [tradeStats,  setTradeStats]  = useState<TradeStats | null>(null)
  const [trustScores, setTrustScores] = useState<TrustScore[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      api.getDashboardStats(userId, groupId),
      api.getTradeStats(userId),
      api.getTrustScores(userId).catch(() => ({ scores: [] })),
    ])
      .then(([s, t, ts]) => {
        setStats(s)
        setTradeStats(t)
        setTrustScores(ts?.scores ?? [])
      })
      .catch(e => setError(e instanceof Error ? e.message : "Unknown error"))
      .finally(() => setLoading(false))
  }, [userId, groupId])

  if (loading) return <StatsLoading />
  if (error)   return <StatsError message={error} />
  if (!stats)  return null

  const {
    total_messages, total_signals, signal_rate,
    total_order_executions, successful_orders, failed_orders, execution_success_rate,
    total_errors, errors_by_step,
    daily_stats, weekly_stats, hourly_distribution,
    top_senders, by_symbol, by_order_type, by_order_mode,
    avg_lot_size, min_lot_size, max_lot_size,
    balance_trend,
  } = stats

  // Derived data
  const dailyChart = daily_stats.map(d => ({ ...d, day: d.day.slice(5) }))

  const hourlyChart = Array.from({ length: 24 }, (_, h) => {
    const found = hourly_distribution.find(d => d.hour === h)
    return { hour: `${String(h).padStart(2, "0")}:00`, messages: found?.messages ?? 0, signals: found?.signals ?? 0 }
  })

  const buySellData = [
    { name: "BUY",  value: by_order_type.BUY,  color: C.emerald },
    { name: "SELL", value: by_order_type.SELL, color: C.red },
  ].filter(d => d.value > 0)
  const totalBuySell = by_order_type.BUY + by_order_type.SELL

  const orderModeData = Object.entries(by_order_mode)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  const maxErr    = Math.max(...errors_by_step.map(e => e.count), 1)
  const maxSender = Math.max(...top_senders.map(s => s.count), 1)

  const symbolBarChart = by_symbol.slice(0, 8).map(s => ({
    symbol:  s.symbol,
    Success: s.successful,
    Failed:  s.failed,
  }))

  const balanceChart = balance_trend.map((p, i) => ({
    ...p,
    index:   i,
    balance: p.balance != null ? Math.round(p.balance * 100) / 100 : null,
    equity:  p.equity  != null ? Math.round(p.equity  * 100) / 100 : null,
  }))

  function rateColor(rate: number)    { return rate >= 70 ? "text-emerald-400" : rate >= 40 ? "text-amber-400" : "text-red-400" }
  function rateBarColor(rate: number) { return rate >= 70 ? "bg-emerald-500"   : rate >= 40 ? "bg-amber-500"   : "bg-red-500"   }

  return (
    <div className="space-y-10">

      {/* ── 1. KEY METRICS ──────────────────────────────────────────────── */}
      <div>
        <SectionLabel>Key Metrics</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon="📨" label="Total messages"   value={total_messages.toLocaleString()}   />
          <StatCard icon="📡" label="Signals detected" value={total_signals.toLocaleString()}
            sub={`${signal_rate}% of messages`} valueClass="text-amber-400" />
          <StatCard icon="📋" label="Orders placed"    value={total_order_executions.toLocaleString()}
            sub={`from ${total_signals} signals`} valueClass="text-cyan-400" />
          <StatCard icon="✅" label="Successful orders" value={successful_orders.toLocaleString()}
            sub={`${execution_success_rate}% success rate`} valueClass="text-emerald-400" />
          <StatCard icon="❌" label="Failed orders"    value={failed_orders.toLocaleString()}
            valueClass={failed_orders > 0 ? "text-red-400" : "text-white/40"} />
          <StatCard icon="⚠️" label="Pipeline errors"  value={total_errors.toLocaleString()}
            valueClass={total_errors > 0 ? "text-orange-400" : "text-white/40"} />
        </div>
      </div>

      {/* Lot sizes */}
      {avg_lot_size !== null && (
        <div>
          <SectionLabel>Lot Sizes</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <StatCard icon="⚖️" label="Avg lot"  value={avg_lot_size}        valueClass="text-violet-400" />
            <StatCard icon="🔽" label="Min lot"  value={min_lot_size ?? "—"} valueClass="text-cyan-400"   />
            <StatCard icon="🔼" label="Max lot"  value={max_lot_size ?? "—"} valueClass="text-emerald-400" />
          </div>
        </div>
      )}

      {/* ── 2. DAILY TREND ──────────────────────────────────────────────── */}
      {dailyChart.length > 0 && (
        <div>
          <SectionLabel sub="Last 90 days">Daily Activity Trend</SectionLabel>
          <ChartWrap height={220}>
            <AreaChart data={dailyChart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id="gMsg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.cyan}    stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C.cyan}    stopOpacity={0}    />
                </linearGradient>
                <linearGradient id="gSig" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.amber}   stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C.amber}   stopOpacity={0}    />
                </linearGradient>
                <linearGradient id="gOrd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.emerald} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C.emerald} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} interval="preserveStartEnd" />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={28} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "rgba(255,255,255,0.5)", marginBottom: 4 }} />
              <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", paddingTop: "8px" }} />
              <Area type="monotone" dataKey="messages"    name="Messages"     stroke={C.cyan}    fill="url(#gMsg)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="signals"     name="Signals"      stroke={C.amber}   fill="url(#gSig)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="orders_sent" name="With orders"  stroke={C.emerald} fill="url(#gOrd)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ChartWrap>
        </div>
      )}

      {/* ── 3. HOURLY DISTRIBUTION + BALANCE TREND ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionLabel sub="Signal count by hour (UTC)">Hourly Distribution</SectionLabel>
          <ChartWrap height={180}>
            <BarChart data={hourlyChart} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="hour" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} interval={3} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={22} />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="messages" name="Messages" fill={`${C.cyan}44`}  radius={[2, 2, 0, 0]} />
              <Bar dataKey="signals"  name="Signals"  fill={C.amber}         radius={[2, 2, 0, 0]} />
            </BarChart>
          </ChartWrap>
        </div>

        {balanceChart.length > 1 ? (
          <div>
            <SectionLabel sub="Snapshot at each processed signal">Balance &amp; Equity Trend</SectionLabel>
            <ChartWrap height={180}>
              <LineChart data={balanceChart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="index" tick={false} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={58}
                  tickFormatter={v => v.toLocaleString("en-US")} />
                <Tooltip contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(_, payload) => {
                    const ts = payload?.[0]?.payload?.ts
                    return ts ? new Date(ts).toLocaleString("en-GB") : ""
                  }} />
                <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", paddingTop: "8px" }} />
                <Line type="monotone" dataKey="balance" name="Balance" stroke={C.emerald} strokeWidth={2}   dot={false} />
                <Line type="monotone" dataKey="equity"  name="Equity"  stroke={C.cyan}    strokeWidth={1.5} dot={false} strokeDasharray="5 3" />
              </LineChart>
            </ChartWrap>
          </div>
        ) : (
          <div>
            <SectionLabel>Balance &amp; Equity Trend</SectionLabel>
            <div className="rounded-2xl border border-white/[0.08] h-[212px] flex items-center justify-center" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-xs text-white/25 italic">Insufficient data</p>
            </div>
          </div>
        )}
      </div>

      {/* ── 4. SYMBOL ANALYSIS ──────────────────────────────────────────── */}
      {by_symbol.length > 0 && (
        <div>
          <SectionLabel sub={`${by_symbol.length} distinct symbols detected`}>Symbol Analysis</SectionLabel>
          {symbolBarChart.length > 0 && (
            <div className="mb-4">
              <ChartWrap height={160}>
                <BarChart data={symbolBarChart} margin={{ top: 5, right: 10, bottom: 5, left: -15 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="symbol" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={25} />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", paddingTop: "6px" }} />
                  <Bar dataKey="Success" fill={C.emerald} radius={[2, 2, 0, 0]} stackId="a" />
                  <Bar dataKey="Failed"  fill={C.red}     radius={[2, 2, 0, 0]} stackId="a" />
                </BarChart>
              </ChartWrap>
            </div>
          )}
          <div className="rounded-2xl border border-white/[0.08] overflow-x-auto" style={{ background: "rgba(255,255,255,0.02)" }}>
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["Symbol","Total","Success","Failed","BUY","SELL","Avg Lot","Success Rate"].map(h => (
                    <th key={h} className={`px-4 py-2.5 text-[10px] uppercase tracking-wider text-white/30 font-medium ${h === "Symbol" ? "text-left" : "text-right"} ${h === "Success Rate" ? "min-w-[140px]" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {by_symbol.map((sym, i) => (
                  <tr key={sym.symbol} className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i % 2 === 1 ? "bg-white/[0.01]" : ""}`}>
                    <td className="px-4 py-3 font-mono font-bold text-white">{sym.symbol}</td>
                    <td className="px-4 py-3 text-right font-mono text-white/70">{sym.total}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-400">{sym.successful}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-400">{sym.failed}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-400">{sym.buy}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-400">{sym.sell}</td>
                    <td className="px-4 py-3 text-right font-mono text-violet-400">{sym.avg_lot ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-[60px]">
                          <InlineBar pct={sym.success_rate} colorClass={rateBarColor(sym.success_rate)} />
                        </div>
                        <span className={`text-[11px] font-mono w-10 text-right shrink-0 ${rateColor(sym.success_rate)}`}>{sym.success_rate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 5. DIRECTION / MODE / ERRORS ────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">

        {/* BUY vs SELL */}
        <div>
          <SectionLabel>Order Direction</SectionLabel>
          {totalBuySell > 0 ? (
            <PanelBox className="flex flex-col items-center gap-3">
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={buySellData} cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={3} dataKey="value">
                    {buySellData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex gap-5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-white/50">BUY</span>
                  <strong className="text-emerald-400 font-mono">{by_order_type.BUY}</strong>
                  <span className="text-white/30">({totalBuySell > 0 ? Math.round(by_order_type.BUY / totalBuySell * 100) : 0}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                  <span className="text-white/50">SELL</span>
                  <strong className="text-red-400 font-mono">{by_order_type.SELL}</strong>
                  <span className="text-white/30">({totalBuySell > 0 ? Math.round(by_order_type.SELL / totalBuySell * 100) : 0}%)</span>
                </div>
              </div>
            </PanelBox>
          ) : (
            <PanelBox className="h-[220px] flex items-center justify-center">
              <p className="text-xs text-white/25 italic">No data</p>
            </PanelBox>
          )}
        </div>

        {/* Order mode */}
        <div>
          <SectionLabel>Order Mode</SectionLabel>
          {orderModeData.length > 0 ? (
            <PanelBox className="flex flex-col items-center gap-3">
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={orderModeData} cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={3} dataKey="value">
                    {orderModeData.map((_, i) => <Cell key={i} fill={MODE_PALETTE[i % MODE_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs">
                {orderModeData.map((m, i) => {
                  const total = orderModeData.reduce((s, x) => s + x.value, 0)
                  return (
                    <div key={m.name} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: MODE_PALETTE[i % MODE_PALETTE.length] }} />
                      <span className="text-white/50">{m.name}</span>
                      <strong className="font-mono" style={{ color: MODE_PALETTE[i % MODE_PALETTE.length] }}>{m.value}</strong>
                      <span className="text-white/30">({Math.round(m.value / total * 100)}%)</span>
                    </div>
                  )
                })}
              </div>
            </PanelBox>
          ) : (
            <PanelBox className="h-[220px] flex items-center justify-center">
              <p className="text-xs text-white/25 italic">No data</p>
            </PanelBox>
          )}
        </div>

        {/* Pipeline errors */}
        <div>
          <SectionLabel>Pipeline Step Errors</SectionLabel>
          {errors_by_step.length > 0 ? (
            <PanelBox className="space-y-3">
              {errors_by_step.map(e => (
                <div key={e.error_step} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-orange-300">{e.error_step}</span>
                    <span className="text-[11px] font-mono text-white/40">{e.count}</span>
                  </div>
                  <InlineBar pct={(e.count / maxErr) * 100} colorClass="bg-orange-500/55" />
                </div>
              ))}
            </PanelBox>
          ) : (
            <PanelBox className="min-h-[100px] flex items-center justify-center">
              <p className="text-xs text-emerald-400 italic">No errors detected</p>
            </PanelBox>
          )}
        </div>
      </div>

      {/* ── 6. TOP SENDERS + WEEKLY SUMMARY ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {top_senders.length > 0 && (
          <div>
            <SectionLabel sub="Most active Telegram senders">Top Senders</SectionLabel>
            <div className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
              {top_senders.map((s, i) => (
                <div key={i} className={`px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.025] transition-colors ${i < top_senders.length - 1 ? "border-b border-white/[0.04]" : ""}`}>
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-[9px] text-emerald-400 font-bold shrink-0">
                    {i + 1}
                  </div>
                  <span className="text-sm text-white/70 truncate flex-1">{s.sender_name}</span>
                  <span className="text-xs font-mono text-emerald-400 shrink-0">{s.count}</span>
                  <div className="w-24 shrink-0">
                    <InlineBar pct={(s.count / maxSender) * 100} colorClass="bg-emerald-500/40" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {weekly_stats.length > 0 && (
          <div>
            <SectionLabel sub="Last 16 weeks (most recent first)">Weekly Summary</SectionLabel>
            <div className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
                    {["Week","Messages","Signals","Orders"].map((h, i) => (
                      <th key={h} className={`px-4 py-2.5 text-[10px] uppercase tracking-wider text-white/30 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...weekly_stats].reverse().map((w, i) => (
                    <tr key={w.week} className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i === 0 ? "bg-emerald-500/[0.03]" : i % 2 === 1 ? "bg-white/[0.01]" : ""}`}>
                      <td className="px-4 py-2.5 font-mono text-white/60">
                        {i === 0 && <span className="inline-block mr-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">current</span>}
                        {w.week}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-white/70">{w.messages}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-amber-400">{w.signals}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{w.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── 7. CLOSED TRADE PERFORMANCE ─────────────────────────────────── */}
      {tradeStats && tradeStats.total_trades > 0 ? (
        <TradePerformanceSection ts={tradeStats} />
      ) : (
        <div className="rounded-2xl border border-white/[0.08] px-6 py-10 text-center" style={{ background: "rgba(255,255,255,0.02)" }}>
          <p className="text-sm text-white/40">No closed trades recorded.</p>
          <p className="text-xs text-white/20 mt-1">
            Performance stats (P&amp;L, win rate, SL/TP hit) will appear here once the bot starts tracking closed positions on MT5.
          </p>
        </div>
      )}

      {/* ── 8. TRUST SCORES ──────────────────────────────────────────────── */}
      {trustScores.length > 0 && (
        <TrustScoreSection scores={trustScores} />
      )}


    </div>
  )
}
