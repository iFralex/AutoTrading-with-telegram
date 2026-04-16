"use client"

import { useState, useCallback } from "react"
import { Play, RotateCcw, FlaskConical, Zap } from "lucide-react"
import {
  api,
  type TradeSignalLog,
  type TradeResultLog,
  type TestSignalInput,
  type TestOrderResponse,
  type SimulateMessageResponse,
} from "@/src/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function entryPriceLabel(ep: number | [number, number] | null): string {
  if (ep === null) return "Mercato"
  if (Array.isArray(ep)) return `Range ${ep[0]}–${ep[1]}`
  return String(ep)
}

const EXAMPLE_SIGNALS: TestSignalInput[] = [
  {
    symbol: "XAUUSD",
    order_type: "BUY",
    entry_price: null,
    stop_loss: 2580.0,
    take_profit: 2640.0,
    lot_size: 0.01,
    order_mode: "MARKET",
  },
]

const EXAMPLE_MESSAGES = [
  "🟢 BUY XAUUSD\nEntry: 2320 - 2325\nSL: 2305\nTP1: 2345\nTP2: 2365",
  "EURUSD SELL NOW\nEntry: 1.0850\nStop Loss: 1.0890\nTake Profit: 1.0800",
  "Buongiorno a tutti! Il mercato oggi è molto volatile, fate attenzione.",
]

// ── Page ──────────────────────────────────────────────────────────────────────

export function TestPage({ userId }: { userId: string }) {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Strumenti</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Testa la pipeline AI e invia ordini direttamente su MT5
        </p>
      </div>

      <MessageSimulatorPanel userId={userId} />
      <TestOrderPanel userId={userId} />
    </div>
  )
}

// ── Message simulator ─────────────────────────────────────────────────────────

