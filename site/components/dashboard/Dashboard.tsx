"use client"

import { useState, useCallback } from "react"
import {
  api,
  type DashboardUserResponse,
  type SignalLog,
  type TradeSignalLog,
  type TradeResultLog,
} from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

// ── Utilità ───────────────────────────────────────────────────────────────────

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch {
    return iso
  }
}

function entryPriceLabel(ep: number | [number, number] | null): string {
  if (ep === null) return "Mercato"
  if (Array.isArray(ep)) return `Range ${ep[0]} – ${ep[1]}`
  return String(ep)
}

// ── Componenti interni ────────────────────────────────────────────────────────

function UserCard({ data }: { data: DashboardUserResponse["user"] }) {
  const fields: { label: string; value: string | number | boolean | null }[] = [
    { label: "User ID (Telegram)", value: data.user_id },
    { label: "Telefono", value: data.phone },
    { label: "Gruppo monitorato", value: `${data.group_name} (ID: ${data.group_id})` },
    { label: "MT5 Login", value: data.mt5_login ?? "—" },
    { label: "MT5 Server", value: data.mt5_server ?? "—" },
    { label: "Sizing strategy", value: data.sizing_strategy ?? "—" },
    { label: "Account attivo", value: data.active ? "Sì" : "No" },
    { label: "Registrato il", value: formatTs(data.created_at) },
  ]

  return (
    <Card className="border-white/10">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-lg select-none">
            {data.phone.slice(-2)}
          </div>
          <div>
            <CardTitle className="text-base">Utente registrato</CardTitle>
            <CardDescription>{data.phone}</CardDescription>
          </div>
          <div className="ml-auto">
            <Badge variant={data.active ? "default" : "outline"} className={data.active ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/30" : ""}>
              {data.active ? "Attivo" : "Inattivo"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {fields.map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
              <dd className="text-sm font-mono text-foreground/90 break-all">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function SignalBadge({ isSignal, flashRaw }: { isSignal: boolean; flashRaw: string | null }) {
  if (isSignal) {
    return (
      <Badge className="bg-amber-600/20 text-amber-400 border border-amber-500/30 gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
        SEGNALE
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground border-white/10 gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 inline-block" />
      non-segnale
    </Badge>
  )
}

function TradeSignalRow({ sig, idx }: { sig: TradeSignalLog; idx: number }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 text-xs font-mono">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-muted-foreground">#{idx + 1}</span>
        <Badge className={`text-[10px] px-1.5 py-0 ${sig.order_type === "BUY" ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/30" : "bg-red-600/20 text-red-400 border-red-500/30"}`}>
          {sig.order_type}
        </Badge>
        <span className="font-bold text-foreground">{sig.symbol}</span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-white/10">
          {sig.order_mode}
        </Badge>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-muted-foreground">
        <div><span className="text-foreground/60">Entry: </span><span className="text-foreground">{entryPriceLabel(sig.entry_price)}</span></div>
        <div><span className="text-foreground/60">SL: </span><span className="text-red-400">{sig.stop_loss ?? "—"}</span></div>
        <div><span className="text-foreground/60">TP: </span><span className="text-emerald-400">{sig.take_profit ?? "—"}</span></div>
        <div><span className="text-foreground/60">Lotto: </span><span className="text-foreground">{sig.lot_size ?? "auto"}</span></div>
      </div>
    </div>
  )
}

function TradeResultRow({ res, idx }: { res: TradeResultLog; idx: number }) {
  return (
    <div className={`rounded-lg border p-3 text-xs font-mono ${res.success ? "border-emerald-500/20 bg-emerald-600/5" : "border-red-500/20 bg-red-600/5"}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] text-muted-foreground">#{idx + 1}</span>
        <Badge className={`text-[10px] px-1.5 py-0 ${res.success ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/30" : "bg-red-600/20 text-red-400 border-red-500/30"}`}>
          {res.success ? "OK" : "FAIL"}
        </Badge>
        {res.order_id && <span className="text-foreground/70">Ticket #{res.order_id}</span>}
        {res.signal && (
          <>
            <span className={`font-bold ${res.signal.order_type === "BUY" ? "text-emerald-400" : "text-red-400"}`}>{res.signal.order_type}</span>
            <span className="text-foreground">{res.signal.symbol}</span>
          </>
        )}
      </div>
      {res.error && <p className="text-red-400 mt-1 break-all">{res.error}</p>}
    </div>
  )
}

function AccountInfoBox({ info }: { info: NonNullable<SignalLog["account_info"]> }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-xs font-mono">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Contesto conto MT5 al momento del segnale</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1">
        <div><span className="text-foreground/60">Balance: </span><span className="text-foreground">{info.balance} {info.currency}</span></div>
        <div><span className="text-foreground/60">Equity: </span><span className="text-foreground">{info.equity} {info.currency}</span></div>
        <div><span className="text-foreground/60">Margine lib.: </span><span className="text-foreground">{info.free_margin} {info.currency}</span></div>
        <div><span className="text-foreground/60">Leva: </span><span className="text-foreground">1:{info.leverage}</span></div>
        <div><span className="text-foreground/60">Valuta: </span><span className="text-foreground">{info.currency}</span></div>
      </div>
    </div>
  )
}

function LogEntry({ log, defaultExpanded }: { log: SignalLog; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const [msgExpanded, setMsgExpanded] = useState(false)

  const hasSignals  = log.signals_json && log.signals_json.length > 0
  const hasResults  = log.results_json && log.results_json.length > 0
  const hasError    = Boolean(log.error_step)
  const hasAccount  = Boolean(log.account_info)

  const borderClass = hasError
    ? "border-red-500/20"
    : hasResults
      ? "border-emerald-500/20"
      : log.is_signal
        ? "border-amber-500/20"
        : "border-white/8"

  return (
    <div className={`rounded-xl border ${borderClass} bg-card/50 overflow-hidden`}>
      {/* Header riga */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/[0.02] transition-colors"
      >
        {/* Timestamp + sender */}
        <div className="flex flex-col items-start gap-0.5 min-w-[140px]">
          <span className="text-[11px] font-mono text-muted-foreground">{formatTs(log.ts)}</span>
          {log.sender_name && (
            <span className="text-[11px] text-foreground/60">da {log.sender_name}</span>
          )}
        </div>

        {/* Badges stato */}
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          <SignalBadge isSignal={log.is_signal} flashRaw={log.flash_raw} />

          {log.is_signal && !log.has_mt5_creds && (
            <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-400">no MT5 creds</Badge>
          )}
          {hasError && log.error_step !== "extraction" && (
            <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">
              errore: {log.error_step}
            </Badge>
          )}
          {hasSignals && (
            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
              {log.signals_json!.length} segnali estratti
            </Badge>
          )}
          {hasResults && (
            <>
              {log.results_json!.filter(r => r.success).length > 0 && (
                <Badge className="text-[10px] bg-emerald-600/20 text-emerald-400 border-emerald-500/30">
                  {log.results_json!.filter(r => r.success).length} ordini OK
                </Badge>
              )}
              {log.results_json!.filter(r => !r.success).length > 0 && (
                <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">
                  {log.results_json!.filter(r => !r.success).length} falliti
                </Badge>
              )}
            </>
          )}

          {/* Preview messaggio */}
          <span className="text-[11px] text-muted-foreground truncate max-w-[280px] ml-1 italic">
            {log.message_text.slice(0, 80)}{log.message_text.length > 80 ? "…" : ""}
          </span>
        </div>

        {/* Chevron */}
        <span className="text-muted-foreground text-sm ml-auto shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Corpo espandibile */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/6 pt-3">

          {/* Testo messaggio */}
          <section>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Messaggio Telegram</p>
            <div className="relative rounded-lg border border-white/8 bg-black/20 p-3 text-xs font-mono text-foreground/80 whitespace-pre-wrap break-words">
              {msgExpanded || log.message_text.length <= 400
                ? log.message_text
                : log.message_text.slice(0, 400) + "…"}
              {log.message_text.length > 400 && (
                <button
                  onClick={e => { e.stopPropagation(); setMsgExpanded(v => !v) }}
                  className="block mt-1 text-[10px] text-indigo-400 hover:underline"
                >
                  {msgExpanded ? "Mostra meno" : "Mostra tutto"}
                </button>
              )}
            </div>
          </section>

          {/* Flash response */}
          <section>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Risposta Gemini Flash (rilevamento)</p>
            <div className="flex items-center gap-2">
              <Badge
                className={`text-xs ${log.flash_raw === "YES"
                  ? "bg-amber-600/20 text-amber-400 border-amber-500/30"
                  : log.flash_raw === "NO"
                    ? "bg-white/5 text-muted-foreground border-white/10"
                    : "bg-red-600/20 text-red-400 border-red-500/30"}`}
              >
                {log.flash_raw ?? "non disponibile"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {log.flash_raw === "YES" ? "→ classificato come segnale di trading" : log.flash_raw === "NO" ? "→ messaggio ignorato" : "→ errore nel rilevamento"}
              </span>
            </div>
          </section>

          {/* Credenziali MT5 */}
          {log.is_signal && (
            <section>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Credenziali MT5</p>
              <Badge
                variant="outline"
                className={log.has_mt5_creds
                  ? "border-emerald-500/30 text-emerald-400"
                  : "border-red-500/30 text-red-400"}
              >
                {log.has_mt5_creds ? "presenti" : "mancanti — esecuzione saltata"}
              </Badge>
            </section>
          )}

          {/* Sizing strategy */}
          {log.sizing_strategy && (
            <section>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Sizing strategy applicata</p>
              <p className="text-xs font-mono text-foreground/80 italic">"{log.sizing_strategy}"</p>
            </section>
          )}

          {/* Account info */}
          {hasAccount && log.account_info && (
            <section>
              <AccountInfoBox info={log.account_info} />
            </section>
          )}

          {/* Segnali estratti */}
          {hasSignals && (
            <section>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Segnali estratti da Gemini Pro ({log.signals_json!.length})
              </p>
              <div className="space-y-2">
                {log.signals_json!.map((sig, i) => (
                  <TradeSignalRow key={i} sig={sig} idx={i} />
                ))}
              </div>
            </section>
          )}

          {/* Risultati ordini */}
          {hasResults && (
            <section>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Risultati MT5 ({log.results_json!.length} ordini)
              </p>
              <div className="space-y-2">
                {log.results_json!.map((res, i) => (
                  <TradeResultRow key={i} res={res} idx={i} />
                ))}
              </div>
            </section>
          )}

          {/* Errore */}
          {hasError && (
            <section>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Errore</p>
              <div className="rounded-lg border border-red-500/20 bg-red-600/5 p-3 text-xs font-mono">
                <p className="text-red-400 font-semibold mb-0.5">Step: {log.error_step}</p>
                <p className="text-red-300/80 break-all">{log.error_msg}</p>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ── Filtro log ────────────────────────────────────────────────────────────────

type FilterMode = "all" | "signals" | "trades"

function filterLogs(logs: SignalLog[], mode: FilterMode): SignalLog[] {
  if (mode === "signals") return logs.filter(l => l.is_signal)
  if (mode === "trades")  return logs.filter(l => l.results_json && l.results_json.length > 0)
  return logs
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ logs, total }: { logs: SignalLog[]; total: number }) {
  const signals = logs.filter(l => l.is_signal).length
  const trades  = logs.filter(l => l.results_json && l.results_json.length > 0).length
  const errors  = logs.filter(l => l.error_step).length
  const okTrades = logs.flatMap(l => l.results_json ?? []).filter(r => r.success).length
  const failTrades = logs.flatMap(l => l.results_json ?? []).filter(r => !r.success).length

  const stats = [
    { label: "Messaggi totali", value: total, color: "text-foreground" },
    { label: "Segnali rilevati", value: signals, color: "text-amber-400" },
    { label: "Con ordini", value: trades, color: "text-indigo-400" },
    { label: "Ordini OK", value: okTrades, color: "text-emerald-400" },
    { label: "Ordini falliti", value: failTrades, color: "text-red-400" },
    { label: "Con errori", value: errors, color: "text-orange-400" },
  ]

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {stats.map(s => (
        <div key={s.label} className="rounded-lg border border-white/8 bg-card/50 px-3 py-2 text-center">
          <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{s.label}</p>
        </div>
      ))}
    </div>
  )
}

// ── Componente principale ─────────────────────────────────────────────────────

export function Dashboard() {
  const [phone, setPhone]         = useState("")
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [data, setData]           = useState<DashboardUserResponse | null>(null)
  const [filter, setFilter]       = useState<FilterMode>("all")
  const [loadingMore, setLoadingMore] = useState(false)

  const search = useCallback(async () => {
    if (!phone.trim()) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await api.getDashboardUser(phone.trim())
      setData(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore sconosciuto")
    } finally {
      setLoading(false)
    }
  }, [phone])

  const loadMore = useCallback(async () => {
    if (!data) return
    setLoadingMore(true)
    try {
      const res = await api.getDashboardLogs(data.user.user_id, 50, data.logs.length)
      setData(prev => prev ? { ...prev, logs: [...prev.logs, ...res.logs] } : prev)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore nel caricamento")
    } finally {
      setLoadingMore(false)
    }
  }, [data])

  const visibleLogs = data ? filterLogs(data.logs, filter) : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard Debug</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Inserisci un numero di telefono registrato per visualizzare messaggi, segnali e operazioni MT5.
        </p>
      </div>

      {/* Search */}
      <Card className="border-white/10">
        <CardContent className="pt-6">
          <form
            onSubmit={e => { e.preventDefault(); search() }}
            className="flex gap-2"
          >
            <Input
              type="tel"
              placeholder="+39123456789"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="font-mono"
            />
            <Button type="submit" disabled={loading || !phone.trim()}>
              {loading ? "Ricerca…" : "Cerca"}
            </Button>
          </form>
          {error && (
            <p className="mt-3 text-sm text-red-400 bg-red-600/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Risultati */}
      {data && (
        <div className="space-y-5">
          {/* Profilo utente */}
          <UserCard data={data.user} />

          {/* Stats */}
          <StatsBar logs={data.logs} total={data.total_logs} />

          {/* Filtri */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Mostra:</span>
            {(["all", "signals", "trades"] as FilterMode[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs transition-colors border ${
                  filter === f
                    ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                    : "border-white/10 text-muted-foreground hover:border-white/20"
                }`}
              >
                {{ all: "Tutti i messaggi", signals: "Solo segnali", trades: "Solo con ordini" }[f]}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              {visibleLogs.length} su {data.logs.length} caricati
              {data.logs.length < data.total_logs && ` (${data.total_logs} totali)`}
            </span>
          </div>

          {/* Log entries */}
          {visibleLogs.length === 0 ? (
            <div className="rounded-xl border border-white/8 bg-card/50 px-6 py-10 text-center">
              <p className="text-muted-foreground text-sm">Nessun messaggio corrisponde al filtro selezionato.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleLogs.map(log => (
                <LogEntry key={log.id} log={log} defaultExpanded={false} />
              ))}
            </div>
          )}

          {/* Carica altri */}
          {data.logs.length < data.total_logs && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Caricamento…" : `Carica altri (${data.total_logs - data.logs.length} rimasti)`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
