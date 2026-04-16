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
import { api, type DashboardStats, type TradeStats } from "@/src/lib/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/src/components/ui/card"

// ── Costanti colore (tema scuro) ──────────────────────────────────────────────

const C = {
  indigo:  "#6366f1",
  amber:   "#f59e0b",
  emerald: "#10b981",
  red:     "#ef4444",
  violet:  "#8b5cf6",
  blue:    "#3b82f6",
  cyan:    "#06b6d4",
  orange:  "#f97316",
}

const MODE_PALETTE = [C.indigo, C.amber, C.emerald, C.violet]

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "rgba(5, 5, 10, 0.95)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  color: "#e5e7eb",
  fontSize: "12px",
  padding: "8px 12px",
}

const AXIS_TICK = { fill: "rgba(255,255,255,0.35)", fontSize: 10 }

// ── Componenti UI interni ─────────────────────────────────────────────────────

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {children}
      </h3>
      {sub && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{sub}</p>}
    </div>
  )
}

function KpiCard({
  label, value, sub, color = "text-foreground", icon,
}: {
  label: string; value: string | number; sub?: string; color?: string; icon: string
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 px-4 py-4 flex flex-col gap-1.5 hover:border-white/15 transition-colors">
      <span className="text-xl leading-none">{icon}</span>
      <p className={`text-2xl font-bold font-mono leading-none mt-1 ${color}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground/55 leading-tight">{sub}</p>}
    </div>
  )
}

function InlineBar({
  pct, colorClass = "bg-indigo-500",
}: {
  pct: number; colorClass?: string
}) {
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
      className="rounded-xl border border-white/8 bg-black/15 p-4"
      style={{ height: height + 32 }}
    >
      <ResponsiveContainer width="100%" height={height}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  )
}

// ── Custom Tooltip formatters ─────────────────────────────────────────────────

function CustomBarTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={TOOLTIP_STYLE}>
      <p className="text-[11px] text-white/50 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-[12px]" style={{ color: p.color }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ── Caricamento / Errore ──────────────────────────────────────────────────────

function StatsLoading() {
  return (
    <Card className="border-white/10">
      <CardContent className="pt-6 pb-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin shrink-0" />
          <span className="text-sm">Calcolo statistiche in corso…</span>
        </div>
      </CardContent>
    </Card>
  )
}

function StatsError({ message }: { message: string }) {
  return (
    <Card className="border-red-500/20">
      <CardContent className="pt-4 pb-4">
        <p className="text-sm text-red-400">Errore statistiche: {message}</p>
      </CardContent>
    </Card>
  )
}

// ── Helper: formatta P&L con segno e colore ───────────────────────────────────

function PnlValue({ value, suffix = "" }: { value: number; suffix?: string }) {
  const pos = value > 0
  const neg = value < 0
  return (
    <span className={`font-mono font-bold ${pos ? "text-emerald-400" : neg ? "text-red-400" : "text-muted-foreground"}`}>
      {pos ? "+" : ""}{value.toFixed(2)}{suffix}
    </span>
  )
}

// ── Sezione Performance Operazioni ───────────────────────────────────────────

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

  // Colori motivo chiusura
  const reasonColor = (r: string) => {
    if (r === "TP")     return "text-emerald-400"
    if (r === "SL")     return "text-red-400"
    if (r === "CLIENT") return "text-blue-400"
    return "text-muted-foreground"
  }
  const reasonBarColor = (r: string) => {
    if (r === "TP")     return "bg-emerald-500/60"
    if (r === "SL")     return "bg-red-500/60"
    if (r === "CLIENT") return "bg-blue-500/60"
    return "bg-indigo-500/60"
  }

  const maxReasonCount = Math.max(...by_reason.map(r => r.count), 1)

  // Dati daily P&L per grafico
  const dailyChartData = daily_pnl.map(d => ({
    day: d.day.slice(5),
    pnl: Math.round(d.pnl * 100) / 100,
    trades: d.trades,
    wins: d.wins,
    losses: d.losses,
  }))

  // Colore barre P&L giornaliero
  const PnlBarColor = ({ pnl }: { pnl: number }) =>
    pnl >= 0 ? C.emerald : C.red

  // Per il cumulative PnL chart usiamo un custom dot color
  const cumData = cumulative_pnl.map(p => ({
    ...p,
    fill: p.profit >= 0 ? C.emerald : C.red,
  }))

  // By symbol max per bar
  const maxSymPnl = Math.max(...by_symbol.map(s => Math.abs(s.total_profit)), 1)
  const maxSymWinRate = 100

  // Win rate color
  const wrColor = win_rate >= 60 ? "text-emerald-400" : win_rate >= 40 ? "text-amber-400" : "text-red-400"

  return (
    <div className="space-y-8">

      {/* Separatore visivo */}
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-white/8" />
        <span className="text-[11px] uppercase tracking-widest text-indigo-400 font-semibold px-2">
          📈 Performance Operazioni Chiuse
        </span>
        <div className="h-px flex-1 bg-white/8" />
      </div>

      {/* ── KPI Performance ─────────────────────────────────────────── */}
      <div>
        <SectionTitle>Metriche di Performance</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard icon="🎯" label="Operazioni totali"  value={total_trades}           color="text-foreground" />
          <KpiCard icon="✅" label="Win rate"           value={`${win_rate}%`}          color={wrColor}
            sub={`${wins} vincite / ${losses} perdite`} />
          <KpiCard icon="📊" label="Profit factor"     value={profit_factor ?? "—"}    color={profit_factor && profit_factor > 1 ? "text-emerald-400" : "text-red-400"}
            sub="gross profit / gross loss" />
          <KpiCard icon="💰" label="P&L totale"        value={`${total_profit >= 0 ? "+" : ""}${total_profit.toFixed(2)}`}
            color={total_profit >= 0 ? "text-emerald-400" : "text-red-400"} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <KpiCard icon="📈" label="P&L medio per trade"   value={`${avg_profit >= 0 ? "+" : ""}${avg_profit.toFixed(2)}`}
            color={avg_profit >= 0 ? "text-emerald-400" : "text-red-400"} />
          <KpiCard icon="〰️" label="P&L mediano"          value={`${median_profit >= 0 ? "+" : ""}${median_profit.toFixed(2)}`}
            color={median_profit >= 0 ? "text-emerald-400" : "text-red-400"} />
          <KpiCard icon="🏆" label="Miglior trade"         value={`+${best_trade.toFixed(2)}`} color="text-emerald-400" />
          <KpiCard icon="💀" label="Peggior trade"         value={worst_trade.toFixed(2)} color="text-red-400" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <KpiCard icon="📅" label="Giorni trading attivi"     value={active_trading_days}         color="text-indigo-400" />
          <KpiCard icon="⚡" label="Trade/giorno (media)"      value={avg_trades_per_day}          color="text-violet-400" />
          <KpiCard icon="🔴" label="Max perdite consecutive"   value={max_consecutive_losses}      color="text-red-400" />
          <KpiCard icon="🟢" label="Max vincite consecutive"   value={max_consecutive_wins}        color="text-emerald-400" />
        </div>
      </div>

      {/* ── Breakdown motivo chiusura + Avg per tipo ─────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

        {/* Breakdown motivo */}
        <div>
          <SectionTitle sub="TP = Take Profit · SL = Stop Loss · CLIENT = chiusura manuale">Motivo Chiusura</SectionTitle>
          <div className="rounded-xl border border-white/8 bg-black/15 p-4 space-y-3">
            {by_reason.map(r => {
              const pct = (r.count / total_trades) * 100
              return (
                <div key={r.reason} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-bold ${reasonColor(r.reason)}`}>{r.reason}</span>
                      <span className="text-muted-foreground">{r.count} trade ({pct.toFixed(1)}%)</span>
                    </div>
                    <PnlValue value={r.avg_profit} />
                  </div>
                  <InlineBar pct={(r.count / maxReasonCount) * 100} colorClass={reasonBarColor(r.reason)} />
                </div>
              )
            })}
          </div>
        </div>

        {/* Guadagno medio per tipo */}
        <div>
          <SectionTitle sub="Confronto guadagno medio per tipo di uscita">Guadagno Medio per Tipo</SectionTitle>
          <div className="rounded-xl border border-white/8 bg-black/15 p-4 space-y-4">
            {[
              { label: "Media trade vincenti",   value: avg_win,       icon: "✅", color: "text-emerald-400" },
              { label: "Media trade perdenti",   value: avg_loss,      icon: "❌", color: "text-red-400"     },
              { label: "Media chiusure su TP",   value: avg_tp_profit, icon: "🎯", color: "text-emerald-400" },
              { label: "Media chiusure su SL",   value: avg_sl_loss,   icon: "🛑", color: "text-red-400"     },
              { label: "Gross profit totale",    value: gross_profit,  icon: "📈", color: "text-emerald-400" },
              { label: "Gross loss totale",      value: -gross_loss,   icon: "📉", color: "text-red-400"     },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{row.icon}</span>
                  <span>{row.label}</span>
                </div>
                <PnlValue value={row.value} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── P&L giornaliero ──────────────────────────────────────────── */}
      {dailyChartData.length > 0 && (
        <div>
          <SectionTitle sub="Profitto/perdita netta per giorno (ultimi 90 giorni)">P&amp;L Giornaliero</SectionTitle>
          <ChartWrap height={200}>
            <BarChart data={dailyChartData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={45}
                tickFormatter={v => (v >= 0 ? `+${v}` : `${v}`)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: "rgba(255,255,255,0.6)", marginBottom: 4 }}
                formatter={(val) => [`${Number(val) >= 0 ? "+" : ""}${Number(val).toFixed(2)}`, "P&L"]}
              />
              <Bar
                dataKey="pnl"
                name="P&L"
                radius={[2, 2, 0, 0]}
                // ogni barra verde se positiva, rossa se negativa
                fill={C.emerald}
                label={false}
              >
                {dailyChartData.map((entry, index) => (
                  <Cell key={index} fill={entry.pnl >= 0 ? C.emerald : C.red} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ChartWrap>
        </div>
      )}

      {/* ── P&L Cumulativo ───────────────────────────────────────────── */}
      {cumData.length > 1 && (
        <div>
          <SectionTitle sub="Curva equity cumulativa su tutte le operazioni">P&amp;L Cumulativo</SectionTitle>
          <ChartWrap height={200}>
            <LineChart data={cumData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="index"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                label={{ value: "N° trade", position: "insideBottom", offset: -2, fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={55}
                tickFormatter={v => (v >= 0 ? `+${v.toFixed(0)}` : `${v.toFixed(0)}`)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(_, payload) => {
                  const ts = payload?.[0]?.payload?.ts
                  return ts ? new Date(ts).toLocaleString("it-IT") : ""
                }}
                formatter={(val, name) => [
                  `${Number(val) >= 0 ? "+" : ""}${Number(val).toFixed(2)}`,
                  name as string,
                ]}
              />
              <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", paddingTop: "8px" }} />
              <Line
                type="monotone"
                dataKey="cumulative"
                name="P&L cumulativo"
                stroke={C.indigo}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="profit"
                name="Singolo trade"
                stroke={C.amber}
                strokeWidth={1}
                dot={false}
                strokeOpacity={0.5}
                strokeDasharray="2 2"
              />
            </LineChart>
          </ChartWrap>
        </div>
      )}

      {/* ── Performance per Simbolo ──────────────────────────────────── */}
      {by_symbol.length > 0 && (
        <div>
          <SectionTitle sub="Statistiche reali sui trade chiusi per ogni strumento">Performance per Simbolo</SectionTitle>
          <div className="rounded-xl border border-white/8 overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="border-b border-white/8 bg-white/[0.025]">
                  {["Simbolo","Trade","Win Rate","P&L Totale","P&L Medio","Miglior","Peggior","TP","SL"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium ${i === 0 ? "text-left" : "text-right"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {by_symbol.map((sym, i) => (
                  <tr
                    key={sym.symbol}
                    className={`border-b border-white/[0.04] hover:bg-white/[0.025] transition-colors ${i % 2 === 1 ? "bg-white/[0.01]" : ""}`}
                  >
                    <td className="px-4 py-3 font-mono font-bold text-foreground">{sym.symbol}</td>
                    <td className="px-4 py-3 text-right font-mono text-foreground/80">{sym.total}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono ${sym.win_rate >= 60 ? "text-emerald-400" : sym.win_rate >= 40 ? "text-amber-400" : "text-red-400"}`}>
                        {sym.win_rate}%
                      </span>
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

      {/* ── Riepilogo Settimanale P&L ────────────────────────────────── */}
      {weekly_pnl.length > 0 && (
        <div>
          <SectionTitle sub="Risultati per settimana (dalla più recente)">Riepilogo Settimanale P&amp;L</SectionTitle>
          <div className="rounded-xl border border-white/8 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/8 bg-white/[0.025]">
                  {["Settimana","Trade","Vincite","Perdite","Win Rate","P&L"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium ${i === 0 ? "text-left" : "text-right"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...weekly_pnl].reverse().map((w, i) => {
                  const wr = w.trades > 0 ? Math.round(w.wins / w.trades * 100) : 0
                  return (
                    <tr
                      key={w.week}
                      className={`border-b border-white/[0.04] hover:bg-white/[0.025] transition-colors ${i === 0 ? "bg-indigo-600/[0.04]" : i % 2 === 1 ? "bg-white/[0.01]" : ""}`}
                    >
                      <td className="px-4 py-2.5 font-mono text-foreground/70">
                        {i === 0 && (
                          <span className="inline-block mr-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/20">
                            current
                          </span>
                        )}
                        {w.week}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground/80">{w.trades}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{w.wins}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-red-400">{w.losses}</td>
                      <td className={`px-4 py-2.5 text-right font-mono ${wr >= 60 ? "text-emerald-400" : wr >= 40 ? "text-amber-400" : "text-red-400"}`}>
                        {wr}%
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <PnlValue value={w.pnl} />
                      </td>
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

// ── Componente principale ─────────────────────────────────────────────────────

export function StatsSection({ userId }: { userId: string }) {
  const [stats, setStats]         = useState<DashboardStats | null>(null)
  const [tradeStats, setTradeStats] = useState<TradeStats | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      api.getDashboardStats(userId),
      api.getTradeStats(userId),
    ])
      .then(([s, t]) => { setStats(s); setTradeStats(t) })
      .catch(e => setError(e instanceof Error ? e.message : "Errore sconosciuto"))
      .finally(() => setLoading(false))
  }, [userId])

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

  // ── Dati derivati ──────────────────────────────────────────────────────────

  // Daily chart: mostra MM-DD come label
  const dailyChart = daily_stats.map(d => ({
    ...d,
    day: d.day.slice(5), // "YYYY-MM-DD" → "MM-DD"
  }))

  // Hourly: riempie tutti i 24 slot
  const hourlyChart = Array.from({ length: 24 }, (_, h) => {
    const found = hourly_distribution.find(d => d.hour === h)
    return {
      hour:     `${String(h).padStart(2, "0")}:00`,
      messages: found?.messages ?? 0,
      signals:  found?.signals  ?? 0,
    }
  })

  // BUY vs SELL
  const buySellData = [
    { name: "BUY",  value: by_order_type.BUY,  color: C.emerald },
    { name: "SELL", value: by_order_type.SELL, color: C.red },
  ].filter(d => d.value > 0)
  const totalBuySell = by_order_type.BUY + by_order_type.SELL

  // Order mode
  const orderModeData = Object.entries(by_order_mode)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  // Errori
  const maxErr = Math.max(...errors_by_step.map(e => e.count), 1)

  // Top senders
  const maxSender = Math.max(...top_senders.map(s => s.count), 1)

  // Symbol bar chart (top 8)
  const symbolBarChart = by_symbol.slice(0, 8).map(s => ({
    symbol:    s.symbol,
    Riusciti:  s.successful,
    Falliti:   s.failed,
  }))

  // Balance chart: decimale due cifre
  const balanceChart = balance_trend.map((p, i) => ({
    ...p,
    index: i,
    balance: p.balance != null ? Math.round(p.balance * 100) / 100 : null,
    equity:  p.equity  != null ? Math.round(p.equity  * 100) / 100 : null,
  }))

  // Colore success rate dinamico
  function rateColor(rate: number) {
    if (rate >= 70) return "text-emerald-400"
    if (rate >= 40) return "text-amber-400"
    return "text-red-400"
  }
  function rateBarColor(rate: number) {
    if (rate >= 70) return "bg-emerald-500"
    if (rate >= 40) return "bg-amber-500"
    return "bg-red-500"
  }

  return (
    <Card className="border-white/10">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <span className="text-xl">📊</span>
          Statistiche Operazioni
        </CardTitle>
        <CardDescription>
          Analisi completa su {total_messages.toLocaleString("it-IT")} messaggi processati
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-10">

        {/* ═══════════════════════════════════════════════════════════════
            1. KPI METRICHE CHIAVE
        ════════════════════════════════════════════════════════════════ */}
        <div>
          <SectionTitle>Metriche Chiave</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              icon="📨"
              label="Messaggi totali"
              value={total_messages.toLocaleString("it-IT")}
              color="text-foreground"
            />
            <KpiCard
              icon="📡"
              label="Segnali rilevati"
              value={total_signals.toLocaleString("it-IT")}
              sub={`${signal_rate}% dei messaggi`}
              color="text-amber-400"
            />
            <KpiCard
              icon="📋"
              label="Ordini piazzati"
              value={total_order_executions.toLocaleString("it-IT")}
              sub={`su ${total_signals} segnali`}
              color="text-indigo-400"
            />
            <KpiCard
              icon="✅"
              label="Ordini riusciti"
              value={successful_orders.toLocaleString("it-IT")}
              sub={`${execution_success_rate}% success rate`}
              color="text-emerald-400"
            />
            <KpiCard
              icon="❌"
              label="Ordini falliti"
              value={failed_orders.toLocaleString("it-IT")}
              color={failed_orders > 0 ? "text-red-400" : "text-muted-foreground"}
            />
            <KpiCard
              icon="⚠️"
              label="Errori pipeline"
              value={total_errors.toLocaleString("it-IT")}
              color={total_errors > 0 ? "text-orange-400" : "text-muted-foreground"}
            />
          </div>
        </div>

        {/* Lot size KPI (solo se disponibile) */}
        {avg_lot_size !== null && (
          <div>
            <SectionTitle>Dimensione Lotti</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <KpiCard icon="⚖️" label="Lotto medio"   value={avg_lot_size}   color="text-violet-400" />
              <KpiCard icon="🔽" label="Lotto minimo"  value={min_lot_size ?? "—"} color="text-blue-400"   />
              <KpiCard icon="🔼" label="Lotto massimo" value={max_lot_size ?? "—"} color="text-cyan-400"   />
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            2. TREND GIORNALIERO
        ════════════════════════════════════════════════════════════════ */}
        {dailyChart.length > 0 && (
          <div>
            <SectionTitle sub="Ultimi 90 giorni">Trend Giornaliero Attività</SectionTitle>
            <ChartWrap height={220}>
              <AreaChart data={dailyChart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="gMsg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.indigo}  stopOpacity={0.25} />
                    <stop offset="95%" stopColor={C.indigo}  stopOpacity={0}    />
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
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="day"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "rgba(255,255,255,0.6)", marginBottom: 4 }} />
                <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", paddingTop: "8px" }} />
                <Area type="monotone" dataKey="messages"    name="Messaggi"   stroke={C.indigo}  fill="url(#gMsg)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="signals"     name="Segnali"    stroke={C.amber}   fill="url(#gSig)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="orders_sent" name="Con ordini" stroke={C.emerald} fill="url(#gOrd)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ChartWrap>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            3. DISTRIBUZIONE ORARIA + BALANCE TREND
        ════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Distribuzione oraria */}
          <div>
            <SectionTitle sub="Numero segnali per fascia oraria (UTC)">Distribuzione Oraria</SectionTitle>
            <ChartWrap height={180}>
              <BarChart data={hourlyChart} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                  interval={3}
                />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={22} />
                <Tooltip content={<CustomBarTooltip />} />
                <Bar dataKey="messages" name="Messaggi" fill={`${C.indigo}55`} radius={[2, 2, 0, 0]} />
                <Bar dataKey="signals"  name="Segnali"  fill={C.amber}         radius={[2, 2, 0, 0]} />
              </BarChart>
            </ChartWrap>
          </div>

          {/* Balance & Equity trend */}
          {balanceChart.length > 1 ? (
            <div>
              <SectionTitle sub="Snapshot al momento di ogni segnale processato">Andamento Balance &amp; Equity</SectionTitle>
              <ChartWrap height={180}>
                <LineChart data={balanceChart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="index" tick={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                  <YAxis
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                    tickFormatter={v => v.toLocaleString("it-IT")}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={(_, payload) => {
                      const ts = payload?.[0]?.payload?.ts
                      return ts ? new Date(ts).toLocaleString("it-IT") : ""
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", paddingTop: "8px" }} />
                  <Line type="monotone" dataKey="balance" name="Balance" stroke={C.indigo}  strokeWidth={2}   dot={false} />
                  <Line type="monotone" dataKey="equity"  name="Equity"  stroke={C.violet}  strokeWidth={1.5} dot={false} strokeDasharray="5 3" />
                </LineChart>
              </ChartWrap>
            </div>
          ) : (
            <div>
              <SectionTitle>Andamento Balance &amp; Equity</SectionTitle>
              <div className="rounded-xl border border-white/8 bg-black/10 h-[212px] flex items-center justify-center">
                <p className="text-xs text-muted-foreground italic">Dati insufficienti</p>
              </div>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            4. ANALISI PER SIMBOLO — TABELLA COMPLETA
        ════════════════════════════════════════════════════════════════ */}
        {by_symbol.length > 0 && (
          <div>
            <SectionTitle sub={`${by_symbol.length} simboli distinti rilevati`}>Analisi per Simbolo</SectionTitle>

            {/* Bar chart simboli */}
            {symbolBarChart.length > 0 && (
              <div className="mb-4">
                <ChartWrap height={160}>
                  <BarChart data={symbolBarChart} margin={{ top: 5, right: 10, bottom: 5, left: -15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="symbol" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={25} />
                    <Tooltip content={<CustomBarTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", paddingTop: "6px" }} />
                    <Bar dataKey="Riusciti" fill={C.emerald} radius={[2, 2, 0, 0]} stackId="a" />
                    <Bar dataKey="Falliti"  fill={C.red}     radius={[2, 2, 0, 0]} stackId="a" />
                  </BarChart>
                </ChartWrap>
              </div>
            )}

            {/* Tabella dettagliata */}
            <div className="rounded-xl border border-white/8 overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b border-white/8 bg-white/[0.025]">
                    {["Simbolo","Totale","Riusciti","Falliti","BUY","SELL","Avg Lotto","Success Rate"].map(h => (
                      <th
                        key={h}
                        className={`px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium ${h === "Simbolo" ? "text-left" : "text-right"} ${h === "Success Rate" ? "min-w-[140px]" : ""}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {by_symbol.map((sym, i) => (
                    <tr
                      key={sym.symbol}
                      className={`border-b border-white/[0.04] hover:bg-white/[0.025] transition-colors ${i % 2 === 1 ? "bg-white/[0.01]" : ""}`}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-foreground">{sym.symbol}</td>
                      <td className="px-4 py-3 text-right font-mono text-foreground/80">{sym.total}</td>
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
                          <span className={`text-[11px] font-mono w-10 text-right shrink-0 ${rateColor(sym.success_rate)}`}>
                            {sym.success_rate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            5. DIREZIONE / MODALITÀ / ERRORI  (3 colonne)
        ════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">

          {/* BUY vs SELL */}
          <div>
            <SectionTitle>Direzione Ordini</SectionTitle>
            {totalBuySell > 0 ? (
              <div className="rounded-xl border border-white/8 bg-black/15 p-4 flex flex-col items-center gap-3">
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie
                      data={buySellData}
                      cx="50%" cy="50%"
                      innerRadius={38} outerRadius={58}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {buySellData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-foreground/70">BUY</span>
                    <strong className="text-emerald-400 font-mono">{by_order_type.BUY}</strong>
                    <span className="text-muted-foreground">({totalBuySell > 0 ? Math.round(by_order_type.BUY / totalBuySell * 100) : 0}%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                    <span className="text-foreground/70">SELL</span>
                    <strong className="text-red-400 font-mono">{by_order_type.SELL}</strong>
                    <span className="text-muted-foreground">({totalBuySell > 0 ? Math.round(by_order_type.SELL / totalBuySell * 100) : 0}%)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/8 bg-black/15 p-4 h-[220px] flex items-center justify-center">
                <p className="text-xs text-muted-foreground italic">Nessun dato</p>
              </div>
            )}
          </div>

          {/* Modalità Ordine */}
          <div>
            <SectionTitle>Modalità Ordine</SectionTitle>
            {orderModeData.length > 0 ? (
              <div className="rounded-xl border border-white/8 bg-black/15 p-4 flex flex-col items-center gap-3">
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie
                      data={orderModeData}
                      cx="50%" cy="50%"
                      innerRadius={38} outerRadius={58}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {orderModeData.map((_, i) => (
                        <Cell key={i} fill={MODE_PALETTE[i % MODE_PALETTE.length]} />
                      ))}
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
                        <span className="text-foreground/70">{m.name}</span>
                        <strong className="font-mono" style={{ color: MODE_PALETTE[i % MODE_PALETTE.length] }}>{m.value}</strong>
                        <span className="text-muted-foreground">({Math.round(m.value / total * 100)}%)</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/8 bg-black/15 p-4 h-[220px] flex items-center justify-center">
                <p className="text-xs text-muted-foreground italic">Nessun dato</p>
              </div>
            )}
          </div>

          {/* Errori per step */}
          <div>
            <SectionTitle>Errori per Step Pipeline</SectionTitle>
            {errors_by_step.length > 0 ? (
              <div className="rounded-xl border border-white/8 bg-black/15 p-4 space-y-3">
                {errors_by_step.map(e => (
                  <div key={e.error_step} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-orange-300">{e.error_step}</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{e.count}</span>
                    </div>
                    <InlineBar pct={(e.count / maxErr) * 100} colorClass="bg-orange-500/55" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/8 bg-black/15 p-4 h-full min-h-[100px] flex items-center justify-center">
                <p className="text-xs text-emerald-400 italic">Nessun errore rilevato</p>
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            6. TOP SENDERS  +  RIEPILOGO SETTIMANALE
        ════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Top Senders */}
          {top_senders.length > 0 && (
            <div>
              <SectionTitle sub="Mittenti Telegram più attivi">Top Mittenti</SectionTitle>
              <div className="rounded-xl border border-white/8 overflow-hidden">
                {top_senders.map((s, i) => (
                  <div
                    key={i}
                    className={`px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.025] transition-colors ${i < top_senders.length - 1 ? "border-b border-white/[0.04]" : ""}`}
                  >
                    <div className="w-5 h-5 rounded-full bg-indigo-600/20 border border-indigo-500/25 flex items-center justify-center text-[9px] text-indigo-400 font-bold shrink-0">
                      {i + 1}
                    </div>
                    <span className="text-sm text-foreground/80 truncate flex-1">{s.sender_name}</span>
                    <span className="text-xs font-mono text-indigo-400 shrink-0">{s.count}</span>
                    <div className="w-24 shrink-0">
                      <InlineBar pct={(s.count / maxSender) * 100} colorClass="bg-indigo-500/50" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Riepilogo Settimanale */}
          {weekly_stats.length > 0 && (
            <div>
              <SectionTitle sub="Ultime 16 settimane (dalla più recente)">Riepilogo Settimanale</SectionTitle>
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/8 bg-white/[0.025]">
                      {["Settimana","Messaggi","Segnali","Ordini"].map((h, i) => (
                        <th
                          key={h}
                          className={`px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium ${i === 0 ? "text-left" : "text-right"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...weekly_stats].reverse().map((w, i) => (
                      <tr
                        key={w.week}
                        className={`border-b border-white/[0.04] hover:bg-white/[0.025] transition-colors ${i === 0 ? "bg-indigo-600/[0.04]" : i % 2 === 1 ? "bg-white/[0.01]" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-mono text-foreground/70">
                          {i === 0 && (
                            <span className="inline-block mr-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/20">
                              current
                            </span>
                          )}
                          {w.week}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-foreground/80">{w.messages}</td>
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

        {/* ═══════════════════════════════════════════════════════════════
            7. PERFORMANCE OPERAZIONI (da closed_trades)
        ════════════════════════════════════════════════════════════════ */}
        {tradeStats && tradeStats.total_trades > 0 ? (
          <TradePerformanceSection ts={tradeStats} />
        ) : (
          <div className="rounded-xl border border-white/8 bg-black/10 px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nessuna operazione chiusa registrata.
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Le statistiche di performance (P&amp;L, win rate, SL/TP hit) appariranno qui
              non appena il bot inizierà a tracciare le posizioni chiuse su MT5.
            </p>
          </div>
        )}

      </CardContent>
    </Card>
  )
}
