"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Play, RefreshCw, Trash2, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, Minus, AlertTriangle,
  Clock, BarChart2, Users, Target, Zap, DollarSign,
  CheckCircle, XCircle, AlertCircle,
} from "lucide-react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts"
import { api, type BacktestRun, type BacktestTrade, type DashboardUser } from "@/src/lib/api"

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTs(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    })
  } catch { return iso }
}

function fmtPips(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return (v >= 0 ? "+" : "") + v.toFixed(1) + " pip"
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return v.toFixed(1) + "%"
}

function fmtNum(v: number | null, dec = 2): string {
  if (v === null || v === undefined) return "—"
  return v.toFixed(dec)
}

function fmtDur(min: number | null): string {
  if (min === null || min === undefined) return "—"
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}h ${m}m`
}

const STATUS_LABELS: Record<string, string> = {
  "running":                    "In avvio…",
  "running:telegram_fetch":     "📡 Scaricamento messaggi Telegram…",
  "running:signal_detection":   "🔍 Rilevamento segnali (Flash)…",
  "running:signal_extraction":  "🧠 Estrazione segnali (Pro)…",
  "running:ai_pretrade":        "🤖 Decisioni AI pre-trade…",
  "running:mt5_bars":           "📊 Download barre MT5…",
  "running:simulation":         "⚡ Simulazione trade…",
  "done":                       "✅ Completato",
  "error":                      "❌ Errore",
}

function StatusBadge({ status }: { status: string }) {
  const isRunning = status.startsWith("running")
  const isDone    = status === "done"
  const isError   = status === "error"
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${
      isDone  ? "bg-emerald-600/10 text-emerald-400 border-emerald-500/20" :
      isError ? "bg-red-600/10 text-red-400 border-red-500/20" :
                "bg-indigo-600/10 text-indigo-400 border-indigo-500/20"
    }`}>
      {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />}
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  const o = outcome ?? "—"
  const map: Record<string, string> = {
    TP:          "bg-emerald-600/10 text-emerald-400 border-emerald-500/20",
    SL:          "bg-red-600/10 text-red-400 border-red-500/20",
    open_at_end: "bg-amber-600/10 text-amber-400 border-amber-500/20",
    not_filled:  "bg-white/[0.04] text-muted-foreground border-white/10",
    ai_rejected: "bg-orange-600/10 text-orange-400 border-orange-500/20",
  }
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${map[o] ?? "bg-white/[0.04] text-muted-foreground border-white/10"}`}>
      {o}
    </span>
  )
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, positive }: {
  label: string; value: string; sub?: string; positive?: boolean | null
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${
        positive === true ? "text-emerald-400" :
        positive === false ? "text-red-400" : "text-foreground"
      }`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Run form ──────────────────────────────────────────────────────────────────

