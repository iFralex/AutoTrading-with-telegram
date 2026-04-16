"use client"

import { useState, useCallback } from "react"
import { ChevronDown, ChevronUp, Filter } from "lucide-react"
import { api, type DashboardUserResponse, type SignalLog, type TradeSignalLog, type TradeResultLog } from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch { return iso }
}

function entryPriceLabel(ep: number | [number, number] | null): string {
  if (ep === null) return "Mercato"
  if (Array.isArray(ep)) return `Range ${ep[0]}–${ep[1]}`
  return String(ep)
}

type FilterMode = "all" | "signals" | "trades"

function filterLogs(logs: SignalLog[], mode: FilterMode): SignalLog[] {
  if (mode === "signals") return logs.filter(l => l.is_signal)
  if (mode === "trades")  return logs.filter(l => l.results_json && l.results_json.length > 0)
  return logs
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function LogsPage({ data }: { data: DashboardUserResponse }) {
  const { user } = data

  const [logs, setLogs]           = useState(data.logs)
  const [total, setTotal]         = useState(data.total_logs)
  const [filter, setFilter]       = useState<FilterMode>("all")
  const [loadingMore, setLoadingMore] = useState(false)

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const res = await api.getDashboardLogs(user.user_id, 50, logs.length)
      setLogs(prev => [...prev, ...res.logs])
      setTotal(res.total)
    } catch {
      // silently ignore
    } finally {
      setLoadingMore(false)
    }
  }, [user.user_id, logs.length])

  const visible = filterLogs(logs, filter)

  const signals   = logs.filter(l => l.is_signal).length
  const withOrders = logs.filter(l => l.results_json && l.results_json.length > 0).length
  const okOrders  = logs.flatMap(l => l.results_json ?? []).filter(r => r.success).length
  const failOrders = logs.flatMap(l => l.results_json ?? []).filter(r => !r.success).length
  const errors    = logs.filter(l => l.error_step).length

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Log Segnali</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Storico messaggi elaborati, segnali e ordini MT5
        </p>
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { label: "Totali", value: total,      color: "text-foreground" },
          { label: "Segnali",value: signals,    color: "text-amber-400" },
          { label: "Con ordini", value: withOrders, color: "text-indigo-400" },
          { label: "OK",     value: okOrders,   color: "text-emerald-400" },
          { label: "Falliti",value: failOrders, color: failOrders > 0 ? "text-red-400" : "text-muted-foreground" },
          { label: "Errori", value: errors,     color: errors > 0 ? "text-orange-400" : "text-muted-foreground" },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/[0.07] bg-card/40 px-3 py-2.5 text-center">
            <p className={`text-xl font-bold font-mono leading-none ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters + count */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {(["all", "signals", "trades"] as FilterMode[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all border ${
              filter === f
                ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300"
                : "border-white/[0.08] text-muted-foreground hover:border-white/[0.15] hover:text-foreground"
            }`}
          >
            {{ all: "Tutti i messaggi", signals: "Solo segnali", trades: "Solo con ordini" }[f]}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {visible.length} su {logs.length} caricati
          {logs.length < total && ` · ${total} totali`}
        </span>
      </div>

      {/* Log list */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-card/30 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">Nessun messaggio corrisponde al filtro selezionato.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(log => (
            <LogEntry key={log.id} log={log} />
          ))}
        </div>
      )}

      {/* Load more */}
      {logs.length < total && (
        <div className="flex justify-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-5 py-2 rounded-xl border border-white/[0.08] text-sm text-muted-foreground hover:border-white/[0.15] hover:text-foreground bg-white/[0.02] hover:bg-white/[0.04] disabled:opacity-50 transition-all"
          >
            {loadingMore ? "Caricamento…" : `Carica altri (${total - logs.length} rimasti)`}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Log entry ─────────────────────────────────────────────────────────────────

function LogEntry({ log }: { log: SignalLog }) {
  const [expanded, setExpanded]   = useState(false)
  const [msgFull, setMsgFull]     = useState(false)

  const hasSignals = log.signals_json && log.signals_json.length > 0
  const hasResults = log.results_json && log.results_json.length > 0
  const hasError   = Boolean(log.error_step)
  const hasAccount = Boolean(log.account_info)

  const okCount   = log.results_json?.filter(r => r.success).length ?? 0
  const failCount = log.results_json?.filter(r => !r.success).length ?? 0

  const borderColor = hasError
    ? "border-red-500/20"
    : hasResults
      ? (okCount > 0 ? "border-emerald-500/15" : "border-red-500/15")
      : log.is_signal
        ? "border-amber-500/15"
        : "border-white/[0.07]"

  return (
    <div className={`rounded-xl border ${borderColor} bg-card/40 overflow-hidden`}>
      {/* Row header — clickable */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/[0.02] transition-colors"
      >
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
          hasError ? "bg-red-400" :
          hasResults ? (okCount > 0 ? "bg-emerald-400" : "bg-red-400") :
          log.is_signal ? "bg-amber-400 animate-pulse" :
          "bg-white/[0.15]"
        }`} />

        {/* Timestamp + sender */}
        <div className="flex flex-col gap-0.5 min-w-[150px] shrink-0">
          <span className="text-[11px] font-mono text-muted-foreground">{formatTs(log.ts)}</span>
          {log.sender_name && (
            <span className="text-[10px] text-muted-foreground/60 truncate">{log.sender_name}</span>
          )}
        </div>

        {/* Badges + preview */}
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {/* Signal badge */}
          {log.is_signal ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-600/10 text-amber-400 border-amber-500/20 font-medium shrink-0">
              SEGNALE
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-white/[0.03] text-muted-foreground/60 border-white/[0.06] shrink-0">
              non-segnale
            </span>
          )}

          {/* MT5 creds */}
          {log.is_signal && !log.has_mt5_creds && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-orange-600/10 text-orange-400 border-orange-500/20 shrink-0">
              no MT5
            </span>
          )}

          {/* Extracted signals */}
          {hasSignals && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-600/8 text-amber-400/80 border-amber-500/15 shrink-0">
              {log.signals_json!.length} estratti
            </span>
          )}

          {/* Trade results */}
          {okCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-600/10 text-emerald-400 border-emerald-500/20 shrink-0">
              {okCount} ordini OK
            </span>
          )}
          {failCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-600/10 text-red-400 border-red-500/20 shrink-0">
              {failCount} falliti
            </span>
          )}

          {/* Error */}
          {hasError && log.error_step !== "extraction" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-600/8 text-red-400/80 border-red-500/15 shrink-0">
              err: {log.error_step}
            </span>
          )}

          {/* Message preview */}
          <span className="text-[11px] text-muted-foreground/50 truncate italic ml-1 flex-1 min-w-0">
            {log.message_text.slice(0, 80)}{log.message_text.length > 80 ? "…" : ""}
          </span>
        </div>

        {/* Expand chevron */}
        <span className="text-muted-foreground/40 shrink-0 ml-1 mt-0.5">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-white/[0.05] px-4 py-4 space-y-5">

          {/* Message text */}
          <ExpandSection label="Messaggio Telegram">
            <div className="rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2.5 text-xs font-mono text-foreground/75 whitespace-pre-wrap break-words leading-relaxed">
              {msgFull || log.message_text.length <= 400
                ? log.message_text
                : log.message_text.slice(0, 400) + "…"
              }
              {log.message_text.length > 400 && (
                <button
                  onClick={e => { e.stopPropagation(); setMsgFull(v => !v) }}
                  className="block mt-2 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {msgFull ? "Mostra meno" : "Mostra tutto"}
                </button>
              )}
            </div>
          </ExpandSection>

          {/* Flash result */}
          <ExpandSection label="Rilevamento (Gemini Flash)">
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded-lg border font-mono font-semibold ${
                log.flash_raw === "YES"
                  ? "bg-amber-600/15 text-amber-400 border-amber-500/25"
                  : log.flash_raw === "NO"
                    ? "bg-white/[0.03] text-muted-foreground border-white/[0.08]"
                    : "bg-red-600/10 text-red-400 border-red-500/20"
              }`}>
                {log.flash_raw ?? "N/A"}
              </span>
              <span className="text-xs text-muted-foreground">
                {log.flash_raw === "YES" ? "→ classificato come segnale" :
                 log.flash_raw === "NO"  ? "→ messaggio ignorato" :
                 "→ errore nel rilevamento"}
              </span>
            </div>
          </ExpandSection>

          {/* MT5 credentials */}
          {log.is_signal && (
            <ExpandSection label="Credenziali MT5">
              <span className={`text-xs px-2 py-1 rounded-lg border ${
                log.has_mt5_creds
                  ? "bg-emerald-600/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-600/10 text-red-400 border-red-500/20"
              }`}>
                {log.has_mt5_creds ? "Presenti" : "Mancanti — esecuzione saltata"}
              </span>
            </ExpandSection>
          )}

          {/* Sizing strategy */}
          {log.sizing_strategy && (
            <ExpandSection label="Sizing strategy applicata">
              <p className="text-xs font-mono text-foreground/70 italic">"{log.sizing_strategy}"</p>
            </ExpandSection>
          )}

          {/* Account info */}
          {hasAccount && log.account_info && (
            <ExpandSection label="Contesto conto MT5">
              <AccountInfoBox info={log.account_info} />
            </ExpandSection>
          )}

          {/* Extracted signals */}
          {hasSignals && (
            <ExpandSection label={`Segnali estratti (${log.signals_json!.length})`}>
              <div className="space-y-2">
                {log.signals_json!.map((sig, i) => (
                  <TradeSignalRow key={i} sig={sig} idx={i} />
                ))}
              </div>
            </ExpandSection>
          )}

          {/* Trade results */}
          {hasResults && (
            <ExpandSection label={`Risultati MT5 (${log.results_json!.length} ordini)`}>
              <div className="space-y-2">
                {log.results_json!.map((res, i) => (
                  <TradeResultRow key={i} res={res} idx={i} />
                ))}
              </div>
            </ExpandSection>
          )}

          {/* Error */}
          {hasError && (
            <ExpandSection label="Errore">
              <div className="rounded-lg border border-red-500/20 bg-red-600/5 px-3 py-2.5">
                <p className="text-xs font-semibold text-red-400 mb-1">Step: {log.error_step}</p>
                <p className="text-xs font-mono text-red-300/75 break-all">{log.error_msg}</p>
              </div>
            </ExpandSection>
          )}
        </div>
      )}
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function ExpandSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-2">
        {label}
      </p>
      {children}
    </div>
  )
}

