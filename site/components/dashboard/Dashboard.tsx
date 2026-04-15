"use client"

import { useState, useCallback, useEffect } from "react"
import {
  api,
  type DashboardUserResponse,
  type SignalLog,
  type TradeSignalLog,
  type TradeResultLog,
  type TestSignalInput,
  type TestOrderResponse,
  type SimulateMessageResponse,
} from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatsSection } from "@/components/dashboard/StatsSection"

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
    { label: "Management strategy", value: data.management_strategy ?? "—" },
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

// ── Esempio JSON pre-compilato (formato output AI) ────────────────────────────

const EXAMPLE_SIGNALS: TestSignalInput[] = [
  {
    symbol:      "XAUUSD",
    order_type:  "BUY",
    entry_price: null,
    stop_loss:   2580.00,
    take_profit: 2640.00,
    lot_size:    0.01,
    order_mode:  "MARKET",
  },
]

// ── Editor sizing strategy ────────────────────────────────────────────────────

function SizingStrategyEditor({
  userId,
  current,
  onSaved,
}: {
  userId: string
  current: string | null
  onSaved: (value: string | null) => void
}) {
  const [editing, setEditing]   = useState(false)
  const [value, setValue]       = useState(current ?? "")
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  function startEdit() {
    setValue(current ?? "")
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  async function save() {
    setLoading(true)
    setError(null)
    try {
      await api.updateSizingStrategy(userId, value.trim() || null)
      onSaved(value.trim() || null)
      setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-white/10">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Sizing Strategy</CardTitle>
            <CardDescription className="mt-0.5">
              Istruzione iniettata nel prompt AI per il calcolo del lotto
            </CardDescription>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={startEdit} className="text-xs">
              Modifica
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing ? (
          <p className="text-sm font-mono text-foreground/80 bg-black/20 rounded-lg border border-white/8 px-3 py-2 min-h-[2.5rem] whitespace-pre-wrap break-words">
            {current ?? <span className="text-muted-foreground italic">Nessuna strategia configurata</span>}
          </p>
        ) : (
          <>
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={4}
              placeholder="Es: Usa sempre il 2% del balance come rischio per trade, con SL in pips dal segnale."
              className="w-full rounded-lg border border-white/10 bg-black/30 p-3 text-sm font-mono text-foreground/90 resize-y focus:outline-none focus:border-indigo-500/50"
            />
            {error && (
              <p className="text-xs text-red-400 bg-red-600/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button onClick={save} disabled={loading} size="sm" className="text-xs">
                {loading ? "Salvataggio…" : "Salva"}
              </Button>
              <Button onClick={cancel} disabled={loading} variant="outline" size="sm" className="text-xs">
                Annulla
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Editor management strategy ───────────────────────────────────────────────

function ManagementStrategyEditor({
  userId,
  current,
  onSaved,
}: {
  userId: string
  current: string | null
  onSaved: (value: string | null) => void
}) {
  const [editing, setEditing]   = useState(false)
  const [value, setValue]       = useState(current ?? "")
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  function startEdit() {
    setValue(current ?? "")
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  async function save() {
    setLoading(true)
    setError(null)
    try {
      await api.updateManagementStrategy(userId, value.trim() || null)
      onSaved(value.trim() || null)
      setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-white/10">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Management Strategy</CardTitle>
            <CardDescription className="mt-0.5">
              Descrizione della strategia di gestione delle posizioni (eseguita dall&apos;AI agent)
            </CardDescription>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={startEdit} className="text-xs">
              Modifica
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing ? (
          <p className="text-sm font-mono text-foreground/80 bg-black/20 rounded-lg border border-white/8 px-3 py-2 min-h-[2.5rem] whitespace-pre-wrap break-words">
            {current ?? <span className="text-muted-foreground italic">Nessuna strategia configurata</span>}
          </p>
        ) : (
          <>
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={4}
              placeholder="Es: Sposta lo stop loss al break-even quando il prezzo raggiunge il 50% del target. Chiudi metà posizione al primo TP."
              className="w-full rounded-lg border border-white/10 bg-black/30 p-3 text-sm font-mono text-foreground/90 resize-y focus:outline-none focus:border-indigo-500/50"
            />
            {error && (
              <p className="text-xs text-red-400 bg-red-600/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button onClick={save} disabled={loading} size="sm" className="text-xs">
                {loading ? "Salvataggio…" : "Salva"}
              </Button>
              <Button onClick={cancel} disabled={loading} variant="outline" size="sm" className="text-xs">
                Annulla
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Editor range entry pct ────────────────────────────────────────────────────

function RangeEntryPctEditor({
  userId,
  current,
  onSaved,
}: {
  userId: string
  current: number
  onSaved: (value: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState(current)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function startEdit() {
    setValue(current)
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  async function save() {
    setLoading(true)
    setError(null)
    try {
      await api.updateRangeEntryPct(userId, value)
      onSaved(value)
      setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio")
    } finally {
      setLoading(false)
    }
  }

  function pctLabel(pct: number): string {
    if (pct === 0)   return "Estremo favorevole (0% — BUY al minimo del range, SELL al massimo)"
    if (pct === 50)  return "Punto medio del range (50%)"
    if (pct === 100) return "Estremo opposto (100% — BUY al massimo del range, SELL al minimo)"
    return `${pct}% del range`
  }

  return (
    <Card className="border-white/10">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Posizione nel range di ingresso</CardTitle>
            <CardDescription className="mt-0.5">
              Dove piazzare il limite quando il segnale indica un range di entry
            </CardDescription>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={startEdit} className="text-xs">
              Modifica
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing ? (
          <p className="text-sm font-mono text-foreground/80 bg-black/20 rounded-lg border border-white/8 px-3 py-2">
            {pctLabel(current)}
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Estremo favorevole (0%)</span>
                <span className="font-mono text-foreground">{value}%</span>
                <span>Estremo opposto (100%)</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={value}
                onChange={e => setValue(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <p className="text-xs text-muted-foreground italic">{pctLabel(value)}</p>
            </div>
            {error && (
              <p className="text-xs text-red-400 bg-red-600/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button onClick={save} disabled={loading} size="sm" className="text-xs">
                {loading ? "Salvataggio…" : "Salva"}
              </Button>
              <Button onClick={cancel} disabled={loading} variant="outline" size="sm" className="text-xs">
                Annulla
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Simulatore messaggio Telegram ────────────────────────────────────────────

const EXAMPLE_MESSAGES = [
  "🟢 BUY XAUUSD\nEntry: 2320 - 2325\nSL: 2305\nTP1: 2345\nTP2: 2365",
  "EURUSD SELL NOW\nEntry: 1.0850\nStop Loss: 1.0890\nTake Profit: 1.0800",
  "Buongiorno a tutti! Il mercato oggi è molto volatile, fate attenzione.",
]

function SimulatedSignalRow({ sig, idx }: { sig: TradeSignalLog; idx: number }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 text-xs font-mono">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-muted-foreground">#{idx + 1}</span>
        <Badge className={`text-[10px] px-1.5 py-0 ${sig.order_type === "BUY" ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/30" : "bg-red-600/20 text-red-400 border-red-500/30"}`}>
          {sig.order_type}
        </Badge>
        <span className="font-bold text-foreground">{sig.symbol}</span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-white/10">{sig.order_mode}</Badge>
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

function MessageSimulatorPanel({ userId }: { userId: string }) {
  const [open, setOpen]       = useState(false)
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<SimulateMessageResponse | null>(null)
  const [error, setError]     = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!message.trim()) return
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const res = await api.simulateMessage(userId, message.trim())
      setResult(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore sconosciuto")
    } finally {
      setLoading(false)
    }
  }, [userId, message])

  const reset = () => { setMessage(""); setResult(null); setError(null) }

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-600/5 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-violet-600/10 transition-colors"
      >
        <span className="text-violet-400 font-mono text-sm">💬</span>
        <span className="text-sm font-medium text-violet-300">Simulatore messaggio Telegram</span>
        <span className="text-xs text-muted-foreground ml-1">
          — testa la pipeline Flash + Pro senza eseguire ordini
        </span>
        <span className="ml-auto text-muted-foreground text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-violet-500/15 pt-3">
          <p className="text-[11px] text-muted-foreground">
            Incolla o digita un messaggio Telegram. Il server eseguirà{" "}
            <span className="text-violet-300">Gemini Flash</span> (rilevamento segnale) e, se positivo,{" "}
            <span className="text-violet-300">Gemini Pro</span> (estrazione strutturata).
            La sizing strategy dell&apos;utente viene applicata. Nessun ordine MT5 viene eseguito.
          </p>

          {/* Esempi rapidi */}
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_MESSAGES.map((ex, i) => (
              <button
                key={i}
                onClick={() => { setMessage(ex); setResult(null); setError(null) }}
                className="rounded-md border border-violet-500/20 px-2 py-1 text-[10px] text-violet-400/80 hover:border-violet-400/40 hover:text-violet-300 hover:bg-violet-600/10 transition-all"
              >
                Esempio {i + 1}
              </button>
            ))}
          </div>

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={6}
            placeholder="Incolla qui il testo del messaggio Telegram..."
            spellCheck={false}
            className="w-full rounded-lg border border-white/10 bg-black/30 p-3 text-sm font-mono text-foreground/90 resize-y focus:outline-none focus:border-violet-500/50"
          />

          <div className="flex items-center gap-3">
            <Button
              onClick={run}
              disabled={loading || !message.trim()}
              className="bg-violet-600 hover:bg-violet-500 text-white"
            >
              {loading ? "Elaborazione…" : "Simula pipeline"}
            </Button>
            {(result || message) && (
              <button
                onClick={reset}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Resetta
              </button>
            )}
          </div>

          {/* Errore HTTP */}
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-600/5 p-3 text-xs font-mono text-red-400">
              {error}
            </div>
          )}

          {/* Risultati */}
          {result && (
            <div className="space-y-3">
              {/* Flash */}
              <div className="rounded-lg border border-white/8 bg-black/20 p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Step 1 — Gemini Flash (rilevamento)</p>
                <div className="flex items-center gap-2">
                  <Badge
                    className={`text-xs ${result.flash_raw === "YES"
                      ? "bg-amber-600/20 text-amber-400 border-amber-500/30"
                      : result.flash_raw === "NO"
                        ? "bg-white/5 text-muted-foreground border-white/10"
                        : "bg-red-600/20 text-red-400 border-red-500/30"}`}
                  >
                    {result.flash_raw ?? "errore"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {result.flash_raw === "YES"
                      ? "→ classificato come segnale di trading"
                      : result.flash_raw === "NO"
                        ? "→ messaggio ignorato (non è un segnale)"
                        : "→ errore nel rilevamento"}
                  </span>
                </div>
              </div>

              {/* Pro extraction o motivo skip */}
              {result.is_signal && (
                <div className="rounded-lg border border-white/8 bg-black/20 p-3 space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Step 2 — Gemini Pro (estrazione)</p>

                  {result.sizing_strategy && (
                    <p className="text-[10px] text-muted-foreground italic">
                      Sizing strategy applicata: &quot;{result.sizing_strategy}&quot;
                    </p>
                  )}

                  {result.error_step === "extraction" ? (
                    <div className="rounded border border-red-500/20 bg-red-600/5 px-3 py-2 text-xs font-mono text-red-400">
                      {result.error}
                    </div>
                  ) : result.signals.length > 0 ? (
                    <div className="space-y-2 pt-1">
                      <p className="text-[10px] text-muted-foreground">{result.signals.length} segnali estratti:</p>
                      {result.signals.map((sig, i) => (
                        <SimulatedSignalRow key={i} sig={sig} idx={i} />
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pannello test ordine diretto ──────────────────────────────────────────────

function TestOrderPanel({ userId }: { userId: string }) {
  const [open, setOpen]         = useState(false)
  const [json, setJson]         = useState(JSON.stringify(EXAMPLE_SIGNALS, null, 2))
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<TestOrderResponse | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const run = useCallback(async () => {
    setError(null)
    setResult(null)

    let signals: TestSignalInput[]
    try {
      const parsed = JSON.parse(json)
      if (!Array.isArray(parsed)) throw new Error("Il JSON deve essere un array")
      signals = parsed as TestSignalInput[]
    } catch (e: unknown) {
      setError(e instanceof Error ? `JSON non valido: ${e.message}` : "JSON non valido")
      return
    }

    setLoading(true)
    try {
      const res = await api.testOrder(userId, signals)
      setResult(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore sconosciuto")
    } finally {
      setLoading(false)
    }
  }, [userId, json])

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-indigo-600/5 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-indigo-600/10 transition-colors"
      >
        <span className="text-indigo-400 font-mono text-sm">⚡</span>
        <span className="text-sm font-medium text-indigo-300">Test ordine diretto</span>
        <span className="text-xs text-muted-foreground ml-1">
          — invia JSON nel formato AI direttamente a MT5
        </span>
        <span className="ml-auto text-muted-foreground text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-indigo-500/15 pt-3">
          <p className="text-[11px] text-muted-foreground">
            Incolla l&apos;array JSON che l&apos;AI produrrebbe (stesso schema di{" "}
            <code className="text-indigo-300 bg-indigo-900/30 px-1 rounded">SignalProcessor</code>).
            L&apos;ordine viene eseguito su MT5 reale — usa lotti minimi.
          </p>

          <textarea
            value={json}
            onChange={e => setJson(e.target.value)}
            rows={12}
            spellCheck={false}
            className="w-full rounded-lg border border-white/10 bg-black/30 p-3 text-xs font-mono text-foreground/90 resize-y focus:outline-none focus:border-indigo-500/50"
          />

          <div className="flex items-center gap-3">
            <Button
              onClick={run}
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              {loading ? "Esecuzione…" : "Esegui su MT5"}
            </Button>
            <button
              onClick={() => { setJson(JSON.stringify(EXAMPLE_SIGNALS, null, 2)); setResult(null); setError(null) }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Ripristina esempio
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-600/5 p-3 text-xs font-mono text-red-400">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Risposta MT5 ({result.results.length} risultati)
              </p>
              {result.results.map((res, i) => (
                <TradeResultRow key={i} res={res} idx={i} />
              ))}
            </div>
          )}
        </div>
      )}
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

export function Dashboard({ initialPhone = "" }: { initialPhone?: string }) {
  const [phone, setPhone]         = useState(initialPhone)
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

  // Auto-carica l'utente se il phone arriva dalla prop (es. redirect da setup)
  useEffect(() => {
    if (initialPhone) search()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

          {/* Sizing strategy */}
          <SizingStrategyEditor
            userId={data.user.user_id}
            current={data.user.sizing_strategy}
            onSaved={value => setData(prev => prev
              ? { ...prev, user: { ...prev.user, sizing_strategy: value } }
              : prev
            )}
          />

          {/* Management strategy */}
          <ManagementStrategyEditor
            userId={data.user.user_id}
            current={data.user.management_strategy}
            onSaved={value => setData(prev => prev
              ? { ...prev, user: { ...prev.user, management_strategy: value } }
              : prev
            )}
          />

          {/* Range entry pct */}
          <RangeEntryPctEditor
            userId={data.user.user_id}
            current={data.user.range_entry_pct ?? 0}
            onSaved={value => setData(prev => prev
              ? { ...prev, user: { ...prev.user, range_entry_pct: value } }
              : prev
            )}
          />

          {/* Statistiche dettagliate */}
          <StatsSection userId={data.user.user_id} />

          {/* Simulatore messaggio Telegram */}
          <MessageSimulatorPanel userId={data.user.user_id} />

          {/* Test ordine diretto */}
          <TestOrderPanel userId={data.user.user_id} />

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