function RunForm({ user, onStarted }: {
  user: DashboardUser
  onStarted: (runId: string) => void
}) {
  const [mode, setMode]         = useState<"date_limit" | "message_count">("message_count")
  const [dateVal, setDateVal]   = useState("")
  const [countVal, setCountVal] = useState("1000")
  const [useAi, setUseAi]       = useState(false)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  async function submit() {
    setErr(null)
    const limitValue = mode === "date_limit" ? dateVal : countVal
    if (!limitValue) { setErr("Inserisci un valore"); return }
    setLoading(true)
    try {
      const res = await api.startBacktest({
        user_id:    user.user_id,
        group_id:   String(user.group_id),
        group_name: user.group_name,
        mode,
        limit_value: limitValue,
        use_ai:     useAi,
      })
      onStarted(res.run_id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Errore avvio backtest")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Nuovo backtest</h3>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {(["message_count", "date_limit"] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              mode === m
                ? "bg-indigo-600/15 text-indigo-300 border-indigo-500/30"
                : "bg-transparent text-muted-foreground border-white/[0.08] hover:bg-white/[0.04]"
            }`}
          >
            {m === "message_count" ? "Numero messaggi" : "Fino a data"}
          </button>
        ))}
      </div>

      {/* Input */}
      {mode === "message_count" ? (
        <div>
          <label className="text-xs text-muted-foreground">Ultimi N messaggi</label>
          <input
            type="number"
            min={10}
            max={50000}
            value={countVal}
            onChange={e => setCountVal(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm font-mono bg-white/[0.04] border border-white/[0.08] rounded-lg focus:outline-none focus:border-indigo-500/40 transition-all"
          />
          <p className="text-[11px] text-muted-foreground mt-1">Scarica gli ultimi N messaggi dal gruppo</p>
        </div>
      ) : (
        <div>
          <label className="text-xs text-muted-foreground">Fino a questa data (inclusa)</label>
          <input
            type="date"
            value={dateVal}
            onChange={e => setDateVal(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm font-mono bg-white/[0.04] border border-white/[0.08] rounded-lg focus:outline-none focus:border-indigo-500/40 transition-all"
          />
          <p className="text-[11px] text-muted-foreground mt-1">Scarica tutti i messaggi dal più recente fino alla data scelta</p>
        </div>
      )}

      {/* Use AI toggle */}
      <div className="flex items-start gap-3 p-3 bg-white/[0.02] rounded-lg border border-white/[0.06]">
        <button
          role="switch"
          aria-checked={useAi}
          onClick={() => setUseAi(v => !v)}
          className={`shrink-0 w-9 h-5 rounded-full transition-colors ${
            useAi ? "bg-indigo-600" : "bg-white/[0.12]"
          }`}
        >
          <span className={`block w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${
            useAi ? "translate-x-4" : "translate-x-0"
          }`} />
        </button>
        <div>
          <p className="text-xs font-medium text-foreground">Modalità AI agentica</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Usa Gemini Pro per decidere se approvare/modificare ogni segnale secondo la management strategy (più preciso, più lento).
          </p>
        </div>
      </div>

      {err && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {err}
        </p>
      )}

      <button
        onClick={submit}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
      >
        {loading
          ? <><RefreshCw className="w-4 h-4 animate-spin" /> Avvio…</>
          : <><Play className="w-4 h-4" /> Avvia backtest</>
        }
      </button>
    </div>
  )
}

// ── Active run progress ───────────────────────────────────────────────────────

function RunProgress({ run, onRefresh }: { run: BacktestRun; onRefresh: () => void }) {
  const isRunning = run.status.startsWith("running")
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <StatusBadge status={run.status} />
        <button
          onClick={onRefresh}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Aggiorna stato"
        >
          <RefreshCw className={`w-4 h-4 ${isRunning ? "animate-spin" : ""}`} />
        </button>
      </div>

      {run.error_msg && (
        <div className="flex items-start gap-2 p-3 bg-red-600/5 border border-red-500/20 rounded-lg text-xs text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {run.error_msg}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="bg-white/[0.02] rounded-lg p-3 border border-white/[0.05]">
          <p className="text-muted-foreground mb-1">Messaggi</p>
          <p className="font-mono font-semibold">{run.total_messages ?? "…"}</p>
        </div>
        <div className="bg-white/[0.02] rounded-lg p-3 border border-white/[0.05]">
          <p className="text-muted-foreground mb-1">Segnali rilevati</p>
          <p className="font-mono font-semibold">{run.signals_detected ?? "…"}</p>
        </div>
        <div className="bg-white/[0.02] rounded-lg p-3 border border-white/[0.05]">
          <p className="text-muted-foreground mb-1">Segnali estratti</p>
          <p className="font-mono font-semibold">{run.signals_extracted ?? "…"}</p>
        </div>
        <div className="bg-white/[0.02] rounded-lg p-3 border border-white/[0.05]">
          <p className="text-muted-foreground mb-1">Trade simulati</p>
          <p className="font-mono font-semibold">{run.total_trades ?? "…"}</p>
        </div>
      </div>

      {run.period_from && (
        <p className="text-[11px] text-muted-foreground">
          Periodo: {fmtTs(run.period_from)} → {fmtTs(run.period_to)}
        </p>
      )}
    </div>
  )
}

// ── Full results ──────────────────────────────────────────────────────────────

function RunResults({ run, userId }: { run: BacktestRun; userId: string }) {
  const [trades, setTrades]       = useState<BacktestTrade[] | null>(null)
  const [loadingTrades, setLT]    = useState(false)
  const [showTrades, setShowTrades] = useState(false)

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

  const pnlPositive = (run.total_pnl_pips ?? 0) > 0
  const winRateGood = (run.win_rate ?? 0) >= 50

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            {fmtTs(run.started_at)} · {run.total_messages ?? 0} messaggi · {run.period_from ? `${fmtTs(run.period_from)} → ${fmtTs(run.period_to)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run.use_ai && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-600/10 text-violet-400 border border-violet-500/20 font-medium">
              AI agentica
            </span>
          )}
        </div>
      </div>

      {/* KPIs principali */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard
          label="P&L Totale"
          value={fmtPips(run.total_pnl_pips)}
          sub={`${run.trades_filled ?? 0} trade eseguiti`}
          positive={pnlPositive ? true : pnlPositive === false ? false : null}
        />
        <KpiCard
          label="Win Rate"
          value={fmtPct(run.win_rate)}
          sub={`${run.winning_trades ?? 0}W / ${run.losing_trades ?? 0}L`}
          positive={winRateGood ? true : !winRateGood ? false : null}
        />
        <KpiCard
          label="Profit Factor"
          value={run.profit_factor !== null ? fmtNum(run.profit_factor) : "—"}
          sub="gross profit / gross loss"
          positive={run.profit_factor !== null ? run.profit_factor > 1 : null}
        />
        <KpiCard
          label="Sharpe Ratio"
          value={run.sharpe_ratio !== null ? fmtNum(run.sharpe_ratio) : "—"}
          positive={run.sharpe_ratio !== null ? run.sharpe_ratio > 0 : null}
        />
        <KpiCard
          label="Max Drawdown"
          value={run.max_drawdown_pips !== null ? `${fmtNum(run.max_drawdown_pips, 1)} pip` : "—"}
          positive={false}
        />
        <KpiCard
          label="Avg Trade"
          value={fmtPips(run.avg_pnl_pips)}
          sub={`durata media ${fmtDur(run.avg_trade_duration_min)}`}
        />
        <KpiCard
          label="Best trade"
          value={fmtPips(run.best_trade_pips)}
          positive={true}
        />
        <KpiCard
          label="Worst trade"
          value={fmtPips(run.worst_trade_pips)}
          positive={false}
        />
      </div>

      {/* Trade counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Segnali rilevati",    v: run.signals_detected,   icon: Target },
          { label: "Segnali estratti",    v: run.signals_extracted,  icon: BarChart2 },
          { label: "Non entrati",         v: run.trades_not_filled,  icon: Minus },
          { label: "Aperti a fine",       v: run.trades_open_at_end, icon: Clock },
        ].map(({ label, v, icon: Icon }) => (
          <div key={label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold font-mono">{v ?? "—"}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      {run.equity_curve_json && run.equity_curve_json.length > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Equity curve (pips)</h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={run.equity_curve_json}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="ts" hide />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} />
              <Tooltip
                contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: unknown) => {
                  const n = typeof v === "number" ? v : parseFloat(String(v))
                  return [`${n > 0 ? "+" : ""}${n.toFixed(1)} pip`, "Cumulativo"] as [string, string]
                }}
                labelFormatter={() => ""}
              />
              <Line
                type="monotone"
                dataKey="cumul"
                stroke={pnlPositive ? "#10b981" : "#ef4444"}
                dot={false}
                strokeWidth={1.5}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Per symbol + per sender side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per symbol */}
        {run.symbol_stats_json && run.symbol_stats_json.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Per simbolo</h4>
            <div className="space-y-2">
              {run.symbol_stats_json.map(s => (
                <div key={s.symbol} className="flex items-center gap-3 text-xs">
                  <span className="w-20 font-mono font-semibold shrink-0 text-foreground">{s.symbol}</span>
                  <div className="flex-1 bg-white/[0.03] rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${s.win_rate >= 50 ? "bg-emerald-500/60" : "bg-red-500/60"}`}
                      style={{ width: `${Math.min(100, s.win_rate)}%` }}
                    />
                  </div>
                  <span className="w-14 text-right font-mono text-muted-foreground">{fmtPct(s.win_rate)}</span>
                  <span className={`w-20 text-right font-mono font-semibold ${s.pnl_pips > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtPips(s.pnl_pips)}
                  </span>
                  <span className="w-10 text-right text-muted-foreground">{s.trades}t</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per sender */}
        {run.sender_stats_json && run.sender_stats_json.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <Users className="w-3.5 h-3.5" /> Per mittente
            </h4>
            <div className="space-y-2">
              {run.sender_stats_json.slice(0, 10).map(s => (
                <div key={s.sender_name} className="flex items-center gap-3 text-xs">
                  <span className="w-28 truncate font-medium text-foreground shrink-0">{s.sender_name}</span>
                  <span className="w-10 text-right text-muted-foreground shrink-0">{s.signals}sg</span>
                  <span className={`w-14 text-right font-mono ${s.win_rate >= 50 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtPct(s.win_rate)}
                  </span>
                  <span className={`flex-1 text-right font-mono font-semibold ${s.pnl_pips > 0 ? "text-emerald-400" : s.pnl_pips < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                    {fmtPips(s.pnl_pips)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Distribuzione per ora */}
      {run.time_stats_json?.by_hour && Object.keys(run.time_stats_json.by_hour).length > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Trade per ora del giorno</h4>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={
              Array.from({ length: 24 }, (_, h) => {
                const d = run.time_stats_json!.by_hour[String(h)]
                return { h: String(h).padStart(2, "0"), trades: d?.trades ?? 0, wins: d?.wins ?? 0 }
              })
            }>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="h" tick={{ fontSize: 9, fill: "#6b7280" }} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="trades" fill="#6366f1" radius={[3, 3, 0, 0]} opacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* AI stats (se use_ai) */}
      {run.use_ai && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Decisioni AI
          </h4>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="text-center p-3 bg-emerald-600/5 rounded-lg border border-emerald-500/10">
              <CheckCircle className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
              <p className="font-bold text-emerald-400 text-base">{run.ai_approved ?? 0}</p>
              <p className="text-muted-foreground">Approvati</p>
            </div>
            <div className="text-center p-3 bg-red-600/5 rounded-lg border border-red-500/10">
              <XCircle className="w-4 h-4 text-red-400 mx-auto mb-1" />
              <p className="font-bold text-red-400 text-base">{run.ai_rejected ?? 0}</p>
              <p className="text-muted-foreground">Rifiutati</p>
            </div>
            <div className="text-center p-3 bg-amber-600/5 rounded-lg border border-amber-500/10">
              <AlertCircle className="w-4 h-4 text-amber-400 mx-auto mb-1" />
              <p className="font-bold text-amber-400 text-base">{run.ai_modified ?? 0}</p>
              <p className="text-muted-foreground">Modificati</p>
            </div>
          </div>
        </div>
      )}

      {/* Costi AI */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5" /> Costi AI (Flex tier)
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Flash ({run.flash_calls} call)</p>
            <p className="font-mono font-semibold">${fmtNum(run.flash_cost_usd, 4)}</p>
            <p className="text-muted-foreground font-mono">
              ↑{(run.flash_tokens_in ?? 0).toLocaleString()} ↓{(run.flash_tokens_out ?? 0).toLocaleString()} tok
            </p>
            <p className="text-muted-foreground">{fmtNum(run.flash_time_seconds, 0)}s</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pro ({run.pro_calls} call)</p>
            <p className="font-mono font-semibold">${fmtNum(run.pro_cost_usd, 4)}</p>
            <p className="text-muted-foreground font-mono">
              ↑{(run.pro_tokens_in ?? 0).toLocaleString()} ↓{(run.pro_tokens_out ?? 0).toLocaleString()} tok
            </p>
            <p className="text-muted-foreground">{fmtNum(run.pro_time_seconds, 0)}s</p>
          </div>
          {run.use_ai && (
            <div>
              <p className="text-muted-foreground">Pre-trade ({run.pretrade_calls} call)</p>
              <p className="font-mono font-semibold">${fmtNum(run.pretrade_cost_usd, 4)}</p>
              <p className="text-muted-foreground font-mono">
                ↑{(run.pretrade_tokens_in ?? 0).toLocaleString()} ↓{(run.pretrade_tokens_out ?? 0).toLocaleString()} tok
              </p>
            </div>
          )}
          <div className="sm:col-start-4">
            <p className="text-muted-foreground">Totale</p>
            <p className="font-mono font-bold text-sm">${fmtNum(run.total_ai_cost_usd, 4)}</p>
            <p className="text-muted-foreground">{fmtNum(run.total_ai_seconds, 0)}s AI</p>
          </div>
        </div>
      </div>

      {/* Copertura barre MT5 */}
      {run.bars_coverage_json && Object.keys(run.bars_coverage_json).length > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Barre MT5</h4>
          <div className="space-y-1.5 text-xs">
            {Object.entries(run.bars_coverage_json).map(([sym, cov]) => (
              <div key={sym} className="flex items-center gap-3">
                <span className="w-20 font-mono font-semibold text-foreground">{sym}</span>
                <span className="px-1.5 py-0.5 bg-white/[0.04] rounded text-muted-foreground font-mono text-[10px]">{cov.timeframe ?? "N/A"}</span>
                <span className="text-muted-foreground">{cov.count?.toLocaleString("it-IT")} barre</span>
                <span className="text-muted-foreground ml-auto">{fmtTs(cov.period_from)} → {fmtTs(cov.period_to)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trade list */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
        <button
          onClick={loadTrades}
          className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-white/[0.02] transition-colors"
        >
          <span>Trade simulati ({run.total_trades ?? 0})</span>
          {loadingTrades
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            : showTrades ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
          }
        </button>
        {showTrades && trades && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-t border-white/[0.05] bg-white/[0.02]">
                  {["Data", "Mittente", "Simbolo", "Tipo", "Entry", "SL", "TP", "Esito", "P&L", "Durata", "AI"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map(t => (
                  <tr key={t.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtTs(t.actual_entry_ts ?? t.msg_ts)}</td>
                    <td className="px-3 py-2 max-w-[80px] truncate text-muted-foreground">{t.sender_name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{t.symbol ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${t.order_type === "BUY" ? "bg-emerald-600/10 text-emerald-400" : "bg-red-600/10 text-red-400"}`}>
                        {t.order_type ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{t.actual_entry?.toFixed(5) ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{t.stop_loss?.toFixed(5) ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{t.take_profit?.toFixed(5) ?? "—"}</td>
                    <td className="px-3 py-2"><OutcomeBadge outcome={t.outcome} /></td>
                    <td className={`px-3 py-2 font-mono font-semibold ${(t.pnl_pips ?? 0) > 0 ? "text-emerald-400" : (t.pnl_pips ?? 0) < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                      {t.pnl_pips !== null ? fmtPips(t.pnl_pips) : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDur(t.duration_min)}</td>
                    <td className="px-3 py-2">
                      {t.ai_approved === null
                        ? <Minus className="w-3 h-3 text-muted-foreground/40" />
                        : t.ai_approved === 1
                          ? <span title={t.ai_reason ?? ""}><CheckCircle className="w-3 h-3 text-emerald-400" /></span>
                          : <span title={t.ai_reason ?? ""}><XCircle className="w-3 h-3 text-red-400" /></span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── History list ──────────────────────────────────────────────────────────────

function RunHistoryRow({ run, onSelect, onDelete, isActive }: {
  run: BacktestRun
  onSelect: () => void
  onDelete: () => void
  isActive: boolean
}) {
  const isRunning = run.status.startsWith("running")
  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] transition-colors ${isActive ? "bg-indigo-600/5" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <StatusBadge status={run.status} />
          {run.use_ai && (
            <span className="text-[10px] px-1.5 py-0.5 bg-violet-600/10 text-violet-400 rounded border border-violet-500/20">AI</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {fmtTs(run.started_at)} · {run.mode === "message_count" ? `${run.limit_value} msg` : `fino al ${run.limit_value}`}
          {run.total_messages !== null && ` · ${run.total_messages} scaricati`}
        </p>
      </div>
      {run.status === "done" && (
        <div className="text-right shrink-0 text-xs">
          <p className={`font-mono font-semibold ${(run.total_pnl_pips ?? 0) > 0 ? "text-emerald-400" : "text-red-400"}`}>
            {fmtPips(run.total_pnl_pips)}
          </p>
          <p className="text-muted-foreground">{fmtPct(run.win_rate)} WR</p>
        </div>
      )}
      {!isRunning && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="shrink-0 text-muted-foreground/40 hover:text-red-400 transition-colors"
          title="Elimina"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BacktestPage({ userId, user }: { userId: string; user: DashboardUser }) {
  const [runs, setRuns]           = useState<BacktestRun[]>([])
  const [activeRunId, setActiveId] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<BacktestRun | null>(null)
  const [loadingRuns, setLR]      = useState(true)
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadRuns = useCallback(async () => {
    try {
      const r = await api.listBacktests(userId)
      setRuns(r.runs)
    } catch { /* ignore */ }
    finally { setLR(false) }
  }, [userId])

  const refreshActiveRun = useCallback(async (runId: string) => {
    try {
      const r = await api.getBacktest(runId)
      setActiveRun(r)
      // Aggiorna anche la lista
      setRuns(prev => prev.map(x => x.id === runId ? { ...x, ...r } : x))
      return r
    } catch { return null }
  }, [])

  // Polling automatico mentre il run è in esecuzione
  useEffect(() => {
    if (!activeRunId) return
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const r = await refreshActiveRun(activeRunId)
      if (r && !r.status.startsWith("running")) {
        if (pollRef.current) clearInterval(pollRef.current)
      }
    }, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeRunId, refreshActiveRun])

  // Carica dettagli quando si seleziona un run
  useEffect(() => {
    if (!activeRunId) return
    refreshActiveRun(activeRunId)
  }, [activeRunId, refreshActiveRun])

  useEffect(() => { loadRuns() }, [loadRuns])

  function handleStarted(runId: string) {
    loadRuns()
    setActiveId(runId)
  }

  async function handleDelete(runId: string) {
    try {
      await api.deleteBacktest(runId, userId)
      setRuns(prev => prev.filter(r => r.id !== runId))
      if (activeRunId === runId) { setActiveId(null); setActiveRun(null) }
    } catch { /* ignore */ }
  }

  return (
    <div className="p-5 lg:p-6 max-w-[1400px] mx-auto space-y-6">

      {/* Title */}
      <div>
        <h2 className="text-base font-semibold text-foreground">Backtest storico</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Scarica messaggi Telegram storici dal gruppo e simula cosa sarebbe successo eseguendo i segnali.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">

        {/* Left column: form + history */}
        <div className="space-y-4">
          <RunForm user={user} onStarted={handleStarted} />

          {/* History */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Storico run ({runs.length})
              </h3>
              <button onClick={loadRuns} className="text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className={`w-3.5 h-3.5 ${loadingRuns ? "animate-spin" : ""}`} />
              </button>
            </div>
            {runs.length === 0 ? (
              <p className="px-4 py-6 text-xs text-muted-foreground text-center">Nessun run ancora</p>
            ) : (
              runs.map(r => (
                <RunHistoryRow
                  key={r.id}
                  run={r}
                  isActive={activeRunId === r.id}
                  onSelect={() => setActiveId(r.id)}
                  onDelete={() => handleDelete(r.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right column: active run */}
        <div>
          {!activeRunId ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              Avvia un backtest o seleziona un run dalla lista
            </div>
          ) : !activeRun ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
          ) : activeRun.status.startsWith("running") || activeRun.status === "error" ? (
            <RunProgress run={activeRun} onRefresh={() => refreshActiveRun(activeRunId)} />
          ) : (
            <RunResults run={activeRun} userId={userId} />
          )}
        </div>
      </div>
    </div>
  )
}