function AccountInfoBox({ info }: { info: NonNullable<SignalLog["account_info"]> }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2.5 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1.5 text-xs font-mono">
      {[
        { label: "Balance",   value: `${info.balance} ${info.currency}` },
        { label: "Equity",    value: `${info.equity} ${info.currency}` },
        { label: "Margine lib.", value: `${info.free_margin} ${info.currency}` },
        { label: "Leva",      value: `1:${info.leverage}` },
        { label: "Valuta",    value: info.currency },
      ].map(({ label, value }) => (
        <div key={label}>
          <span className="text-muted-foreground/50">{label}: </span>
          <span className="text-foreground/80">{value}</span>
        </div>
      ))}
    </div>
  )
}

export function TradeSignalRow({ sig, idx }: { sig: TradeSignalLog; idx: number }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2.5 text-xs font-mono">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-muted-foreground/50">#{idx + 1}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
          sig.order_type === "BUY"
            ? "bg-emerald-600/10 text-emerald-400 border-emerald-500/20"
            : "bg-red-600/10 text-red-400 border-red-500/20"
        }`}>
          {sig.order_type}
        </span>
        <span className="font-bold text-foreground">{sig.symbol}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-white/[0.03] text-muted-foreground border-white/[0.07]">
          {sig.order_mode}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-muted-foreground/70">
        <div><span className="text-foreground/50">Entry: </span><span className="text-foreground/80">{entryPriceLabel(sig.entry_price)}</span></div>
        <div><span className="text-foreground/50">SL: </span><span className="text-red-400/80">{sig.stop_loss ?? "—"}</span></div>
        <div><span className="text-foreground/50">TP: </span><span className="text-emerald-400/80">{sig.take_profit ?? "—"}</span></div>
        <div><span className="text-foreground/50">Lotto: </span><span className="text-foreground/80">{sig.lot_size ?? "auto"}</span></div>
      </div>
    </div>
  )
}

export function TradeResultRow({ res, idx }: { res: TradeResultLog; idx: number }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs font-mono ${
      res.success
        ? "border-emerald-500/15 bg-emerald-600/5"
        : "border-red-500/15 bg-red-600/5"
    }`}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/50">#{idx + 1}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
          res.success
            ? "bg-emerald-600/15 text-emerald-400 border-emerald-500/25"
            : "bg-red-600/10 text-red-400 border-red-500/20"
        }`}>
          {res.success ? "OK" : "FAIL"}
        </span>
        {res.order_id && (
          <span className="text-foreground/60">Ticket #{res.order_id}</span>
        )}
        {res.signal && (
          <>
            <span className={`font-bold ${res.signal.order_type === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
              {res.signal.order_type}
            </span>
            <span className="text-foreground/80">{res.signal.symbol}</span>
          </>
        )}
      </div>
      {res.error && (
        <p className="text-red-400/80 mt-1.5 break-all">{res.error}</p>
      )}
    </div>
  )
}