function MessageSimulatorPanel({ userId }: { userId: string }) {
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
      setResult(await api.simulateMessage(userId, message.trim()))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore sconosciuto")
    } finally {
      setLoading(false)
    }
  }, [userId, message])

  const reset = () => { setMessage(""); setResult(null); setError(null) }

  return (
    <ToolCard
      icon={<FlaskConical className="w-4 h-4 text-violet-400" />}
      title="Simulatore messaggio"
      badge="Flash + Pro"
      badgeColor="violet"
      description="Testa la pipeline di rilevamento + estrazione segnali senza eseguire ordini MT5"
    >
      {/* Quick examples */}
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLE_MESSAGES.map((ex, i) => (
          <button
            key={i}
            onClick={() => { setMessage(ex); setResult(null); setError(null) }}
            className="rounded-md border border-violet-500/20 px-2.5 py-1 text-[11px] text-violet-400/75 hover:border-violet-400/35 hover:text-violet-300 hover:bg-violet-600/8 transition-all"
          >
            Esempio {i + 1}
          </button>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        rows={6}
        placeholder="Incolla qui il testo del messaggio Telegram…"
        spellCheck={false}
        className="
          w-full rounded-lg border border-white/[0.08] bg-black/20
          px-3 py-2.5 text-sm font-mono text-foreground/85
          resize-y focus:outline-none focus:border-violet-500/40
          placeholder:text-muted-foreground/30 transition-colors
        "
      />

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={loading || !message.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          {loading ? "Elaborazione…" : "Simula pipeline"}
        </button>
        {(result || message) && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Resetta
          </button>
        )}
      </div>

      {/* Error */}
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Results */}
      {result && (
        <div className="space-y-3 pt-1">
          {/* Flash step */}
          <ResultStep label="Step 1 — Gemini Flash (rilevamento)">
            <div className="flex items-center gap-2.5">
              <span className={`text-xs px-2.5 py-1 rounded-lg border font-mono font-semibold ${
                result.flash_raw === "YES"
                  ? "bg-amber-600/15 text-amber-400 border-amber-500/25"
                  : result.flash_raw === "NO"
                    ? "bg-white/[0.03] text-muted-foreground border-white/[0.08]"
                    : "bg-red-600/10 text-red-400 border-red-500/20"
              }`}>
                {result.flash_raw ?? "Errore"}
              </span>
              <span className="text-xs text-muted-foreground">
                {result.flash_raw === "YES" ? "→ classificato come segnale" :
                 result.flash_raw === "NO"  ? "→ messaggio ignorato" :
                 "→ errore nel rilevamento"}
              </span>
            </div>
          </ResultStep>

          {/* Pro extraction */}
          {result.is_signal && (
            <ResultStep label="Step 2 — Gemini Pro (estrazione)">
              {result.sizing_strategy && (
                <p className="text-[11px] text-muted-foreground/60 italic mb-2">
                  Sizing strategy: "{result.sizing_strategy}"
                </p>
              )}
              {result.error_step === "extraction" ? (
                <ErrorBox>{result.error}</ErrorBox>
              ) : result.signals.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground">{result.signals.length} segnali estratti</p>
                  {result.signals.map((sig, i) => (
                    <SimSignalRow key={i} sig={sig} idx={i} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/60 italic">Nessun segnale estratto</p>
              )}
            </ResultStep>
          )}
        </div>
      )}
    </ToolCard>
  )
}

// ── Test order panel ──────────────────────────────────────────────────────────

function TestOrderPanel({ userId }: { userId: string }) {
  const [json, setJson]       = useState(JSON.stringify(EXAMPLE_SIGNALS, null, 2))
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<TestOrderResponse | null>(null)
  const [error, setError]     = useState<string | null>(null)

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
      setResult(await api.testOrder(userId, signals))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore sconosciuto")
    } finally {
      setLoading(false)
    }
  }, [userId, json])

  return (
    <ToolCard
      icon={<Zap className="w-4 h-4 text-indigo-400" />}
      title="Test ordine diretto"
      badge="MT5 reale"
      badgeColor="indigo"
      description="Invia un array JSON nel formato output AI direttamente a MT5. L'ordine viene eseguito su account reale — usa lotti minimi."
      warning
    >
      <textarea
        value={json}
        onChange={e => setJson(e.target.value)}
        rows={12}
        spellCheck={false}
        className="
          w-full rounded-lg border border-white/[0.08] bg-black/20
          px-3 py-2.5 text-xs font-mono text-foreground/85
          resize-y focus:outline-none focus:border-indigo-500/40
          transition-colors
        "
      />

      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          {loading ? "Esecuzione…" : "Esegui su MT5"}
        </button>
        <button
          onClick={() => { setJson(JSON.stringify(EXAMPLE_SIGNALS, null, 2)); setResult(null); setError(null) }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Ripristina esempio
        </button>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {result && (
        <ResultStep label={`Risposta MT5 — ${result.results.length} risultati`}>
          <div className="space-y-2">
            {result.results.map((res, i) => (
              <TradeResultRow key={i} res={res} idx={i} />
            ))}
          </div>
        </ResultStep>
      )}
    </ToolCard>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function ToolCard({
  icon,
  title,
  badge,
  badgeColor,
  description,
  warning,
  children,
}: {
  icon: React.ReactNode
  title: string
  badge: string
  badgeColor: "violet" | "indigo"
  description: string
  warning?: boolean
  children: React.ReactNode
}) {
  const accent = badgeColor === "violet" ? "violet" : "indigo"

  return (
    <div className={`rounded-xl border overflow-hidden ${
      accent === "violet" ? "border-violet-500/15" : "border-indigo-500/15"
    }`}>
      {/* Header */}
      <div className={`px-5 py-4 border-b ${
        accent === "violet"
          ? "bg-violet-600/5 border-violet-500/10"
          : "bg-indigo-600/5 border-indigo-500/10"
      }`}>
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            accent === "violet"
              ? "bg-violet-600/15 border border-violet-500/20"
              : "bg-indigo-600/15 border border-indigo-500/20"
          }`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide ${
                accent === "violet"
                  ? "bg-violet-600/10 text-violet-400 border-violet-500/20"
                  : "bg-indigo-600/10 text-indigo-400 border-indigo-500/20"
              }`}>
                {badge}
              </span>
              {warning && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-orange-600/10 text-orange-400 border-orange-500/20 font-medium">
                  ⚠ ordini reali
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  )
}

function ResultStep({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/10 px-4 py-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">{label}</p>
      {children}
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-600/5 px-3 py-2.5 text-xs font-mono text-red-400">
      {children}
    </div>
  )
}

function SimSignalRow({ sig, idx }: { sig: TradeSignalLog; idx: number }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2.5 text-xs font-mono">
      <div className="flex items-center gap-2 mb-1.5">
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-muted-foreground/60">
        <span><span className="text-foreground/40">Entry: </span><span className="text-foreground/75">{entryPriceLabel(sig.entry_price)}</span></span>
        <span><span className="text-foreground/40">SL: </span><span className="text-red-400/75">{sig.stop_loss ?? "—"}</span></span>
        <span><span className="text-foreground/40">TP: </span><span className="text-emerald-400/75">{sig.take_profit ?? "—"}</span></span>
        <span><span className="text-foreground/40">Lotto: </span><span className="text-foreground/75">{sig.lot_size ?? "auto"}</span></span>
      </div>
    </div>
  )
}

function TradeResultRow({ res, idx }: { res: TradeResultLog; idx: number }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs font-mono ${
      res.success ? "border-emerald-500/15 bg-emerald-600/5" : "border-red-500/15 bg-red-600/5"
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
        {res.order_id && <span className="text-foreground/60">Ticket #{res.order_id}</span>}
        {res.signal && (
          <>
            <span className={`font-bold ${res.signal.order_type === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
              {res.signal.order_type}
            </span>
            <span className="text-foreground/75">{res.signal.symbol}</span>
          </>
        )}
      </div>
      {res.error && <p className="text-red-400/75 mt-1.5 break-all">{res.error}</p>}
    </div>
  )
}
