"use client"

import { useState, useCallback } from "react"
import { ShoppingCart, Check, RotateCcw, TrendingUp, TrendingDown } from "lucide-react"
import { api, type TestSignalInput, type TradeResultLog } from "@/src/lib/api"

// ── Page ──────────────────────────────────────────────────────────────────────

export function ManualOrderPage({ userId }: { userId: string }) {
  const [symbol, setSymbol]         = useState("XAUUSD")
  const [direction, setDirection]   = useState<"BUY" | "SELL">("BUY")
  const [mode, setMode]             = useState<"MARKET" | "LIMIT" | "STOP">("MARKET")
  const [useRange, setUseRange]     = useState(false)
  const [entryPrice, setEntryPrice] = useState("")
  const [entryFrom, setEntryFrom]   = useState("")
  const [entryTo, setEntryTo]       = useState("")
  const [stopLoss, setStopLoss]     = useState("")
  const [takeProfit, setTakeProfit] = useState("")
  const [lotSize, setLotSize]       = useState("0.01")
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState<TradeResultLog | null>(null)
  const [error, setError]           = useState<string | null>(null)

  const clearResult = () => { setResult(null); setError(null) }

  const resetForm = () => {
    setSymbol("XAUUSD")
    setDirection("BUY")
    setMode("MARKET")
    setUseRange(false)
    setEntryPrice("")
    setEntryFrom("")
    setEntryTo("")
    setStopLoss("")
    setTakeProfit("")
    setLotSize("0.01")
    clearResult()
  }

  const submit = useCallback(async () => {
    if (!symbol.trim()) return
    clearResult()

    let entry_price: number | [number, number] | null = null
    if (mode !== "MARKET") {
      if (useRange) {
        const from = parseFloat(entryFrom)
        const to   = parseFloat(entryTo)
        if (isNaN(from) || isNaN(to)) { setError("Invalid entry range"); return }
        entry_price = [from, to]
      } else {
        const ep = parseFloat(entryPrice)
        if (isNaN(ep)) { setError("Invalid entry price"); return }
        entry_price = ep
      }
    }

    const sl   = stopLoss   ? parseFloat(stopLoss)   : null
    const tp   = takeProfit ? parseFloat(takeProfit)  : null
    const lots = parseFloat(lotSize)
    if (isNaN(lots) || lots <= 0) { setError("Invalid lot size"); return }

    const signal: TestSignalInput = {
      symbol:      symbol.trim().toUpperCase(),
      order_type:  direction,
      entry_price,
      stop_loss:   isNaN(sl as number)   ? null : sl,
      take_profit: isNaN(tp as number)   ? null : tp,
      lot_size:    lots,
      order_mode:  mode,
    }

    setLoading(true)
    try {
      const res = await api.testOrder(userId, [signal])
      setResult(res.results[0] ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [userId, symbol, direction, mode, useRange, entryPrice, entryFrom, entryTo, stopLoss, takeProfit, lotSize])

  const needsEntry = mode !== "MARKET"
  const symLabel   = symbol.trim().toUpperCase() || "—"

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Manual Order</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Send an order directly to your MT5 account
        </p>
      </div>

      <div className="rounded-xl border border-orange-500/15 overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 bg-orange-600/5 border-b border-orange-500/10 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-600/15 border border-orange-500/20 flex items-center justify-center shrink-0">
            <ShoppingCart className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">New order</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-orange-600/10 text-orange-400 border-orange-500/20 font-medium">
                ⚠ live orders
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              The order will be executed on the live MT5 account
            </p>
          </div>
        </div>

        {/* Form body */}
        <div className="px-5 py-5 space-y-5">

          {/* Symbol */}
          <Field label="Symbol">
            <input
              type="text"
              value={symbol}
              onChange={e => { setSymbol(e.target.value); clearResult() }}
              placeholder="XAUUSD"
              className={inputCls}
            />
          </Field>

          {/* Direction */}
          <Field label="Direction">
            <div className="flex rounded-lg overflow-hidden border border-white/[0.08]">
              {(["BUY", "SELL"] as const).map(d => (
                <button
                  key={d}
                  onClick={() => { setDirection(d); clearResult() }}
                  className={`flex-1 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    direction === d
                      ? d === "BUY"
                        ? "bg-emerald-600/20 text-emerald-400"
                        : "bg-red-600/20 text-red-400"
                      : "bg-black/20 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d === "BUY"
                    ? <TrendingUp className="w-3.5 h-3.5" />
                    : <TrendingDown className="w-3.5 h-3.5" />
                  }
                  {d}
                </button>
              ))}
            </div>
          </Field>

          {/* Order mode */}
          <Field label="Order type">
            <div className="flex rounded-lg overflow-hidden border border-white/[0.08]">
              {(["MARKET", "LIMIT", "STOP"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); clearResult() }}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                    mode === m
                      ? "bg-indigo-600/20 text-indigo-300"
                      : "bg-black/20 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>

          {/* Entry price (LIMIT / STOP only) */}
          {needsEntry && (
            <Field label="Entry price">
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={useRange}
                    onChange={e => { setUseRange(e.target.checked); clearResult() }}
                    className="accent-indigo-500"
                  />
                  <span className="text-xs text-muted-foreground">Use entry range</span>
                </label>
                {useRange ? (
                  <div className="flex gap-2">
                    <input
                      type="number" step="any" placeholder="From"
                      value={entryFrom}
                      onChange={e => { setEntryFrom(e.target.value); clearResult() }}
                      className={`${inputCls} flex-1`}
                    />
                    <input
                      type="number" step="any" placeholder="To"
                      value={entryTo}
                      onChange={e => { setEntryTo(e.target.value); clearResult() }}
                      className={`${inputCls} flex-1`}
                    />
                  </div>
                ) : (
                  <input
                    type="number" step="any" placeholder="e.g. 2320.50"
                    value={entryPrice}
                    onChange={e => { setEntryPrice(e.target.value); clearResult() }}
                    className={inputCls}
                  />
                )}
              </div>
            </Field>
          )}

          {/* SL / TP */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stop Loss (opt.)">
              <input
                type="number" step="any" placeholder="e.g. 2305.00"
                value={stopLoss}
                onChange={e => { setStopLoss(e.target.value); clearResult() }}
                className={inputCls}
              />
            </Field>
            <Field label="Take Profit (opt.)">
              <input
                type="number" step="any" placeholder="e.g. 2345.00"
                value={takeProfit}
                onChange={e => { setTakeProfit(e.target.value); clearResult() }}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Lot size */}
          <Field label="Lot size">
            <input
              type="number" step="0.01" min="0.01" placeholder="0.01"
              value={lotSize}
              onChange={e => { setLotSize(e.target.value); clearResult() }}
              className={inputCls}
            />
          </Field>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-600/5 px-3 py-2.5 text-xs font-mono text-red-400">
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`rounded-lg border px-4 py-3.5 ${
              result.success
                ? "border-emerald-500/20 bg-emerald-600/5"
                : "border-red-500/20 bg-red-600/5"
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  result.success ? "bg-emerald-600/20 text-emerald-400" : "bg-red-600/20 text-red-400"
                }`}>
                  {result.success
                    ? <Check className="w-3.5 h-3.5" />
                    : <span className="text-xs font-bold leading-none">✕</span>
                  }
                </div>
                <div>
                  <p className={`text-sm font-semibold ${result.success ? "text-emerald-400" : "text-red-400"}`}>
                    {result.success ? "Order executed" : "Order failed"}
                  </p>
                  {result.order_id && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      MT5 ticket: <span className="font-mono text-foreground/70">#{result.order_id}</span>
                    </p>
                  )}
                  {result.error && (
                    <p className="text-xs text-red-400/75 mt-1 font-mono break-all">{result.error}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={submit}
            disabled={loading || !symbol.trim()}
            className={`w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 ${
              direction === "BUY"
                ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                : "bg-red-600 hover:bg-red-500 text-white"
            }`}
          >
            {direction === "BUY"
              ? <TrendingUp className="w-4 h-4" />
              : <TrendingDown className="w-4 h-4" />
            }
            {loading ? "Executing…" : `${direction} ${symLabel}`}
          </button>

          <button
            onClick={resetForm}
            className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>

        </div>
      </div>
    </div>
  )
}

// ── Shared primitives ─────────────────────────────────────────────────────────

const inputCls = `
  w-full rounded-lg border border-white/[0.08] bg-black/20
  px-3 py-2 text-sm text-foreground/85
  focus:outline-none focus:border-indigo-500/40
  placeholder:text-muted-foreground/30 transition-colors
`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  )
}
