"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { api, ApiError, type Group, type VerifyCodeResponse } from "@/src/lib/api"
import { normalizePhone } from "@/src/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | "phone" | "session_found" | "creds" | "otp" | "twofa"
  | "group" | "mt5" | "ai_rules" | "sample_msg" | "chart"
  | "simulating" | "sim_done" | "plan" | "password" | "launching" | "done"

interface SData {
  phone: string; apiId: string; apiHash: string; loginKey: string
  userId: string; groupId: string; groupName: string
  mt5Login: string; mt5Password: string; mt5Server: string
  mt5AccountName: string; mt5Balance: string; mt5Currency: string
}

interface Strategies { sizing: string; management: string; deletion: string }

interface AdvancedSettings {
  extractionInstructions: string
  minConfidence: number
  rangeEntryPct: number
  entryIfFavorable: boolean
  tradingHoursEnabled: boolean
  tradingHoursStart: number
  tradingHoursEnd: number
  ecoCalendarEnabled: boolean
  ecoCalendarWindow: number
}

const DEFAULT_ADVANCED: AdvancedSettings = {
  extractionInstructions: "", minConfidence: 0, rangeEntryPct: 50, entryIfFavorable: false,
  tradingHoursEnabled: false, tradingHoursStart: 8, tradingHoursEnd: 22,
  ecoCalendarEnabled: false, ecoCalendarWindow: 30,
}

interface ToolCall { name: string; args: Record<string, unknown> }
interface PtEvent {
  t: number; type: string; price: number; pnl?: number; description: string
  ai_result?: { tool_calls: ToolCall[]; final_response?: string }
}
interface SimSig {
  signal_index: number; symbol: string; order_type: string
  entry: number | null; sl: number | null; tp: number | null
  events: PtEvent[]; state: string
}
interface SimData { per_signal: SimSig[]; total_pnl: number }

interface ExtractedSig {
  symbol: string; order_type: string
  entry_price: number | [number, number] | null
  stop_loss: number | null; take_profit: number | null
}

interface ChartSignal { entry: number | null; sl: number | null; tp: number | null; order_type: string }

type PlanNotes = { core?: string | null; pro?: string | null; elite?: string | null }

type ChatMsg =
  | { id: string; from: "nova"; type: "text"; text: string }
  | { id: string; from: "user"; type: "text"; text: string }
  | { id: string; from: "nova"; type: "typing" }
  | { id: string; from: "nova"; type: "phone_form" }
  | { id: string; from: "nova"; type: "creds_form" }
  | { id: string; from: "nova"; type: "otp_form" }
  | { id: string; from: "nova"; type: "twofa_form" }
  | { id: string; from: "nova"; type: "group_form" }
  | { id: string; from: "nova"; type: "mt5_form" }
  | { id: string; from: "nova"; type: "sample_msg_form" }
  | { id: string; from: "nova"; type: "chart_draw"; pMin: number; pMax: number; signals: ChartSignal[] }
  | { id: string; from: "nova"; type: "sim_result"; result: SimData }
  | { id: string; from: "nova"; type: "plan_form"; notes?: PlanNotes }
  | { id: string; from: "nova"; type: "strategies_summary"; strategies: Strategies; advanced?: AdvancedSettings }
  | { id: string; from: "nova"; type: "advanced_form" }
  | { id: string; from: "nova"; type: "action_buttons"; buttons: { label: string; action: string; primary?: boolean }[] }
  | { id: string; from: "nova"; type: "password_form" }

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }

const inp = "w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-emerald-400/40 transition-all"
const lbl = "block text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1"

function Spin() {
  return (
    <svg className="w-4 h-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 h-4 px-1">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: "rgba(52,211,153,0.7)",
            animation: `nova-bounce 1s ease-in-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

function parseMarkdown(text: string) {
  return text.split("\n").map((line, li, arr) => {
    const parts: React.ReactNode[] = []
    let rest = line; let ki = 0
    while (rest.length > 0) {
      const m = rest.match(/\*\*(.+?)\*\*/)
      if (m && m.index !== undefined) {
        if (m.index > 0) parts.push(rest.slice(0, m.index))
        parts.push(<strong key={ki++} className="text-white font-semibold">{m[1]}</strong>)
        rest = rest.slice(m.index + m[0].length)
      } else { parts.push(rest); break }
    }
    return (
      <span key={li}>
        {parts}
        {li < arr.length - 1 && <br />}
      </span>
    )
  })
}

// ── Bubble wrappers ───────────────────────────────────────────────────────────

function NovaBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 max-w-[88%]">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-black font-bold text-xs shrink-0 mt-0.5 shadow-[0_0_12px_rgba(0,232,135,0.28)]">
        N
      </div>
      <div className="bg-white/[0.05] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-white/85 leading-relaxed shadow-sm">
        {children}
      </div>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] bg-emerald-500/[0.11] border border-emerald-500/20 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white/90 leading-relaxed">
        {text}
      </div>
    </div>
  )
}

// ── Buttons ───────────────────────────────────────────────────────────────────

function PrimaryBtn({ onClick, disabled, loading = false, children, className = "" }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode; className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-400 to-cyan-400 text-black font-bold rounded-xl py-2.5 px-5 text-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(0,232,135,0.28)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${className}`}
    >
      {loading && <Spin />}
      {children}
    </button>
  )
}

function GhostBtn({ onClick, disabled, children, className = "" }: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode; className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 border border-white/12 text-white/45 rounded-xl py-2.5 px-5 text-sm transition-all hover:border-white/25 hover:text-white hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  )
}

// ── Inline forms ──────────────────────────────────────────────────────────────

function PhoneForm({ onSubmit, loading }: { onSubmit: (phone: string) => void; loading: boolean }) {
  const [val, setVal] = useState("")
  return (
    <div className="space-y-3 min-w-60">
      <div>
        <label className={lbl}>Phone number</label>
        <input
          className={inp} placeholder="+39 123 4567890" value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === "Enter" && val.trim() && onSubmit(val.trim())}
          autoFocus
        />
      </div>
      <PrimaryBtn onClick={() => val.trim() && onSubmit(val.trim())} disabled={!val.trim()} loading={loading} className="w-full">
        Continue →
      </PrimaryBtn>
    </div>
  )
}

function CredsForm({ onSubmit, loading }: { onSubmit: (id: string, hash: string) => void; loading: boolean }) {
  const [apiId, setApiId] = useState("")
  const [apiHash, setApiHash] = useState("")
  return (
    <div className="space-y-3 min-w-64">
      <div>
        <label className={lbl}>API ID</label>
        <input className={inp} placeholder="12345678" value={apiId} onChange={e => setApiId(e.target.value)} />
      </div>
      <div>
        <label className={lbl}>API Hash</label>
        <input className={inp} placeholder="a1b2c3d4e5f6…" value={apiHash} onChange={e => setApiHash(e.target.value)} />
      </div>
      <p className="text-[11px] text-white/28">Get these at <span className="text-emerald-400/60">my.telegram.org</span> → API development tools</p>
      <PrimaryBtn
        onClick={() => onSubmit(apiId.trim(), apiHash.trim())}
        disabled={!apiId.trim() || apiHash.trim().length < 32}
        loading={loading}
        className="w-full"
      >
        Send verification code
      </PrimaryBtn>
    </div>
  )
}

function OtpForm({ onSubmit, loading }: { onSubmit: (code: string) => void; loading: boolean }) {
  const [code, setCode] = useState("")
  return (
    <div className="space-y-3 min-w-52">
      <div>
        <label className={lbl}>Verification code</label>
        <input
          className={inp + " tracking-widest text-center text-lg font-bold"} placeholder="·  ·  ·  ·  ·"
          maxLength={8} value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={e => e.key === "Enter" && code.length >= 4 && onSubmit(code)}
          autoFocus
        />
      </div>
      <PrimaryBtn onClick={() => onSubmit(code)} disabled={code.length < 4} loading={loading} className="w-full">
        Verify
      </PrimaryBtn>
    </div>
  )
}

function TwoFaForm({ onSubmit, loading }: { onSubmit: (pw: string) => void; loading: boolean }) {
  const [pw, setPw] = useState("")
  return (
    <div className="space-y-3 min-w-52">
      <div>
        <label className={lbl}>Cloud password</label>
        <input
          className={inp} type="password" placeholder="Your Telegram 2FA password"
          value={pw} onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === "Enter" && pw && onSubmit(pw)}
          autoFocus
        />
      </div>
      <PrimaryBtn onClick={() => onSubmit(pw)} disabled={!pw} loading={loading} className="w-full">
        Confirm
      </PrimaryBtn>
    </div>
  )
}

function GroupForm({ groups, loadingGroups, onSelect }: {
  groups: Group[]; loadingGroups: boolean
  onSelect: (id: string, name: string) => void
}) {
  const [search, setSearch] = useState("")
  if (loadingGroups) {
    return <div className="flex items-center gap-2 text-white/40 text-sm"><Spin />Loading your rooms…</div>
  }
  const filtered = groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="space-y-2 min-w-72 max-w-sm">
      <input className={inp} placeholder="Search rooms…" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
        {filtered.length === 0 && <p className="text-white/28 text-xs py-2 text-center">No rooms found</p>}
        {filtered.map(g => (
          <button
            key={g.id}
            onClick={() => onSelect(g.id, g.name)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all group"
          >
            <div className="w-8 h-8 rounded-lg bg-violet-500/12 border border-violet-500/18 flex items-center justify-center shrink-0">
              <span className="text-violet-400 text-xs font-bold">{g.name.slice(0, 1).toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-white/85 font-medium truncate group-hover:text-white transition-colors">{g.name}</p>
              <p className="text-[11px] text-white/30">{g.type} · {g.members.toLocaleString()} members</p>
            </div>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-white/28 leading-snug pt-0.5">
        You can add more signal rooms later from the dashboard — the number of rooms depends on your plan.
      </p>
    </div>
  )
}

function MT5Form({ onSubmit, loading }: {
  onSubmit: (login: string, pw: string, server: string) => void
  loading: boolean
}) {
  const [login, setLogin] = useState("")
  const [pw, setPw] = useState("")
  const [server, setServer] = useState("")
  return (
    <div className="space-y-3 min-w-64">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lbl}>Login (account #)</label>
          <input className={inp} placeholder="123456" value={login} onChange={e => setLogin(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Password</label>
          <input className={inp} type="password" placeholder="••••••" value={pw} onChange={e => setPw(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={lbl}>Server</label>
        <input className={inp} placeholder="BrokerName-Live" value={server} onChange={e => setServer(e.target.value)} />
      </div>
      <PrimaryBtn
        onClick={() => onSubmit(login.trim(), pw, server.trim())}
        disabled={!login.trim() || !pw || !server.trim()}
        loading={loading}
        className="w-full"
      >
        {loading ? "Verifying…" : "Verify & connect MT5"}
      </PrimaryBtn>
    </div>
  )
}

type RecentMsg = { id: number; text: string; date: string | null }

function SampleMsgForm({ onSubmit, onSkip, loading, recentMsgs }: {
  onSubmit: (m: string) => void
  onSkip: () => void
  loading: boolean
  recentMsgs: RecentMsg[]
}) {
  const [tab, setTab] = useState<"paste" | "pick">(recentMsgs.length > 0 ? "pick" : "paste")
  const [val, setVal] = useState("")
  const [picked, setPicked] = useState<number | null>(null)

  function submit() {
    if (tab === "paste") onSubmit(val.trim())
    else if (picked !== null) {
      const msg = recentMsgs.find(m => m.id === picked)
      if (msg) onSubmit(msg.text)
    }
  }

  const canSubmit = tab === "paste" ? !!val.trim() : picked !== null

  return (
    <div className="space-y-3 min-w-72 max-w-sm">
      {recentMsgs.length > 0 && (
        <div className="flex rounded-lg overflow-hidden border border-white/8 text-[11px] font-semibold">
          {(["pick", "paste"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 transition-colors ${tab === t ? "bg-white/8 text-white" : "text-white/35 hover:text-white/55"}`}
            >
              {t === "pick" ? "Select from channel" : "Paste manually"}
            </button>
          ))}
        </div>
      )}

      {tab === "paste" ? (
        <textarea
          className={inp + " resize-none h-28"}
          placeholder={"e.g.\nBUY EURUSD\nEntry: 1.0850\nSL: 1.0820\nTP: 1.0910"}
          value={val}
          onChange={e => setVal(e.target.value)}
        />
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
          {recentMsgs.map(m => (
            <button
              key={m.id}
              onClick={() => setPicked(m.id)}
              className={`w-full text-left rounded-lg border px-3 py-2 transition-all ${
                picked === m.id
                  ? "border-emerald-400/35 bg-emerald-500/8 ring-1 ring-emerald-400/20"
                  : "border-white/6 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/12"
              }`}
            >
              <p className="text-[11px] text-white/70 leading-snug line-clamp-3 whitespace-pre-wrap">{m.text}</p>
              {m.date && (
                <p className="text-[10px] text-white/25 mt-1">{new Date(m.date).toLocaleString()}</p>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <PrimaryBtn onClick={submit} disabled={!canSubmit} loading={loading} className="flex-1">
          Use this message →
        </PrimaryBtn>
        <GhostBtn onClick={onSkip}>Skip simulation</GhostBtn>
      </div>
    </div>
  )
}

function PasswordForm({ onSubmit, loading }: { onSubmit: (pw: string) => void; loading: boolean }) {
  const [pw,      setPw]      = useState("")
  const [confirm, setConfirm] = useState("")
  const [err,     setErr]     = useState<string | null>(null)

  function submit() {
    if (pw.length < 8) { setErr("Minimum 8 characters"); return }
    if (pw !== confirm) { setErr("Passwords don't match"); return }
    setErr(null)
    onSubmit(pw)
  }

  return (
    <div className="space-y-3 min-w-64">
      <div>
        <label className={lbl}>Password</label>
        <input type="password" className={inp} placeholder="Min. 8 characters" value={pw}
          onChange={e => { setPw(e.target.value); setErr(null) }} autoFocus autoComplete="new-password" />
      </div>
      <div>
        <label className={lbl}>Confirm password</label>
        <input type="password" className={inp} placeholder="Repeat password" value={confirm}
          onChange={e => { setConfirm(e.target.value); setErr(null) }} autoComplete="new-password"
          onKeyDown={e => e.key === "Enter" && submit()} />
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <PrimaryBtn onClick={submit} disabled={!pw || !confirm} loading={loading} className="w-full">
        Set password & launch →
      </PrimaryBtn>
    </div>
  )
}

function StrategiesSummary({ strategies, advanced }: { strategies: Strategies; advanced?: AdvancedSettings }) {
  const stratItems = [
    { label: "Position sizing", value: strategies.sizing, icon: "⚖️" },
    { label: "Trade management", value: strategies.management, icon: "🛡️" },
    { label: "Signal deletion", value: strategies.deletion, icon: "🗑️" },
  ].filter(it => it.value && it.value !== "null")

  const advItems: { label: string; value: string; icon: string }[] = []
  if (advanced) {
    if (advanced.extractionInstructions) advItems.push({ label: "Signal parsing hint", value: advanced.extractionInstructions, icon: "🔍" })
    if (advanced.minConfidence > 0) advItems.push({ label: "Min. confidence", value: `${advanced.minConfidence}%`, icon: "🎯" })
    if (advanced.rangeEntryPct !== 50) advItems.push({ label: "Range entry", value: `${advanced.rangeEntryPct}% into range`, icon: "📏" })
    if (advanced.entryIfFavorable) advItems.push({ label: "Entry filter", value: "Only enter if price moves favorably first", icon: "📐" })
    if (advanced.tradingHoursEnabled) advItems.push({ label: "Trading hours", value: `${advanced.tradingHoursStart}:00 – ${advanced.tradingHoursEnd}:00 (server time)`, icon: "🕐" })
    if (advanced.ecoCalendarEnabled) advItems.push({ label: "Economic calendar", value: `Pause ±${advanced.ecoCalendarWindow} min around major events`, icon: "📅" })
  }

  if (stratItems.length === 0 && advItems.length === 0) return null
  return (
    <div className="space-y-2 min-w-60 max-w-sm">
      {stratItems.length > 0 && (
        <>
          <p className="text-[11px] text-white/38 font-semibold uppercase tracking-wider">Trading strategies</p>
          {stratItems.map(it => (
            <div key={it.label} className="flex gap-2.5 bg-emerald-500/[0.06] border border-emerald-500/14 rounded-xl px-3 py-2.5">
              <span>{it.icon}</span>
              <div>
                <p className="text-[11px] text-emerald-400/65 font-semibold">{it.label}</p>
                <p className="text-sm text-white/78 leading-snug">{it.value}</p>
              </div>
            </div>
          ))}
        </>
      )}
      {advItems.length > 0 && (
        <>
          <p className="text-[11px] text-white/38 font-semibold uppercase tracking-wider mt-3">Advanced settings</p>
          {advItems.map(it => (
            <div key={it.label} className="flex gap-2.5 bg-violet-500/[0.06] border border-violet-500/14 rounded-xl px-3 py-2.5">
              <span>{it.icon}</span>
              <div>
                <p className="text-[11px] text-violet-400/65 font-semibold">{it.label}</p>
                <p className="text-sm text-white/78 leading-snug">{it.value}</p>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function AdvancedForm({ initialValues, onSubmit, onSkip }: {
  initialValues: AdvancedSettings
  onSubmit: (v: AdvancedSettings) => void
  onSkip: () => void
}) {
  const [vals, setVals] = useState(initialValues)
  const set = (k: keyof AdvancedSettings, v: unknown) => setVals(prev => ({ ...prev, [k]: v }))
  return (
    <div className="space-y-4 min-w-72 max-w-sm">
      {/* Extraction hint */}
      <div>
        <label className={lbl}>Signal parsing hint <span className="text-white/20 normal-case font-normal">(optional)</span></label>
        <textarea
          className={inp + " resize-none h-16 text-xs"}
          placeholder={"e.g. 'zone' means range entry. SL/TP are in pips, not price."}
          value={vals.extractionInstructions}
          onChange={e => set("extractionInstructions", e.target.value)}
        />
      </div>
      {/* Min confidence */}
      <div>
        <label className={lbl}>Minimum signal confidence — <span className="text-emerald-400/70">{vals.minConfidence}%</span></label>
        <input type="range" min="0" max="95" step="5" value={vals.minConfidence}
          onChange={e => set("minConfidence", Number(e.target.value))}
          className="w-full accent-emerald-400 mt-1" />
        <p className="text-[10px] text-white/25 mt-0.5">Skip signals the AI is less than {vals.minConfidence}% confident about. Set 0 to execute all.</p>
      </div>
      {/* Range entry pct */}
      <div>
        <label className={lbl}>Range entry — <span className="text-emerald-400/70">{vals.rangeEntryPct}% into range</span></label>
        <input type="range" min="0" max="100" step="10" value={vals.rangeEntryPct}
          onChange={e => set("rangeEntryPct", Number(e.target.value))}
          className="w-full accent-emerald-400 mt-1" />
        <p className="text-[10px] text-white/25 mt-0.5">When the signal has a price range (e.g. 72500–72600), enter at this % into the range. 0% = lower bound, 50% = midpoint, 100% = upper bound.</p>
      </div>
      {/* Entry favorable */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className={`w-9 h-5 rounded-full transition-colors relative ${vals.entryIfFavorable ? "bg-emerald-500" : "bg-white/10"}`}
          onClick={() => set("entryIfFavorable", !vals.entryIfFavorable)}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${vals.entryIfFavorable ? "left-4" : "left-0.5"}`} />
        </div>
        <div>
          <p className="text-sm text-white/75">Favorable entry only</p>
          <p className="text-[10px] text-white/28">For BUY, only enter after price dips to entry. For SELL, after a spike.</p>
        </div>
      </label>
      {/* Trading hours */}
      <div>
        <label className="flex items-center gap-3 cursor-pointer mb-2">
          <div className={`w-9 h-5 rounded-full transition-colors relative ${vals.tradingHoursEnabled ? "bg-emerald-500" : "bg-white/10"}`}
            onClick={() => set("tradingHoursEnabled", !vals.tradingHoursEnabled)}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${vals.tradingHoursEnabled ? "left-4" : "left-0.5"}`} />
          </div>
          <span className="text-sm text-white/75">Trading hours filter</span>
        </label>
        {vals.tradingHoursEnabled && (
          <div className="flex items-center gap-2 pl-12">
            <input type="number" min="0" max="23" value={vals.tradingHoursStart}
              onChange={e => set("tradingHoursStart", Number(e.target.value))}
              className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-sm text-white/80 font-mono text-center focus:outline-none" />
            <span className="text-white/30 text-sm">to</span>
            <input type="number" min="0" max="23" value={vals.tradingHoursEnd}
              onChange={e => set("tradingHoursEnd", Number(e.target.value))}
              className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-sm text-white/80 font-mono text-center focus:outline-none" />
            <span className="text-[10px] text-white/25">server time (h)</span>
          </div>
        )}
      </div>
      {/* Economic calendar */}
      <div>
        <label className="flex items-center gap-3 cursor-pointer mb-2">
          <div className={`w-9 h-5 rounded-full transition-colors relative ${vals.ecoCalendarEnabled ? "bg-emerald-500" : "bg-white/10"}`}
            onClick={() => set("ecoCalendarEnabled", !vals.ecoCalendarEnabled)}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${vals.ecoCalendarEnabled ? "left-4" : "left-0.5"}`} />
          </div>
          <span className="text-sm text-white/75">Economic calendar filter</span>
        </label>
        {vals.ecoCalendarEnabled && (
          <div className="flex items-center gap-2 pl-12">
            <span className="text-[10px] text-white/30">Pause</span>
            <input type="number" min="5" max="120" step="5" value={vals.ecoCalendarWindow}
              onChange={e => set("ecoCalendarWindow", Number(e.target.value))}
              className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-sm text-white/80 font-mono text-center focus:outline-none" />
            <span className="text-[10px] text-white/30">min before/after high-impact events</span>
          </div>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <PrimaryBtn onClick={() => onSubmit(vals)} className="flex-1">Save & continue →</PrimaryBtn>
        <GhostBtn onClick={onSkip}>Skip</GhostBtn>
      </div>
    </div>
  )
}

// ── Frozen chart (static snapshot after simulation) ───────────────────────────

function FrozenChart({ pricePath, simResult, pMin, pMax }: {
  pricePath: { t: number; price: number }[]
  simResult: SimData | null
  pMin: number; pMax: number
}) {
  const FW = 1000; const FH = 140
  const tToX = (t: number) => (t * FW).toFixed(1)
  const pToY = (p: number) => pMax === pMin ? String(FH / 2)
    : ((1 - (p - pMin) / (pMax - pMin)) * FH).toFixed(1)

  const pathD = pricePath.length >= 2
    ? pricePath.map((p, i) => `${i === 0 ? "M" : "L"} ${tToX(p.t)} ${pToY(p.price)}`).join(" ")
    : ""
  const closedD = pathD
    ? pathD + ` L ${tToX(pricePath[pricePath.length - 1].t)} ${FH} L 0 ${FH} Z`
    : ""
  const simEvents = simResult?.per_signal?.flatMap(s => s.events) ?? []
  const priceRange = pMax - pMin
  const priceDecs = priceRange < 0.005 ? 5 : priceRange < 0.05 ? 4 : priceRange < 0.5 ? 3 : priceRange < 5 ? 2 : 1

  return (
    <div className="space-y-2 w-full opacity-55" style={{ maxWidth: 500 }}>
      <div className="relative rounded-xl overflow-hidden border border-white/8 bg-black/30" style={{ height: FH }}>
        <svg viewBox={`0 0 ${FW} ${FH}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          <defs>
            <linearGradient id="frozen-pgrd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
          </defs>
          {closedD && <path d={closedD} fill="url(#frozen-pgrd)" />}
          {pathD && <path d={pathD} fill="none" stroke="#34d399" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
          {[0, 0.5, 1].map(f => (
            <text key={f} x="8" y={(f * FH).toFixed(0)} dominantBaseline="middle"
              fill="white" fillOpacity="0.18" fontSize="14" fontFamily="monospace">
              {(pMin + (1 - f) * (pMax - pMin)).toFixed(priceDecs)}
            </text>
          ))}
          {simEvents.map((ev, i) => {
            const col = EVT_COLORS[ev.type] ?? "#94a3b8"
            return <circle key={i} cx={tToX(ev.t)} cy={pToY(ev.price)} r="5"
              fill={col} fillOpacity="0.70" stroke="#000" strokeWidth="1" />
          })}
        </svg>
      </div>
      {simResult && <SimResultCard result={simResult} />}
    </div>
  )
}

// ── Inline Chart ──────────────────────────────────────────────────────────────

const EVT_COLORS: Record<string, string> = {
  entry: "#34d399", sl: "#f87171", tp: "#60a5fa",
  close: "#c084fc", expired: "#facc15", signal_deleted: "#fb923c",
  partial_close: "#a78bfa",
}
// Signal reference line colors: SL=red, Entry=white, TP=green
const SIG_LINE_COLORS = { sl: "#f87171", entry: "#e2e8f0", tp: "#34d399" }
const CHART_H = 240

function InlineChart({
  pricePath, setPricePath, tEvents, setTEvents, simResult, onRunSim, simLoading,
  initPMin, initPMax, signals = [],
}: {
  pricePath: { t: number; price: number }[]
  setPricePath: (v: { t: number; price: number }[]) => void
  tEvents: { t: number; type: string }[]
  setTEvents: (v: { t: number; type: string }[]) => void
  simResult: SimData | null
  onRunSim: () => void
  simLoading: boolean
  initPMin: number; initPMax: number
  signals?: ChartSignal[]
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [rawPath, setRawPath] = useState<{ t: number; price: number }[]>([])
  const [deletionMode, setDeletionMode] = useState(false)
  const [pMinStr, setPMinStr] = useState(String(initPMin))
  const [pMaxStr, setPMaxStr] = useState(String(initPMax))
  // Track actual pixel width so viewBox matches container — prevents distortion of text/circles
  const [cw, setCw] = useState(400)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setCw(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const CH = CHART_H
  const pMin = parseFloat(pMinStr) || 0
  const pMax = parseFloat(pMaxStr) || 1
  const validRange = pMin < pMax

  // Coordinates in actual pixel space — viewBox matches container, no distortion
  const tToX = (t: number) => (t * cw).toFixed(1)
  const pToY = (p: number) => pMax === pMin ? String(CH / 2)
    : ((1 - (p - pMin) / (pMax - pMin)) * CH).toFixed(1)

  function svgFrac(e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  function fracToPrice(y: number) { return pMin + (1 - Math.max(0, Math.min(1, y))) * (pMax - pMin) }

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (!validRange) return
    const { x, y } = svgFrac(e)
    if (deletionMode) {
      if (pricePath.length < 2) return
      setTEvents([{ t: x, type: "signal_deleted" }])
      setDeletionMode(false)
      return
    }
    if (pricePath.length > 0) return
    setDrawing(true)
    setRawPath([{ t: x, price: fracToPrice(y) }])
    setTEvents([])
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!drawing) return
    const { x, y } = svgFrac(e)
    const price = fracToPrice(y)
    setRawPath(prev => {
      if (prev.length === 0) return [{ t: x, price }]
      const last = prev[prev.length - 1]
      if (x < last.t + 0.002) return prev
      return [...prev, { t: x, price }]
    })
  }

  function handleMouseUp() {
    if (!drawing) return
    setDrawing(false)
    if (rawPath.length < 2) { setRawPath([]); return }
    const tMin = Math.min(...rawPath.map(p => p.t))
    const tMax = Math.max(...rawPath.map(p => p.t))
    const tRange = tMax - tMin || 1
    const normalized = rawPath.map(p => ({ t: (p.t - tMin) / tRange, price: p.price }))
    setPricePath(normalized)
    setRawPath([])
    const prices = normalized.map(p => p.price)
    const dMin = Math.min(...prices); const dMax = Math.max(...prices)
    const range = dMax - dMin || 1
    const margin = range * 0.08
    const decs = range < 0.005 ? 5 : range < 0.05 ? 4 : range < 0.5 ? 3 : range < 5 ? 2 : range < 50 ? 1 : 0
    setPMinStr((dMin - margin).toFixed(decs))
    setPMaxStr((dMax + margin).toFixed(decs))
  }

  function clear() {
    setPricePath([]); setRawPath([]); setTEvents([])
    setDeletionMode(false)
    setPMinStr(String(initPMin)); setPMaxStr(String(initPMax))
  }

  const displayPath = pricePath.length >= 2 ? pricePath : rawPath
  const pathD = displayPath.length >= 2
    ? displayPath.map((p, i) => `${i === 0 ? "M" : "L"} ${tToX(p.t)} ${pToY(p.price)}`).join(" ")
    : ""
  const closedD = pathD
    ? pathD + ` L ${tToX(displayPath[displayPath.length - 1].t)} ${CH} L 0 ${CH} Z`
    : ""

  const simEvents = simResult?.per_signal?.flatMap(s => s.events) ?? []
  const hasPath = pricePath.length >= 2

  const priceRange = pMax - pMin
  const priceDecs = priceRange < 0.005 ? 5 : priceRange < 0.05 ? 4 : priceRange < 0.5 ? 3 : priceRange < 5 ? 2 : 1
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(f => ({ f, price: pMin + (1 - f) * (pMax - pMin) }))

  // Signal reference lines — always visible while validRange, not just before drawing
  const sigRefLines: { price: number; color: string; label: string; dash: boolean }[] = []
  if (validRange) {
    const seen = new Set<number>()
    signals.forEach(sig => {
      const add = (p: number | null, color: string, label: string, dash: boolean) => {
        if (p === null || p === undefined || seen.has(p)) return
        seen.add(p)
        sigRefLines.push({ price: p, color, label, dash })
      }
      const e = Array.isArray(sig.entry) ? sig.entry[0] : sig.entry as number | null
      add(e,      SIG_LINE_COLORS.entry, "E",  false)
      add(sig.sl, SIG_LINE_COLORS.sl,    "SL", true)
      add(sig.tp, SIG_LINE_COLORS.tp,    "TP", true)
    })
  }

  return (
    <div className="space-y-3 w-full" style={{ maxWidth: 500 }}>
      {/* Price range inputs */}
      <div className="flex items-center gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <label className="text-white/35 font-medium">Max</label>
          <input
            className="w-24 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-sm text-white/80 font-mono text-center focus:outline-none focus:border-emerald-400/40 transition-all"
            value={pMaxStr} onChange={e => setPMaxStr(e.target.value)}
            disabled={hasPath}
          />
        </div>
        <span className="text-white/20">→</span>
        <div className="flex items-center gap-1.5">
          <label className="text-white/35 font-medium">Min</label>
          <input
            className="w-24 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-sm text-white/80 font-mono text-center focus:outline-none focus:border-emerald-400/40 transition-all"
            value={pMinStr} onChange={e => setPMinStr(e.target.value)}
            disabled={hasPath}
          />
        </div>
        {!validRange && <span className="text-red-400/70 text-[11px]">Max must be greater than Min</span>}
      </div>

      {/* Chart SVG */}
      <div
        className={`relative rounded-xl overflow-hidden border select-none ${
          validRange && !hasPath && !deletionMode ? "cursor-crosshair border-emerald-400/20" :
          deletionMode ? "cursor-cell border-orange-500/30" : "border-white/10"
        } bg-black/40`}
        style={{ height: CH }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${cw} ${CH}`}
          className="absolute inset-0 w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <defs>
            <linearGradient id="chart-pgrd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(v => (
            <g key={v}>
              <line x1="0" y1={v * CH} x2={cw} y2={v * CH} stroke="white" strokeOpacity="0.04" strokeWidth="1" />
              <line x1={v * cw} y1="0" x2={v * cw} y2={CH} stroke="white" strokeOpacity="0.04" strokeWidth="1" />
            </g>
          ))}

          {/* Signal reference lines (entry/SL/TP) — always visible */}
          {sigRefLines.map((l, i) => {
            const y = parseFloat(pToY(l.price))
            if (y < 0 || y > CH) return null  // out of range
            const priceStr = l.price.toFixed(priceDecs)
            const labelText = `${l.label} ${priceStr}`
            const pillW = labelText.length * 5.5 + 6
            return (
              <g key={i}>
                <line x1="0" y1={y} x2={cw} y2={y}
                  stroke={l.color} strokeOpacity="0.50" strokeWidth="1"
                  strokeDasharray={l.dash ? "6 4" : "none"} />
                <rect x={cw - pillW - 2} y={y - 8} width={pillW} height="14" fill={l.color} fillOpacity="0.15" rx="2" />
                <text x={cw - pillW / 2 - 2} y={y} fill={l.color} fillOpacity="0.90"
                  fontSize="9" fontFamily="monospace" textAnchor="middle" dominantBaseline="middle">{labelText}</text>
              </g>
            )
          })}

          {/* Y-axis price labels — always visible */}
          {yLabels.map(({ f, price }) => (
            <text key={f} x="4" y={(f * CH).toFixed(0)} dominantBaseline="middle"
              fill="white" fillOpacity="0.25" fontSize="9" fontFamily="monospace">
              {price.toFixed(priceDecs)}
            </text>
          ))}

          {/* Area fill */}
          {closedD && <path d={closedD} fill="url(#chart-pgrd)" />}

          {/* Path line */}
          {pathD && (
            <path d={pathD} fill="none" stroke="#34d399" strokeWidth="1.5"
              strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* Sim event markers */}
          {simEvents.map((ev, i) => {
            const col = EVT_COLORS[ev.type] ?? "#94a3b8"
            return (
              <circle key={i} cx={tToX(ev.t)} cy={pToY(ev.price)} r="5"
                fill={col} fillOpacity="0.92" stroke="#000" strokeWidth="1" />
            )
          })}

          {/* Deletion event marker */}
          {tEvents.map((ev, i) => (
            <g key={i}>
              <line x1={tToX(ev.t)} y1="0" x2={tToX(ev.t)} y2={CH}
                stroke={EVT_COLORS.signal_deleted} strokeWidth="1.5"
                strokeDasharray="5 3" strokeOpacity="0.80" />
              <text x={tToX(ev.t)} y="10" fill={EVT_COLORS.signal_deleted} fontSize="8"
                textAnchor="middle" fontFamily="monospace" dominantBaseline="middle">DEL</text>
            </g>
          ))}

          {/* Empty hint */}
          {!pathD && !drawing && (
            <text x={cw / 2} y={CH / 2} textAnchor="middle"
              fill="white" fillOpacity="0.18" fontSize="12" fontFamily="sans-serif" dominantBaseline="middle">
              {validRange
                ? (deletionMode ? "Click to place deletion event" : "Click and drag to draw a price path")
                : "Set the price range above first"}
            </text>
          )}
        </svg>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {hasPath && !simLoading && (
          <>
            <button
              onClick={() => setDeletionMode(v => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                deletionMode
                  ? "bg-orange-500/18 border-orange-500/38 text-orange-400"
                  : "border-white/10 text-white/38 hover:border-white/20 hover:text-white/60"
              }`}
            >
              {deletionMode ? "Click on chart to place…" : "+ Mark deletion event"}
            </button>
            {tEvents.length > 0 && (
              <button onClick={() => setTEvents([])} className="text-xs px-2 py-1.5 rounded-lg border border-white/10 text-white/28 hover:text-white/50 transition-all">
                ✕ Remove
              </button>
            )}
          </>
        )}
        {!simLoading && <GhostBtn onClick={clear} className="text-xs py-1.5 px-3">Clear</GhostBtn>}
        {hasPath && (
          <PrimaryBtn onClick={onRunSim} loading={simLoading} disabled={simLoading} className="ml-auto text-sm py-2 px-4">
            {simLoading ? "Simulating…" : "Run simulation →"}
          </PrimaryBtn>
        )}
      </div>

      {/* Sim result inline */}
      {simResult && <SimResultCard result={simResult} />}
    </div>
  )
}

// ── Sim result card ───────────────────────────────────────────────────────────

function fmtToolCall(tc: ToolCall): string {
  const args = Object.entries(tc.args)
    .map(([k, v]) => {
      if (typeof v === "number") return `${k}=${Number.isInteger(v) ? v : Number(v).toFixed(5)}`
      return `${k}=${v}`
    })
    .join(", ")
  return `${tc.name}(${args})`
}

function SimResultCard({ result }: { result: SimData }) {
  const pnl = result.total_pnl
  const pnlColor = pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-red-400" : "text-white/45"
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-white/38 font-semibold uppercase tracking-wider">Simulation result</span>
        <span className={`font-bold text-sm ${pnlColor}`}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} USD</span>
      </div>
      {result.per_signal.map((sig, i) => (
        <div key={i} className="border-t border-white/6 pt-2.5 space-y-1.5 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sig.order_type === "BUY" ? "bg-emerald-500/14 text-emerald-400" : "bg-red-500/14 text-red-400"}`}>
              {sig.order_type}
            </span>
            <span className="text-xs text-white/55">{sig.symbol}</span>
            <span className="text-[10px] text-white/28 font-mono ml-1">
              E:{sig.entry?.toFixed(2) ?? "–"} SL:{sig.sl?.toFixed(2) ?? "–"} TP:{sig.tp?.toFixed(2) ?? "–"}
            </span>
            <span className={`ml-auto text-xs font-semibold ${
              sig.state === "tp" ? "text-blue-400" : sig.state === "sl" ? "text-red-400" :
              sig.state === "expired" ? "text-yellow-400" : sig.state === "open" ? "text-emerald-400/60" : "text-white/38"
            }`}>{sig.state.toUpperCase()}</span>
          </div>
          {sig.events.map((ev, j) => {
            const col = EVT_COLORS[ev.type] ?? "#94a3b8"
            const tcs = ev.ai_result?.tool_calls ?? []
            return (
              <div key={j} className="pl-1 space-y-0.5">
                <div className="flex items-center gap-2 text-[11px] text-white/45">
                  <span style={{ color: col }} className="font-semibold uppercase w-20 shrink-0">{ev.type.replace("_", " ")}</span>
                  <span className="font-mono">{ev.price.toFixed(5)}</span>
                  {ev.pnl !== undefined && (
                    <span className={`ml-auto font-semibold ${ev.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {ev.pnl >= 0 ? "+" : ""}{ev.pnl.toFixed(2)}
                    </span>
                  )}
                </div>
                {ev.description && (
                  <p className="text-[10px] text-white/25 pl-20 leading-tight">{ev.description}</p>
                )}
                {tcs.length > 0 && (
                  <div className="pl-20 space-y-0.5">
                    {tcs.map((tc, k) => (
                      <p key={k} className="text-[10px] font-mono text-violet-400/70">
                        → {fmtToolCall(tc)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Plan form ─────────────────────────────────────────────────────────────────

const PLANS = [
  {
    id: "core" as const, name: "Core", price: "€79",
    tagline: "Automated signal execution",
    features: ["1 Telegram room", "Auto SL & TP", "Basic stats"],
    accent: "border-white/12 hover:border-white/25",
  },
  {
    id: "pro" as const, name: "Pro", price: "€149",
    tagline: "For active traders",
    features: ["Up to 5 rooms", "Full backtesting", "Advanced metrics"],
    accent: "border-emerald-500/22 hover:border-emerald-400/38",
    badge: "Popular",
  },
  {
    id: "elite" as const, name: "Elite", price: "€299",
    tagline: "Professional automation",
    features: ["Unlimited rooms", "Custom AI rules", "Priority support"],
    accent: "border-amber-500/22 hover:border-amber-400/35",
    badge: "Best",
  },
]

const PLAN_FULL_FEATURES: Record<"core" | "pro" | "elite", string[]> = {
  core: [
    "1 Telegram signal room",
    "Automatic signal detection",
    "Instant order execution",
    "Automatic stop loss & take profit",
    "Dashboard with basic stats",
    "Full signal history",
    "Recent trade history",
    "Risk-free signal testing",
    "Step-by-step guided setup",
    "Encrypted & protected credentials",
  ],
  pro: [
    "Up to 5 Telegram signal rooms",
    "Advanced signal analysis",
    "Separate settings per room",
    "Range orders with optimized entry",
    "Full stats & charts",
    "Historical signal backtesting",
    "Performance dashboard",
    "Advanced metrics (profit factor, Sharpe ratio)",
    "Copy settings across rooms",
  ],
  elite: [
    "Unlimited signal rooms",
    "Custom trading rules (approve / skip / modify)",
    "Automatic open position management",
    "Auto-close when signal is revoked",
    "Copy trading across accounts",
    "Priority support with dedicated onboarding",
    "Custom strategy configuration session",
  ],
}

function getRelevantMissing(
  planId: "core" | "pro" | "elite",
  strats: Strategies,
  adv: AdvancedSettings,
): string[] {
  const hasSizing    = !!strats.sizing
  const hasManagement = !!strats.management
  const hasDeletion  = !!strats.deletion
  const hasFilters   = adv.minConfidence > 0 || adv.entryIfFavorable || adv.tradingHoursEnabled || adv.ecoCalendarEnabled
  const hasRange     = adv.rangeEntryPct !== 50

  if (planId === "core") {
    const m: string[] = []
    if (hasFilters || hasRange) m.push("Advanced signal analysis")
    if (hasSizing || hasManagement || hasDeletion) m.push("Custom trading rules")
    return m
  }
  if (planId === "pro") {
    const m: string[] = []
    if (hasSizing || hasDeletion) m.push("Custom trading rules")
    if (hasManagement) m.push("Automatic position management")
    return m
  }
  return []
}

function PlanForm({ onSelect, notes, strategies, advanced }: {
  onSelect: (plan: "core" | "pro" | "elite") => void
  notes?: PlanNotes
  strategies: Strategies
  advanced: AdvancedSettings
}) {
  const [sel, setSel] = useState<"core" | "pro" | "elite" | null>(null)
  const [expanded, setExpanded] = useState<"core" | "pro" | "elite" | null>(null)
  return (
    <div className="space-y-2.5 min-w-72 max-w-sm">
      {PLANS.map(p => {
        const note = notes?.[p.id]
        const isOpen = expanded === p.id
        const fullFeatures = PLAN_FULL_FEATURES[p.id]
        const missing = getRelevantMissing(p.id, strategies, advanced)
        return (
          <div key={p.id}>
            <button
              onClick={() => setSel(p.id)}
              className={`w-full text-left rounded-xl border p-4 transition-all ${p.accent} ${
                sel === p.id ? "bg-white/[0.06] ring-1 ring-emerald-400/25" : "bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{p.name}</span>
                  {"badge" in p && p.badge && (
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-500/14 text-emerald-400 px-1.5 py-0.5 rounded">
                      {p.badge}
                    </span>
                  )}
                </div>
                <span className="font-bold text-white">{p.price}</span>
              </div>
              <p className="text-xs text-white/38 mb-1.5">{p.tagline}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {p.features.map(f => <span key={f} className="text-[11px] text-white/45">✓ {f}</span>)}
              </div>
            </button>
            <button
              onClick={() => setExpanded(isOpen ? null : p.id)}
              className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/50 transition-colors mt-1 px-1"
            >
              <svg
                className="w-2.5 h-2.5 shrink-0 transition-transform"
                style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Plan details
            </button>
            {isOpen && (
              <div className="mx-1 mt-1 rounded-lg border border-white/6 bg-white/[0.025] px-3 py-2.5 space-y-2">
                <div>
                  <p className="text-[10px] font-semibold text-emerald-400/60 uppercase tracking-wider mb-1">Included</p>
                  <ul className="space-y-0.5">
                    {fullFeatures.map((f, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-white/50">
                        <span className="text-emerald-400/70 shrink-0 mt-px">✓</span>{f}
                      </li>
                    ))}
                  </ul>
                </div>
                {missing.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-red-400/60 uppercase tracking-wider mb-1">Not included</p>
                    <ul className="space-y-0.5">
                      {missing.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] text-white/50">
                          <span className="text-red-400/70 shrink-0 mt-px">✗</span>{f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {note && (
              <p className="text-[11px] text-amber-400/75 leading-snug mt-1.5 px-1">
                ⚠ {note}
              </p>
            )}
          </div>
        )
      })}
      <PrimaryBtn onClick={() => sel && onSelect(sel)} disabled={!sel} className="w-full">
        {sel ? `Start with ${PLANS.find(p => p.id === sel)!.name} →` : "Select a plan"}
      </PrimaryBtn>
    </div>
  )
}

// ── Completed badge (shown when a form is submitted) ──────────────────────────

function CompletedBadge() {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-white/30 py-0.5">
      <svg className="w-3.5 h-3.5 text-emerald-400/50 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      Completed
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NovaChatWizard() {
  const router = useRouter()
  const bottomRef = useRef<HTMLDivElement>(null)

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [phase, setPhase] = useState<Phase>("phone")
  const [formLoading, setFormLoading] = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const [chatInput, setChatInput] = useState("")
  const [submittedForms, setSubmittedForms] = useState<Set<string>>(new Set())

  const markSubmitted = useCallback((id: string) => {
    setSubmittedForms(prev => new Set([...prev, id]))
  }, [])

  const [sdata, setSdata] = useState<SData>({
    phone: "", apiId: "", apiHash: "", loginKey: "", userId: "",
    groupId: "", groupName: "", mt5Login: "", mt5Password: "",
    mt5Server: "", mt5AccountName: "", mt5Balance: "", mt5Currency: "",
  })
  const upd = (p: Partial<SData>) => setSdata(prev => ({ ...prev, ...p }))

  const [strategies, setStrategies] = useState<Strategies>({ sizing: "", management: "", deletion: "" })
  const [strategiesReady, setStrategiesReady] = useState(false)
  const [advanced, setAdvanced] = useState<AdvancedSettings>(DEFAULT_ADVANCED)
  const [aiHistory, setAiHistory] = useState<{ role: "user" | "model"; text: string }[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [sampleMsg, setSampleMsg] = useState("")
  const [recentMsgs, setRecentMsgs] = useState<RecentMsg[]>([])
  const [chartSignals, setChartSignals] = useState<ChartSignal[]>([])
  const [pricePath, setPricePath] = useState<{ t: number; price: number }[]>([])
  const [tEvents, setTEvents] = useState<{ t: number; type: string }[]>([])
  const [simResult, setSimResult] = useState<SimData | null>(null)
  const [simLoading, setSimLoading] = useState(false)
  const [chartPMin, setChartPMin] = useState(0)
  const [chartPMax, setChartPMax] = useState(1)
  // Frozen charts: chart_draw messages that have been completed and should display as static snapshots
  const [frozenCharts, setFrozenCharts] = useState<Set<string>>(new Set())
  const chartSnapshotsRef = useRef<Map<string, { pricePath: { t: number; price: number }[]; simResult: SimData | null }>>(new Map())
  // Track active chart message ID for snapshot storage
  const activeChartIdRef = useRef<string | null>(null)
  // Track last action_buttons message ID so we can disable it when showing new ones
  const lastActionBtnIdRef = useRef<string | null>(null)

  const [resetConfirm, setResetConfirm] = useState(false)

  async function handleReset() {
    const userId = sdata.userId
    setResetConfirm(false)
    if (userId) {
      try { await api.deleteUser(userId) } catch { }
    }
    setMessages([])
    setPhase("phone")
    setFormLoading(false)
    setChatLoading(false)
    setChatInput("")
    setSubmittedForms(new Set())
    setSdata({ phone: "", apiId: "", apiHash: "", loginKey: "", userId: "", groupId: "", groupName: "", mt5Login: "", mt5Password: "", mt5Server: "", mt5AccountName: "", mt5Balance: "", mt5Currency: "" })
    setStrategies({ sizing: "", management: "", deletion: "" })
    setStrategiesReady(false)
    setAdvanced(DEFAULT_ADVANCED)
    setAiHistory([])
    setGroups([])
    setGroupsLoading(false)
    setSampleMsg("")
    setRecentMsgs([])
    setChartSignals([])
    setPricePath([])
    setTEvents([])
    setSimResult(null)
    setSimLoading(false)
    setChartPMin(0)
    setChartPMax(1)
    setFrozenCharts(new Set())
    chartSnapshotsRef.current = new Map()
    activeChartIdRef.current = null
    lastActionBtnIdRef.current = null
  }

  // ── Message helpers ───────────────────────────────────────────────────────

  const noTyping = (msgs: ChatMsg[]) => msgs.filter(m => m.type !== "typing")

  const pushMsg = useCallback((msg: ChatMsg) => {
    setMessages(prev => [...noTyping(prev), msg])
  }, [])

  const showTyping = useCallback(() => {
    setMessages(prev => {
      if (prev.some(m => m.type === "typing")) return prev
      return [...prev, { id: "typing", from: "nova" as const, type: "typing" as const }]
    })
  }, [])

  const novaText = useCallback(async (text: string, delay = 700) => {
    showTyping()
    await new Promise(r => setTimeout(r, delay))
    setMessages(prev => [...noTyping(prev), { id: uid(), from: "nova" as const, type: "text" as const, text }])
  }, [showTyping])

  const novaForm = useCallback(async (type: ChatMsg["type"], extra: Record<string, unknown> = {}, delay = 350) => {
    await new Promise(r => setTimeout(r, delay))
    setMessages(prev => [...noTyping(prev), { id: uid(), from: "nova", type, ...extra } as ChatMsg])
  }, [])

  const showPlanForm = useCallback(async (strats: Strategies, adv: AdvancedSettings) => {
    let notes: PlanNotes | undefined
    try {
      const res = await api.novaChat({
        step: "plan_analysis",
        context: {
          strategies: { sizing: strats.sizing, management: strats.management, deletion: strats.deletion },
          advanced: {
            minConfidence: adv.minConfidence, rangeEntryPct: adv.rangeEntryPct,
            entryIfFavorable: adv.entryIfFavorable, tradingHoursEnabled: adv.tradingHoursEnabled,
            ecoCalendarEnabled: adv.ecoCalendarEnabled, extractionInstructions: adv.extractionInstructions,
          },
        },
      })
      notes = (res as { plan_notes?: PlanNotes }).plan_notes ?? undefined
    } catch { /* non-critical — show form without notes */ }
    setMessages(prev => [...noTyping(prev), { id: uid(), from: "nova", type: "plan_form", notes } as ChatMsg])
  }, [])

  const userMsg = useCallback((text: string) => {
    setMessages(prev => [...noTyping(prev), { id: uid(), from: "user", type: "text", text }])
  }, [])

  // ── Auto-scroll ───────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function boot() {
      await novaText(
        "👋 Hi! I'm **Nova**, your personal setup assistant. I'll guide you through connecting your Telegram signal room to MetaTrader 5 — just a few minutes and you're live.\n\nWhat's your phone number? (include country code, e.g. +39 123 4567890)",
        900
      )
      await novaForm("phone_form", {}, 150)
    }
    boot()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase handlers ────────────────────────────────────────────────────────

  async function handlePhone(rawPhone: string) {
    const phone = normalizePhone(rawPhone)
    setFormLoading(true)
    userMsg(phone)
    try {
      const res = await api.getSession(phone)
      upd({ phone })

      if (res.exists) {
        if (res.setup_complete) {
          await novaText("✅ You're already set up! Taking you to the dashboard…")
          router.push(`/dashboard?phone=${encodeURIComponent(phone)}`)
          return
        }

        // Partial session — restore state and jump to the right step
        const s = res
        upd({
          apiId:    String(s.api_id ?? ""),
          apiHash:  s.api_hash ?? "",
          loginKey: s.login_key ?? "",
          userId:   s.user_id ?? "",
          groupId:  s.group_id ?? "",
          groupName: s.group_name ?? "",
          mt5Login:  String(s.mt5_login ?? ""),
          mt5Server: s.mt5_server ?? "",
        })
        const hasStrategies = !!(s.sizing_strategy || s.management_strategy || s.deletion_strategy)
        const restoredStrats: Strategies = {
          sizing:     s.sizing_strategy     ?? "",
          management: s.management_strategy ?? "",
          deletion:   s.deletion_strategy   ?? "",
        }
        if (hasStrategies) setStrategies(restoredStrats)

        // Restore advanced settings if any were saved
        const hasAdvanced = s.extraction_instructions || s.min_confidence || s.entry_if_favorable
          || s.trading_hours_enabled || s.eco_calendar_enabled || s.range_entry_pct != null
        if (hasAdvanced) {
          setAdvanced({
            extractionInstructions: s.extraction_instructions ?? "",
            minConfidence:          s.min_confidence          ?? 0,
            rangeEntryPct:          s.range_entry_pct         ?? 50,
            entryIfFavorable:       s.entry_if_favorable      ?? false,
            tradingHoursEnabled:    s.trading_hours_enabled   ?? false,
            tradingHoursStart:      s.trading_hours_start     ?? 8,
            tradingHoursEnd:        s.trading_hours_end       ?? 22,
            ecoCalendarEnabled:     s.eco_calendar_enabled    ?? false,
            ecoCalendarWindow:      s.eco_calendar_window     ?? 30,
          })
        }

        if (s.user_id && s.group_id && s.mt5_login) {
          // Telegram ✓ + group ✓ + MT5 ✓
          if (hasStrategies) {
            // Strategies already configured → show summary and let user refine or proceed
            // Seed aiHistory so the AI knows what's already set when the user sends a follow-up
            const historyContext = [
              { role: "model" as const, text: [
                "I have already configured the following trading strategies in a previous session:",
                restoredStrats.sizing     ? `- Sizing:     "${restoredStrats.sizing}"`     : "- Sizing: not configured",
                restoredStrats.management ? `- Management: "${restoredStrats.management}"` : "- Management: not configured",
                restoredStrats.deletion   ? `- Deletion:   "${restoredStrats.deletion}"`   : "- Deletion: not configured (null)",
                "",
                "The user can ask to modify any of these. When outputting the <strategies> block always include all three fields.",
              ].join("\n") }
            ]
            setAiHistory(historyContext)

            await novaText(`Welcome back! 👋 Found your previous session — **${s.group_name}** ✓, MT5 ✓, strategies ✓.`)
            await new Promise(r => setTimeout(r, 300))
            setMessages(prev => [...prev, {
              id: uid(), from: "nova", type: "strategies_summary",
              strategies: restoredStrats,
              advanced: hasAdvanced ? {
                extractionInstructions: s.extraction_instructions ?? "",
                minConfidence:          s.min_confidence          ?? 0,
                rangeEntryPct:          s.range_entry_pct         ?? 50,
                entryIfFavorable:       s.entry_if_favorable      ?? false,
                tradingHoursEnabled:    s.trading_hours_enabled   ?? false,
                tradingHoursStart:      s.trading_hours_start     ?? 8,
                tradingHoursEnd:        s.trading_hours_end       ?? 22,
                ecoCalendarEnabled:     s.eco_calendar_enabled    ?? false,
                ecoCalendarWindow:      s.eco_calendar_window     ?? 30,
              } : undefined,
            } as ChatMsg])
            await novaText(
              "Your strategies are already configured. Want to **refine anything**? Just tell me — or tap **\"Test →\"** to simulate with a signal.",
              500
            )
            setStrategiesReady(true)
            setPhase("ai_rules")
          } else {
            // No strategies yet → ask about manual trading
            await novaText(`Welcome back! 👋 Found your previous session — **${s.group_name}** ✓, MT5 ✓.`)
            await novaText(
              `Now let's configure how the bot actually trades for you. Just to set expectations: this isn't a simple order-executor — it's an AI agent that sizes positions, manages open trades (trailing stops, partial closes, breakeven moves), and handles signal deletions, all following **your** personal rules.\n\n` +
              `Tell me: how do you currently manage trades manually — from how you size them, to what you do while they're open?`,
              800
            )
            setPhase("ai_rules")
          }
        } else if (s.user_id && s.group_id) {
          // Telegram ✓ + group ✓ → MT5
          await novaText(`Welcome back! 👋 **${s.group_name}** is already selected ✓. Now let's connect your MetaTrader 5 account:`)
          await novaForm("mt5_form", {}, 200)
          setPhase("mt5")
        } else if (s.user_id) {
          // Telegram ✓ → group selection
          await novaText("Welcome back! 👋 You're already authenticated. Choose the channel you want to monitor:")
          await novaForm("group_form", {}, 200)
          setPhase("group")
          loadGroups(s.login_key ?? "")
        } else {
          // Have phone (and maybe api_id) but not authenticated → creds
          await novaText("I found a previous session for this number. Let's pick up from the Telegram credentials:")
          await novaForm("creds_form", {}, 200)
          setPhase("creds")
        }
        return
      }

      // New session
      await api.saveSession({ phone })
      await novaText("Got it! To connect your Telegram account securely, I'll need your API credentials. You can find them at **my.telegram.org** → API development tools.")
      await novaForm("creds_form", {}, 250)
      setPhase("creds")
    } catch (ex) {
      await novaText(`Something went wrong: ${ex instanceof ApiError ? ex.message : "Please check your connection and retry."}`)
      await novaForm("phone_form", {}, 200)
    } finally {
      setFormLoading(false)
    }
  }

  async function handleCreds(apiId: string, apiHash: string) {
    setFormLoading(true)
    userMsg(`API ID: ${apiId}  ·  Hash: ${apiHash.slice(0, 8)}…`)
    try {
      const res = await api.requestCode(Number(apiId), apiHash, sdata.phone)
      upd({ apiId, apiHash, loginKey: res.login_key })
      await api.saveSession({ phone: sdata.phone, api_id: Number(apiId), api_hash: apiHash, login_key: res.login_key })
      await novaText("✅ Code sent! Check your Telegram app and enter the code you received:")
      await novaForm("otp_form", {}, 200)
      setPhase("otp")
    } catch (ex) {
      await novaText(`Couldn't send the code: ${ex instanceof ApiError ? ex.message : "Double-check your API ID and Hash."}`)
      await novaForm("creds_form", {}, 200)
    } finally {
      setFormLoading(false)
    }
  }

  async function handleOtp(code: string) {
    setFormLoading(true)
    userMsg(code)
    try {
      const res = await api.verifyCode(sdata.loginKey, code)
      if ("error" in res && res.error === "2fa_required") {
        await novaText("Your account has **two-step verification**. Enter your Telegram cloud password:")
        await novaForm("twofa_form", {}, 200)
        setPhase("twofa")
        return
      }
      const v = res as VerifyCodeResponse
      upd({ userId: v.user_id })
      await api.saveSession({ phone: sdata.phone, user_id: v.user_id })
      await novaText("🎉 Authenticated! Now pick the Telegram channel or group you want to monitor for signals.")
      await novaForm("group_form", {}, 200)
      setPhase("group")
      loadGroups(sdata.loginKey)
    } catch (ex) {
      await novaText(`Invalid code: ${ex instanceof ApiError ? ex.message : "Please try again."}`)
      await novaForm("otp_form", {}, 200)
    } finally {
      setFormLoading(false)
    }
  }

  async function handleTwoFa(pw: string) {
    setFormLoading(true)
    userMsg("••••••")
    try {
      const res = await api.verifyPassword(sdata.loginKey, pw)
      upd({ userId: res.user_id })
      await api.saveSession({ phone: sdata.phone, user_id: res.user_id })
      await novaText("🎉 Authenticated! Pick the signal room you want to monitor:")
      await novaForm("group_form", {}, 200)
      setPhase("group")
      loadGroups(sdata.loginKey)
    } catch (ex) {
      await novaText(`Incorrect password: ${ex instanceof ApiError ? ex.message : "Please try again."}`)
      await novaForm("twofa_form", {}, 200)
    } finally {
      setFormLoading(false)
    }
  }

  async function loadGroups(loginKey: string) {
    setGroupsLoading(true)
    try {
      const res = await api.getGroups(loginKey)
      setGroups(res.groups)
    } catch { setGroups([]) }
    finally { setGroupsLoading(false) }
  }

  async function handleGroupSelect(groupId: string, groupName: string) {
    userMsg(`Signal room: ${groupName}`)
    upd({ groupId, groupName })
    try { await api.saveSession({ phone: sdata.phone, group_id: groupId, group_name: groupName }) } catch { /* ok */ }
    await novaText(`**${groupName}** selected! 👍 Now let's connect your MetaTrader 5 account:`)
    await novaForm("mt5_form", {}, 200)
    setPhase("mt5")
  }

  async function handleMt5(login: string, pw: string, server: string) {
    setFormLoading(true)
    userMsg(`MT5 login ${login} @ ${server}`)
    try {
      const res = await api.verifyMt5(Number(login), pw, server, sdata.phone)
      upd({ mt5Login: login, mt5Password: pw, mt5Server: server, mt5AccountName: res.account.name, mt5Balance: String(res.account.balance), mt5Currency: res.account.currency })
      await api.saveSession({ phone: sdata.phone, mt5_login: Number(login), mt5_password: pw, mt5_server: server })
      await novaText(`Connected ✅ — **${res.account.name}**, balance: ${res.account.balance.toFixed(2)} ${res.account.currency}`)
      await novaText(
        `Before we continue — I want to make sure you know what you're actually configuring here. 🧠\n\n` +
        `This isn't a bot that just opens and closes orders when a signal arrives. It's an **AI agent** that reasons about every trade in real time:\n\n` +
        `• Sizes positions based on your risk rules and the SL distance\n` +
        `• Moves your stop-loss to breakeven or trails it while you're in a trade\n` +
        `• Partially closes at the first target, lets the rest run\n` +
        `• Reacts to signal deletions based on your P&L at that moment\n\n` +
        `All of this happens automatically — following **your** rules.`,
        900
      )
      await novaText(
        `To configure it well, I need to understand how you currently manage trades **manually** — before the bot does it for you.\n\n` +
        `Tell me: when you receive a signal, how do you decide how many lots to open? And once you're in a position — do you actively manage it, or let it ride to SL/TP?`,
        700
      )
      setPhase("ai_rules")
    } catch (ex) {
      await novaText(`Couldn't connect to MT5: ${ex instanceof ApiError ? ex.message : "Check your login, password, and server name."}`)
      await novaForm("mt5_form", {}, 200)
    } finally {
      setFormLoading(false)
    }
  }

  async function handleAiRulesMsg(msg: string) {
    userMsg(msg)
    const newHistory = [...aiHistory, { role: "user" as const, text: msg }]
    setAiHistory(newHistory)
    setChatLoading(true)
    showTyping()
    try {
      const res = await api.novaChat({ step: "ai_rules", history: aiHistory, message: msg })
      const reply = res.reply
      setAiHistory(h => [...h, { role: "model", text: reply }])
      const stratAction = res.actions.find(a => a.type === "set_strategies")
      if (stratAction) {
        const s = stratAction.strategies as { sizing_strategy?: string; management_strategy?: string; deletion_strategy?: string }
        const newStrats: Strategies = {
          sizing: s.sizing_strategy && s.sizing_strategy !== "null" ? s.sizing_strategy : "",
          management: s.management_strategy && s.management_strategy !== "null" ? s.management_strategy : "",
          deletion: s.deletion_strategy && s.deletion_strategy !== "null" ? s.deletion_strategy : "",
        }
        setStrategies(newStrats)
        // Persist immediately so a page reload restores this step
        api.saveSession({
          phone: sdata.phone,
          sizing_strategy: newStrats.sizing || undefined,
          management_strategy: newStrats.management || undefined,
          deletion_strategy: newStrats.deletion || undefined,
        }).catch(() => {/* non-critical */})
        await novaText(reply.replace(/<strategies>[\s\S]*?<\/strategies>/g, "").trim(), 350)
        await new Promise(r => setTimeout(r, 400))
        setMessages(prev => [...noTyping(prev), {
          id: uid(), from: "nova", type: "strategies_summary", strategies: newStrats,
        } as ChatMsg])
        await new Promise(r => setTimeout(r, 500))
        await novaText(
          "These are your trading rules ✅\n\nWant to **refine anything**? Just tell me and I'll adjust them. Or when you're ready, tap **\"Test →\"** to simulate with a real signal from your channel.",
          500
        )
        setStrategiesReady(true)
        // Phase stays "ai_rules" so the chat input remains active
      } else {
        await novaText(reply, 300)
      }
    } catch {
      await novaText("Sorry, I had trouble with that — could you rephrase?", 300)
    } finally {
      setChatLoading(false)
      setChatInput("")
    }
  }

  async function handleProceedToSim() {
    setStrategiesReady(false)
    let msgs: RecentMsg[] = []
    if (sdata.loginKey && sdata.groupId) {
      try {
        const res = await api.getRecentMessages(sdata.loginKey, sdata.groupId, 20)
        msgs = (res.messages ?? []).filter(m => m.text && m.text.trim().length > 0)
      } catch { }
    }
    setRecentMsgs(msgs)
    const hint = msgs.length > 0
      ? "Want to test these strategies? Select a recent message from your channel or paste one manually — I'll simulate how your bot would react:"
      : "Want to test these strategies? Paste a sample signal message from your channel and I'll simulate how your bot would react:"
    await novaText(hint)
    await novaForm("sample_msg_form", {}, 200)
    setPhase("sample_msg")
  }

  async function handleSampleMsg(msg: string) {
    setFormLoading(true)
    userMsg(msg.length > 60 ? msg.slice(0, 60) + "…" : msg)
    try {
      const extracted = await api.simulateSignal({ message: msg })
      setSampleMsg(msg)
      if (!extracted.is_signal || extracted.extracted.length === 0) {
        await novaText("Hmm, that doesn't look like a trading signal. Try a message with a symbol, direction, entry price, SL, and TP.")
        await novaForm("sample_msg_form", {}, 200)
        return
      }

      // Use all extracted signals to compute chart price range
      const allPrices: number[] = []
      const chartSigs: ChartSignal[] = extracted.extracted.map((s: ExtractedSig) => {
        const e = Array.isArray(s.entry_price) ? s.entry_price[0] : s.entry_price
        if (e !== null && e !== undefined) allPrices.push(e)
        if (s.stop_loss !== null) allPrices.push(s.stop_loss)
        if (s.take_profit !== null) allPrices.push(s.take_profit)
        return { entry: e ?? null, sl: s.stop_loss, tp: s.take_profit, order_type: s.order_type }
      })

      let pMn = 0; let pMx = 1
      if (allPrices.length > 0) {
        const minP = Math.min(...allPrices); const maxP = Math.max(...allPrices)
        const range = maxP - minP || Math.abs(minP) * 0.02 || 0.01
        pMn = minP - range * 0.3
        pMx = maxP + range * 0.3
      }
      setChartPMin(pMn); setChartPMax(pMx)
      setChartSignals(chartSigs)
      setPricePath([]); setTEvents([]); setSimResult(null)

      const decs = (pMx - pMn) < 0.005 ? 5 : (pMx - pMn) < 0.05 ? 4 : (pMx - pMn) < 0.5 ? 3 : 2
      const sigLines = extracted.extracted.map((s: ExtractedSig) => {
        const e = Array.isArray(s.entry_price) ? s.entry_price[0] : s.entry_price
        const eStr = e !== null && e !== undefined ? e.toFixed(decs) : "?"
        const slStr = s.stop_loss !== null ? s.stop_loss.toFixed(decs) : "—"
        const tpStr = s.take_profit !== null ? s.take_profit.toFixed(decs) : "—"
        return `**${s.order_type} ${s.symbol}** — Entry: ${eStr}, SL: ${slStr}, TP: ${tpStr}`
      })
      const countLabel = sigLines.length > 1 ? `${sigLines.length} signals detected` : "Signal detected"
      await novaText(
        `${countLabel} ✅\n${sigLines.join("\n")}\n\nDraw a price path on the chart to simulate market movement. The chart shows entry/SL/TP as reference lines.`
      )
      await new Promise(r => setTimeout(r, 200))
      const chartId = uid()
      activeChartIdRef.current = chartId
      setMessages(prev => [...noTyping(prev), {
        id: chartId, from: "nova", type: "chart_draw",
        pMin: pMn, pMax: pMx, signals: chartSigs,
      } as ChatMsg])
      setPhase("chart")
    } catch (ex) {
      await novaText(`Couldn't process the message: ${ex instanceof ApiError ? ex.message : "Please retry."}`)
      await novaForm("sample_msg_form", {}, 200)
    } finally {
      setFormLoading(false)
    }
  }

  async function handleSkipSim() {
    userMsg("Skip simulation")
    await novaText("Got it! Let's pick your plan and get you live:")
    setPhase("plan")
    await showPlanForm(strategies, advanced)
  }

  async function handleRunSim() {
    if (pricePath.length < 2) return
    setSimLoading(true)
    try {
      const res = await api.simulateFull({
        message: sampleMsg,
        sizing_strategy: strategies.sizing || undefined,
        management_strategy: strategies.management || undefined,
        deletion_strategy: strategies.deletion || undefined,
        price_path: pricePath,
        timeline_events: tEvents,
      })
      if (!res.simulation) {
        await novaText("The message doesn't look like a signal — try a different one.")
        return
      }
      setSimResult(res.simulation)
      setPhase("sim_done")
      // Store snapshot for the active chart so it can be frozen later
      if (activeChartIdRef.current) {
        chartSnapshotsRef.current.set(activeChartIdRef.current, {
          pricePath: [...pricePath],
          simResult: res.simulation,
        })
      }
      setTimeout(async () => {
        showTyping()
        try {
          const analysis = await api.novaChat({
            step: "sim_analysis",
            context: {
              sim_result: res.simulation,
              strategies: { sizing: strategies.sizing, management: strategies.management, deletion: strategies.deletion },
              note: "This is a user-drawn simulation — the price path was drawn manually, not real market data.",
            },
          })
          await novaText(analysis.reply, 300)
        } catch { /* silent */ }
        await showNextStepButtons()
      }, 400)
    } catch (ex) {
      await novaText(`Simulation failed: ${ex instanceof ApiError ? ex.message : "Please try again."}`)
    } finally {
      setSimLoading(false)
    }
  }

  async function handleSimDoneMsg(msg: string) {
    userMsg(msg)
    const newHistory = [...aiHistory, { role: "user" as const, text: msg }]
    setAiHistory(newHistory)
    setChatLoading(true)
    showTyping()
    try {
      const res = await api.novaChat({ step: "ai_rules", history: aiHistory, message: msg })
      const reply = res.reply
      setAiHistory(h => [...h, { role: "model", text: reply }])
      const stratAction = res.actions.find(a => a.type === "set_strategies")
      if (stratAction) {
        const s = stratAction.strategies as { sizing_strategy?: string; management_strategy?: string; deletion_strategy?: string }
        const newStrats: Strategies = {
          sizing: s.sizing_strategy && s.sizing_strategy !== "null" ? s.sizing_strategy : "",
          management: s.management_strategy && s.management_strategy !== "null" ? s.management_strategy : "",
          deletion: s.deletion_strategy && s.deletion_strategy !== "null" ? s.deletion_strategy : "",
        }
        setStrategies(newStrats)
        api.saveSession({
          phone: sdata.phone,
          sizing_strategy: newStrats.sizing || undefined,
          management_strategy: newStrats.management || undefined,
          deletion_strategy: newStrats.deletion || undefined,
        }).catch(() => {/* non-critical */})
        await novaText(reply.replace(/<strategies>[\s\S]*?<\/strategies>/g, "").trim(), 350)
        await new Promise(r => setTimeout(r, 400))
        setMessages(prev => [...noTyping(prev), {
          id: uid(), from: "nova", type: "strategies_summary", strategies: newStrats,
        } as ChatMsg])
        // Disable previous action buttons and show the next-step prompt again
        await showNextStepButtons()
      } else {
        await novaText(reply, 300)
      }
    } catch {
      await novaText("Sorry, I had trouble with that — could you rephrase?", 300)
    } finally {
      setChatLoading(false)
      setChatInput("")
    }
  }

  async function showNextStepButtons() {
    await new Promise(r => setTimeout(r, 500))
    await novaText(
      "What would you like to do next? You can **redraw the chart** to try a different scenario, **refine your strategies**, or **proceed** when you're satisfied.",
      400
    )
    // Disable previous action buttons
    if (lastActionBtnIdRef.current) markSubmitted(lastActionBtnIdRef.current)
    const btnId = uid()
    lastActionBtnIdRef.current = btnId
    setMessages(prev => [...noTyping(prev), {
      id: btnId, from: "nova", type: "action_buttons",
      buttons: [
        { label: "↩ Redraw chart", action: "new_simulation" },
        { label: "Proceed to launch →", action: "proceed_from_sim", primary: true },
      ],
    } as ChatMsg])
  }

  async function handleNewSimulation() {
    // Freeze the current chart message (snapshot already stored in handleRunSim)
    if (activeChartIdRef.current) {
      setFrozenCharts(prev => new Set([...prev, activeChartIdRef.current!]))
    }
    // Reset shared chart state for the new canvas
    setPricePath([]); setTEvents([]); setSimResult(null)
    // Add a fresh chart_draw message at the bottom
    await novaText("Let's try another scenario. Draw a new price path on the chart below:", 300)
    const chartId = uid()
    activeChartIdRef.current = chartId
    setMessages(prev => [...noTyping(prev), {
      id: chartId, from: "nova", type: "chart_draw",
      pMin: chartPMin, pMax: chartPMax, signals: chartSignals,
    } as ChatMsg])
    setPhase("chart")
  }

  async function handleProceedFromSim() {
    // Disable the action buttons that triggered this
    if (lastActionBtnIdRef.current) markSubmitted(lastActionBtnIdRef.current)
    await novaText(
      "Almost there! 🎯 Before launching, you can optionally configure some **advanced filters** — trading hours, economic calendar protection, minimum signal confidence, and more. Or skip straight to choosing your plan.",
      500
    )
    setMessages(prev => [...noTyping(prev), { id: uid(), from: "nova", type: "advanced_form" } as ChatMsg])
    setPhase("plan")
  }

  async function handleAdvancedSubmit(vals: AdvancedSettings) {
    setAdvanced(vals)
    // Persist immediately
    api.saveSession({
      phone: sdata.phone,
      extraction_instructions: vals.extractionInstructions || undefined,
      min_confidence: vals.minConfidence || undefined,
      range_entry_pct: vals.rangeEntryPct,
      entry_if_favorable: vals.entryIfFavorable || undefined,
      trading_hours_enabled: vals.tradingHoursEnabled || undefined,
      trading_hours_start: vals.tradingHoursEnabled ? vals.tradingHoursStart : undefined,
      trading_hours_end: vals.tradingHoursEnabled ? vals.tradingHoursEnd : undefined,
      eco_calendar_enabled: vals.ecoCalendarEnabled || undefined,
      eco_calendar_window: vals.ecoCalendarEnabled ? vals.ecoCalendarWindow : undefined,
    }).catch(() => {/* non-critical */})
    await novaText("Advanced settings saved ✅")
    await new Promise(r => setTimeout(r, 300))
    setMessages(prev => [...noTyping(prev), {
      id: uid(), from: "nova", type: "strategies_summary",
      strategies, advanced: vals,
    } as ChatMsg])
    await novaText("Ready to launch? Choose your plan:")
    await showPlanForm(strategies, vals)
  }

  function handleAction(action: string) {
    if (action === "proceed_to_sim") handleProceedToSim()
    else if (action === "new_simulation") handleNewSimulation()
    else if (action === "proceed_from_sim") handleProceedFromSim()
  }

  async function handleTgHelp(msg: string) {
    userMsg(msg)
    setChatLoading(true)
    showTyping()
    try {
      const res = await api.novaChat({ step: "tg_help", message: msg, context: { phone: sdata.phone } })
      await novaText(res.reply, 200)
    } catch {
      await novaText("Not sure — check my.telegram.org for API credentials help.", 200)
    } finally { setChatLoading(false); setChatInput("") }
  }

  async function handleMt5Help(msg: string) {
    userMsg(msg)
    setChatLoading(true)
    showTyping()
    try {
      const res = await api.novaChat({ step: "mt5_help", message: msg })
      await novaText(res.reply, 200)
    } catch {
      await novaText("Not sure — check with your MT5 broker for credentials.", 200)
    } finally { setChatLoading(false); setChatInput("") }
  }

  async function handlePlanSelect(p: "core" | "pro" | "elite") {
    userMsg(`I'll go with the ${p.charAt(0).toUpperCase() + p.slice(1)} plan`)
    await novaText("Almost there! 🔐 Last step: set a password to protect your account.")
    setPhase("password")
    setMessages(prev => [...noTyping(prev), { id: uid(), from: "nova", type: "password_form" } as ChatMsg])
  }

  async function handlePasswordSet(password: string) {
    userMsg("Password set ✓")
    await novaText("Finalizing your setup…")
    setPhase("launching")
    try {
      const { user_id } = await api.completeSetup({
        login_key: sdata.loginKey,
        user_id: sdata.userId,
        api_id: Number(sdata.apiId),
        api_hash: sdata.apiHash,
        phone: sdata.phone,
        group_id: sdata.groupId,
        group_name: sdata.groupName,
        mt5_login: sdata.mt5Login ? Number(sdata.mt5Login) : undefined,
        mt5_password: sdata.mt5Password || undefined,
        mt5_server: sdata.mt5Server || undefined,
        sizing_strategy: strategies.sizing || undefined,
        management_strategy: strategies.management || undefined,
        deletion_strategy: strategies.deletion || undefined,
        extraction_instructions: advanced.extractionInstructions || undefined,
        min_confidence: advanced.minConfidence || undefined,
        range_entry_pct: advanced.rangeEntryPct,
        entry_if_favorable: advanced.entryIfFavorable || undefined,
        trading_hours_enabled: advanced.tradingHoursEnabled || undefined,
        trading_hours_start: advanced.tradingHoursEnabled ? advanced.tradingHoursStart : undefined,
        trading_hours_end: advanced.tradingHoursEnabled ? advanced.tradingHoursEnd : undefined,
        eco_calendar_enabled: advanced.ecoCalendarEnabled || undefined,
        eco_calendar_window: advanced.ecoCalendarEnabled ? advanced.ecoCalendarWindow : undefined,
      })
      await api.setPassword(sdata.phone, password, user_id)
      await novaText("🎉 **Your bot is live!** Redirecting you to the dashboard…")
      setPhase("done")
      setTimeout(() => router.push("/dashboard"), 2000)
    } catch (ex) {
      setPhase("password")
      await novaText(`Setup failed: ${ex instanceof ApiError ? ex.message : "Please try again."}`)
      setMessages(prev => [...noTyping(prev), { id: uid(), from: "nova", type: "password_form" } as ChatMsg])
    }
  }

  // ── Chat submit ───────────────────────────────────────────────────────────

  function handleChatSubmit() {
    const msg = chatInput.trim()
    if (!msg || chatLoading) return
    if (phase === "ai_rules") { handleAiRulesMsg(msg); return }
    if (phase === "sim_done") { handleSimDoneMsg(msg); return }
    if (phase === "creds") { handleTgHelp(msg); return }
    if (phase === "mt5") { handleMt5Help(msg); return }
  }

  // ── Render messages ───────────────────────────────────────────────────────

  function renderMsg(msg: ChatMsg) {
    const key = msg.id
    const done = submittedForms.has(key)

    if (msg.type === "typing") return <NovaBubble key={key}><TypingDots /></NovaBubble>

    if (msg.from === "user") return <UserBubble key={key} text={(msg as { text: string }).text} />

    if (msg.type === "text") {
      return <NovaBubble key={key}><span>{parseMarkdown(msg.text)}</span></NovaBubble>
    }

    if (msg.type === "phone_form")
      return (
        <NovaBubble key={key}>
          {done ? <CompletedBadge /> : <PhoneForm onSubmit={p => { markSubmitted(key); handlePhone(p) }} loading={formLoading} />}
        </NovaBubble>
      )

    if (msg.type === "creds_form")
      return (
        <NovaBubble key={key}>
          {done ? <CompletedBadge /> : <CredsForm onSubmit={(i, h) => { markSubmitted(key); handleCreds(i, h) }} loading={formLoading} />}
        </NovaBubble>
      )

    if (msg.type === "otp_form")
      return (
        <NovaBubble key={key}>
          {done ? <CompletedBadge /> : <OtpForm onSubmit={c => { markSubmitted(key); handleOtp(c) }} loading={formLoading} />}
        </NovaBubble>
      )

    if (msg.type === "twofa_form")
      return (
        <NovaBubble key={key}>
          {done ? <CompletedBadge /> : <TwoFaForm onSubmit={pw => { markSubmitted(key); handleTwoFa(pw) }} loading={formLoading} />}
        </NovaBubble>
      )

    if (msg.type === "group_form")
      return (
        <NovaBubble key={key}>
          {done
            ? <CompletedBadge />
            : <GroupForm groups={groups} loadingGroups={groupsLoading} onSelect={(id, name) => { markSubmitted(key); handleGroupSelect(id, name) }} />
          }
        </NovaBubble>
      )

    if (msg.type === "mt5_form")
      return (
        <NovaBubble key={key}>
          {done
            ? <CompletedBadge />
            : <MT5Form
                onSubmit={(l, pw, s) => { markSubmitted(key); handleMt5(l, pw, s) }}
                loading={formLoading}
              />
          }
        </NovaBubble>
      )

    if (msg.type === "sample_msg_form")
      return (
        <NovaBubble key={key}>
          {done
            ? <CompletedBadge />
            : <SampleMsgForm
                onSubmit={m => { markSubmitted(key); handleSampleMsg(m) }}
                onSkip={() => { markSubmitted(key); handleSkipSim() }}
                loading={formLoading}
                recentMsgs={recentMsgs}
              />
          }
        </NovaBubble>
      )

    if (msg.type === "chart_draw") {
      const chartMsg = msg as { id: string; from: "nova"; type: "chart_draw"; pMin: number; pMax: number; signals: ChartSignal[] }
      if (frozenCharts.has(key)) {
        const snap = chartSnapshotsRef.current.get(key)
        return (
          <NovaBubble key={key}>
            <FrozenChart
              pricePath={snap?.pricePath ?? []}
              simResult={snap?.simResult ?? null}
              pMin={chartMsg.pMin}
              pMax={chartMsg.pMax}
            />
          </NovaBubble>
        )
      }
      return (
        <NovaBubble key={key}>
          <InlineChart
            pricePath={pricePath}
            setPricePath={setPricePath}
            tEvents={tEvents}
            setTEvents={setTEvents}
            simResult={simResult}
            onRunSim={handleRunSim}
            simLoading={simLoading}
            initPMin={chartMsg.pMin}
            initPMax={chartMsg.pMax}
            signals={chartMsg.signals ?? []}
          />
        </NovaBubble>
      )
    }

    if (msg.type === "strategies_summary") {
      const m = msg as { id: string; from: "nova"; type: "strategies_summary"; strategies: Strategies; advanced?: AdvancedSettings }
      return <NovaBubble key={key}><StrategiesSummary strategies={m.strategies} advanced={m.advanced} /></NovaBubble>
    }

    if (msg.type === "advanced_form") {
      return (
        <NovaBubble key={key}>
          {done
            ? <CompletedBadge />
            : <AdvancedForm
                initialValues={advanced}
                onSubmit={v => { markSubmitted(key); handleAdvancedSubmit(v) }}
                onSkip={() => {
                  markSubmitted(key)
                  novaText("Got it! Choose your plan:").then(() => showPlanForm(strategies, advanced))
                }}
              />
          }
        </NovaBubble>
      )
    }

    if (msg.type === "action_buttons") {
      const m = msg as { id: string; from: "nova"; type: "action_buttons"; buttons: { label: string; action: string; primary?: boolean }[] }
      return (
        <NovaBubble key={key}>
          {done
            ? <CompletedBadge />
            : (
              <div className="flex gap-2 flex-wrap">
                {m.buttons.map(btn => btn.primary
                  ? <PrimaryBtn key={btn.action} onClick={() => { markSubmitted(key); handleAction(btn.action) }}>{btn.label}</PrimaryBtn>
                  : <GhostBtn key={btn.action} onClick={() => { markSubmitted(key); handleAction(btn.action) }}>{btn.label}</GhostBtn>
                )}
              </div>
            )
          }
        </NovaBubble>
      )
    }

    if (msg.type === "plan_form")
      return (
        <NovaBubble key={key}>
          {done ? <CompletedBadge /> : <PlanForm notes={msg.notes} strategies={strategies} advanced={advanced} onSelect={p => { markSubmitted(key); handlePlanSelect(p) }} />}
        </NovaBubble>
      )

    if (msg.type === "password_form")
      return (
        <NovaBubble key={key}>
          {done ? <CompletedBadge /> : <PasswordForm loading={formLoading} onSubmit={pw => { markSubmitted(key); handlePasswordSet(pw) }} />}
        </NovaBubble>
      )

    return null
  }

  // ── Bottom input ──────────────────────────────────────────────────────────

  const showInput = ["creds", "mt5", "ai_rules", "sim_done"].includes(phase)
  const inputPlaceholder =
    phase === "ai_rules" ? "Refine your strategies or ask anything…" :
    phase === "sim_done" ? "Ask Nova to adjust your strategies…" :
    phase === "creds"    ? "Ask about Telegram API credentials…" :
    phase === "mt5"      ? "Ask about MT5 credentials…" : ""

  return (
    <>
      <style>{`@keyframes nova-bounce { 0%,100%{transform:translateY(0);opacity:.4} 50%{transform:translateY(-4px);opacity:1} }`}</style>

      {resetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[#0e1117] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <p className="font-semibold text-white text-base">Restart setup?</p>
            <p className="text-sm text-white/50 leading-relaxed">
              All your configuration will be deleted and you'll start over from the beginning. This cannot be undone.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleReset}
                className="flex-1 py-2 rounded-xl text-sm font-semibold bg-red-500/14 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Yes, restart
              </button>
              <button
                onClick={() => setResetConfirm(false)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold bg-white/[0.04] border border-white/10 text-white/60 hover:text-white hover:bg-white/[0.07] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col h-full" style={{ minHeight: 480 }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-black font-bold shadow-[0_0_14px_rgba(0,232,135,0.28)]">N</div>
          <div className="flex-1">
            <p className="font-semibold text-white text-sm">Nova</p>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-[11px] text-emerald-400/65">Setup assistant · online</p>
            </div>
          </div>
          {phase !== "phone" && (
            <button
              onClick={() => setResetConfirm(true)}
              title="Restart setup"
              className="flex items-center gap-1.5 text-[11px] text-white/25 hover:text-white/50 transition-colors px-2 py-1 rounded-lg hover:bg-white/[0.04]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Restart
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 min-h-0">
          {messages.map(m => renderMsg(m))}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        {showInput && (
          <div className="shrink-0 border-t border-white/[0.06] px-4 py-3 space-y-2">
            {/* Contextual action buttons above the input */}
            {phase === "ai_rules" && strategiesReady && (
              <div className="flex justify-end">
                <PrimaryBtn onClick={handleProceedToSim} className="text-xs py-1.5 px-4">
                  Test strategies →
                </PrimaryBtn>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-400/28 transition-all"
                placeholder={inputPlaceholder}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleChatSubmit()}
                disabled={chatLoading}
              />
              <button
                onClick={handleChatSubmit}
                disabled={!chatInput.trim() || chatLoading}
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-black disabled:opacity-28 transition-all hover:shadow-[0_0_14px_rgba(0,232,135,0.38)]"
              >
                {chatLoading
                  ? <Spin />
                  : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
