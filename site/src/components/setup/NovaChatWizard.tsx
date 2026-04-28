"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { api, ApiError, type Group, type VerifyCodeResponse } from "@/src/lib/api"

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | "phone" | "session_found" | "creds" | "otp" | "twofa"
  | "group" | "mt5" | "ai_rules" | "sample_msg" | "chart"
  | "simulating" | "sim_done" | "plan" | "launching" | "done"

interface SData {
  phone: string; apiId: string; apiHash: string; loginKey: string
  userId: string; groupId: string; groupName: string
  mt5Login: string; mt5Password: string; mt5Server: string
  mt5AccountName: string; mt5Balance: string; mt5Currency: string
}

interface Strategies { sizing: string; management: string; deletion: string }

interface PtEvent {
  t: number; type: string; price: number; pnl?: number; description: string
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
  | { id: string; from: "nova"; type: "chart_draw"; pMin: number; pMax: number }
  | { id: string; from: "nova"; type: "sim_result"; result: SimData }
  | { id: string; from: "nova"; type: "plan_form" }
  | { id: string; from: "nova"; type: "strategies_summary"; strategies: Strategies }

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

function SampleMsgForm({ onSubmit, onSkip, loading }: { onSubmit: (m: string) => void; onSkip: () => void; loading: boolean }) {
  const [val, setVal] = useState("")
  return (
    <div className="space-y-3 min-w-72 max-w-sm">
      <textarea
        className={inp + " resize-none h-28"}
        placeholder={"e.g.\nBUY EURUSD\nEntry: 1.0850\nSL: 1.0820\nTP: 1.0910"}
        value={val}
        onChange={e => setVal(e.target.value)}
      />
      <div className="flex gap-2">
        <PrimaryBtn onClick={() => onSubmit(val.trim())} disabled={!val.trim()} loading={loading} className="flex-1">
          Use this message →
        </PrimaryBtn>
        <GhostBtn onClick={onSkip}>Skip simulation</GhostBtn>
      </div>
    </div>
  )
}

function StrategiesSummary({ strategies }: { strategies: Strategies }) {
  const items = [
    { label: "Position sizing", value: strategies.sizing, icon: "⚖️" },
    { label: "Trade management", value: strategies.management, icon: "🛡️" },
    { label: "Signal deletion", value: strategies.deletion, icon: "🗑️" },
  ].filter(it => it.value && it.value !== "null")
  if (items.length === 0) return null
  return (
    <div className="space-y-2 min-w-60 max-w-sm">
      <p className="text-[11px] text-white/38 font-semibold uppercase tracking-wider">Configured strategies</p>
      {items.map(it => (
        <div key={it.label} className="flex gap-2.5 bg-emerald-500/[0.06] border border-emerald-500/14 rounded-xl px-3 py-2.5">
          <span>{it.icon}</span>
          <div>
            <p className="text-[11px] text-emerald-400/65 font-semibold">{it.label}</p>
            <p className="text-sm text-white/78 leading-snug">{it.value}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Inline Chart ──────────────────────────────────────────────────────────────

const EVT_COLORS: Record<string, string> = {
  entry: "#34d399", sl: "#f87171", tp: "#60a5fa",
  close: "#c084fc", expired: "#facc15", signal_deleted: "#fb923c",
}
const CHART_H = 230

function InlineChart({
  pricePath, setPricePath, tEvents, setTEvents, simResult, onRunSim, simLoading,
  initPMin, initPMax,
}: {
  pricePath: { t: number; price: number }[]
  setPricePath: (v: { t: number; price: number }[]) => void
  tEvents: { t: number; type: string }[]
  setTEvents: (v: { t: number; type: string }[]) => void
  simResult: SimData | null
  onRunSim: () => void
  simLoading: boolean
  initPMin: number; initPMax: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [rawPath, setRawPath] = useState<{ t: number; price: number }[]>([])
  const [deletionMode, setDeletionMode] = useState(false)
  const [pMinStr, setPMinStr] = useState(String(initPMin))
  const [pMaxStr, setPMaxStr] = useState(String(initPMax))

  const pMin = parseFloat(pMinStr) || 0
  const pMax = parseFloat(pMaxStr) || 1
  const validRange = pMin < pMax

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
    if (pricePath.length > 0) return   // already drawn; must clear first
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
      if (x < last.t + 0.002) return prev   // enforce left-to-right
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
    // Recalculate pMin/pMax from drawn data with margin
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

  const tToX = (t: number) => `${(t * 100).toFixed(2)}%`
  const pToY = (p: number) => pMax === pMin ? "50%" : `${((1 - (p - pMin) / (pMax - pMin)) * 100).toFixed(2)}%`

  const displayPath = pricePath.length >= 2 ? pricePath : rawPath
  const pathD = displayPath.length >= 2
    ? displayPath.map((p, i) => `${i === 0 ? "M" : "L"} ${tToX(p.t)} ${pToY(p.price)}`).join(" ")
    : ""
  const closedD = pathD
    ? pathD + ` L ${tToX(displayPath[displayPath.length - 1].t)} 100% L 0 100% Z`
    : ""

  const simEvents = simResult?.per_signal?.flatMap(s => s.events) ?? []
  const hasPath = pricePath.length >= 2

  // Y-axis labels (3 levels)
  const yLabels = [0, 0.5, 1].map(f => ({
    y: f,
    price: pMin + (1 - f) * (pMax - pMin),
  }))
  const priceRange = pMax - pMin
  const priceDecs = priceRange < 0.005 ? 5 : priceRange < 0.05 ? 4 : priceRange < 0.5 ? 3 : priceRange < 5 ? 2 : 1

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
          validRange && !hasPath ? "cursor-crosshair border-emerald-400/20" : "border-white/10"
        } bg-black/40`}
        style={{ height: CHART_H }}
      >
        <svg
          ref={svgRef}
          className="absolute inset-0 w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(v => (
            <g key={v}>
              <line x1="0" y1={`${v * 100}%`} x2="100%" y2={`${v * 100}%`} stroke="white" strokeOpacity="0.04" />
              <line x1={`${v * 100}%`} y1="0" x2={`${v * 100}%`} y2="100%" stroke="white" strokeOpacity="0.04" />
            </g>
          ))}

          {/* Y-axis labels */}
          {hasPath && yLabels.map(({ y, price }) => (
            <text key={y} x="4" y={`${y * 100}%`} dy="4" fill="white" fillOpacity="0.28" fontSize="9" fontFamily="monospace">
              {price.toFixed(priceDecs)}
            </text>
          ))}

          {/* Area fill */}
          {closedD && (
            <>
              <defs>
                <linearGradient id="pgrd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={closedD} fill="url(#pgrd)" />
            </>
          )}

          {/* Path line */}
          {pathD && (
            <path d={pathD} fill="none" stroke="#34d399" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* Sim event markers */}
          {hasPath && simEvents.map((ev, i) => {
            const col = EVT_COLORS[ev.type] ?? "#94a3b8"
            return (
              <g key={i}>
                <circle cx={tToX(ev.t)} cy={pToY(ev.price)} r="5" fill={col} fillOpacity="0.92" stroke="#000" strokeWidth="1.5" />
              </g>
            )
          })}

          {/* Deletion event marker */}
          {hasPath && tEvents.map((ev, i) => (
            <g key={i}>
              <line x1={tToX(ev.t)} y1="0" x2={tToX(ev.t)} y2="100%" stroke={EVT_COLORS.signal_deleted} strokeWidth="1.5" strokeDasharray="4 3" strokeOpacity="0.75" />
              <text x={tToX(ev.t)} y="12" fill={EVT_COLORS.signal_deleted} fontSize="9" textAnchor="middle" fontFamily="monospace">DEL</text>
            </g>
          ))}

          {/* Empty hint */}
          {!pathD && !drawing && (
            <text x="50%" y="50%" dy="5" textAnchor="middle" fill="white" fillOpacity="0.18" fontSize="13" fontFamily="sans-serif">
              {validRange ? "Click and drag to draw a price path" : "Set the price range above first"}
            </text>
          )}
        </svg>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {hasPath && (
          <>
            <button
              onClick={() => setDeletionMode(v => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                deletionMode
                  ? "bg-orange-500/18 border-orange-500/38 text-orange-400"
                  : "border-white/10 text-white/38 hover:border-white/20 hover:text-white/60"
              }`}
            >
              {deletionMode ? "Click on chart to mark deletion" : "+ Mark deletion event"}
            </button>
            {tEvents.length > 0 && (
              <button onClick={() => setTEvents([])} className="text-xs px-2 py-1.5 rounded-lg border border-white/10 text-white/28 hover:text-white/50 transition-all">
                ✕ Remove
              </button>
            )}
          </>
        )}
        <GhostBtn onClick={clear} className="text-xs py-1.5 px-3">Clear</GhostBtn>
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
        <div key={i} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sig.order_type === "BUY" ? "bg-emerald-500/14 text-emerald-400" : "bg-red-500/14 text-red-400"}`}>
              {sig.order_type}
            </span>
            <span className="text-xs text-white/55">{sig.symbol}</span>
            <span className={`ml-auto text-xs font-semibold ${
              sig.state === "tp" ? "text-blue-400" : sig.state === "sl" ? "text-red-400" :
              sig.state === "expired" ? "text-yellow-400" : sig.state === "open" ? "text-emerald-400/60" : "text-white/38"
            }`}>{sig.state.toUpperCase()}</span>
          </div>
          {sig.events.map((ev, j) => {
            const col = EVT_COLORS[ev.type] ?? "#94a3b8"
            return (
              <div key={j} className="flex items-center gap-2 text-[11px] text-white/45">
                <span style={{ color: col }} className="font-semibold uppercase w-16 shrink-0">{ev.type}</span>
                <span className="font-mono">{ev.price.toFixed(5)}</span>
                {ev.pnl !== undefined && (
                  <span className={`ml-auto font-semibold ${ev.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {ev.pnl >= 0 ? "+" : ""}{ev.pnl.toFixed(2)}
                  </span>
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

function PlanForm({ onSelect }: { onSelect: (plan: "core" | "pro" | "elite") => void }) {
  const [sel, setSel] = useState<"core" | "pro" | "elite" | null>(null)
  return (
    <div className="space-y-2.5 min-w-72 max-w-sm">
      {PLANS.map(p => (
        <button
          key={p.id}
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
      ))}
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
  const [aiHistory, setAiHistory] = useState<{ role: "user" | "model"; text: string }[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [sampleMsg, setSampleMsg] = useState("")
  const [pricePath, setPricePath] = useState<{ t: number; price: number }[]>([])
  const [tEvents, setTEvents] = useState<{ t: number; type: string }[]>([])
  const [simResult, setSimResult] = useState<SimData | null>(null)
  const [simLoading, setSimLoading] = useState(false)
  const [chartPMin, setChartPMin] = useState(0)
  const [chartPMax, setChartPMax] = useState(1)

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

  async function handlePhone(phone: string) {
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
        if (s.sizing_strategy || s.management_strategy || s.deletion_strategy) {
          setStrategies({
            sizing:     s.sizing_strategy     ?? "",
            management: s.management_strategy ?? "",
            deletion:   s.deletion_strategy   ?? "",
          })
        }

        if (s.user_id && s.group_id && s.mt5_login) {
          // Telegram ✓ + group ✓ + MT5 ✓ → AI rules
          await novaText(
            `Welcome back! 👋 I found your previous session — **${s.group_name}** ✓, MT5 ✓.\n\nLet's configure your trading rules. **How do you want the bot to size your positions?**`
          )
          setPhase("ai_rules")
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
      await novaText(`Connected ✅ — **${res.account.name}**, balance: ${res.account.balance.toFixed(2)} ${res.account.currency}\n\nNow let's set up your trading rules. Tell me — **how do you want the bot to size your positions?** (e.g. fixed 0.01 lots, 1% of balance, risk-based)`)
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
        await novaText(reply.replace(/<strategies>[\s\S]*?<\/strategies>/g, "").trim(), 350)
        await new Promise(r => setTimeout(r, 400))
        setMessages(prev => [...noTyping(prev), {
          id: uid(), from: "nova", type: "strategies_summary", strategies: newStrats,
        } as ChatMsg])
        await new Promise(r => setTimeout(r, 700))
        await novaText("Want to test these strategies? Paste a sample signal message from your channel and I'll simulate how your bot would react:")
        await novaForm("sample_msg_form", {}, 200)
        setPhase("sample_msg")
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

  async function handleSampleMsg(msg: string) {
    setFormLoading(true)
    userMsg(msg.length > 60 ? msg.slice(0, 60) + "…" : msg)
    try {
      // Extract signal to get price context for the chart
      const extracted = await api.simulateSignal({ message: msg })
      setSampleMsg(msg)
      if (!extracted.is_signal || extracted.extracted.length === 0) {
        await novaText("Hmm, that doesn't look like a trading signal. Try a message with a symbol, direction, entry price, SL, and TP.")
        await novaForm("sample_msg_form", {}, 200)
        return
      }
      const sig = extracted.extracted[0]
      const entry = Array.isArray(sig.entry_price) ? sig.entry_price[0] : sig.entry_price
      const sl = sig.stop_loss; const tp = sig.take_profit
      const prices = [entry, sl, tp].filter((v): v is number => v !== null && v !== undefined)
      let pMn = 0; let pMx = 1
      if (prices.length > 0) {
        const minP = Math.min(...prices); const maxP = Math.max(...prices)
        const range = maxP - minP || Math.abs(minP) * 0.02 || 0.01
        pMn = minP - range * 0.4
        pMx = maxP + range * 0.4
      }
      setChartPMin(pMn); setChartPMax(pMx)
      setPricePath([]); setTEvents([]); setSimResult(null)

      const decs = (pMx - pMn) < 0.005 ? 5 : (pMx - pMn) < 0.05 ? 4 : (pMx - pMn) < 0.5 ? 3 : 2
      const entryStr = entry !== null && entry !== undefined ? entry.toFixed(decs) : "?"
      const slStr = sl !== null ? sl.toFixed(decs) : "none"
      const tpStr = tp !== null ? tp.toFixed(decs) : "none"
      await novaText(
        `Signal detected ✅  **${sig.order_type} ${sig.symbol}** — Entry: ${entryStr}, SL: ${slStr}, TP: ${tpStr}\n\nNow draw a price path on the chart to simulate market movement. The chart is pre-scaled to the signal's price range.`
      )
      await novaForm("chart_draw", { pMin: pMn, pMax: pMx }, 200)
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
    await novaForm("plan_form", {}, 200)
    setPhase("plan")
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
      // AI analysis
      setTimeout(async () => {
        showTyping()
        try {
          const analysis = await api.novaChat({
            step: "sim_analysis",
            context: {
              sim_result: res.simulation,
              strategies: { sizing: strategies.sizing, management: strategies.management, deletion: strategies.deletion },
            },
          })
          await novaText(analysis.reply, 300)
        } catch { /* silent */ }
        await new Promise(r => setTimeout(r, 600))
        await novaText("Ready to launch? Choose your plan:")
        await novaForm("plan_form", {}, 200)
        setPhase("plan")
      }, 400)
    } catch (ex) {
      await novaText(`Simulation failed: ${ex instanceof ApiError ? ex.message : "Please try again."}`)
    } finally {
      setSimLoading(false)
    }
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
    await novaText("Almost done — finalizing your setup…")
    setPhase("launching")
    try {
      await api.completeSetup({
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
      })
      await novaText("🎉 **Your bot is live!** Redirecting you to the dashboard…")
      setPhase("done")
      setTimeout(() => router.push(`/dashboard?phone=${encodeURIComponent(sdata.phone)}`), 2000)
    } catch (ex) {
      setPhase("plan")
      await novaText(`Setup failed: ${ex instanceof ApiError ? ex.message : "Please try again."}`)
      await novaForm("plan_form", {}, 200)
    }
  }

  // ── Chat submit ───────────────────────────────────────────────────────────

  function handleChatSubmit() {
    const msg = chatInput.trim()
    if (!msg || chatLoading) return
    if (phase === "ai_rules") { handleAiRulesMsg(msg); return }
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
              />
          }
        </NovaBubble>
      )

    if (msg.type === "chart_draw") {
      const chartMsg = msg as { id: string; from: "nova"; type: "chart_draw"; pMin: number; pMax: number }
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
          />
        </NovaBubble>
      )
    }

    if (msg.type === "strategies_summary") {
      const m = msg as { id: string; from: "nova"; type: "strategies_summary"; strategies: Strategies }
      return <NovaBubble key={key}><StrategiesSummary strategies={m.strategies} /></NovaBubble>
    }

    if (msg.type === "plan_form")
      return (
        <NovaBubble key={key}>
          {done ? <CompletedBadge /> : <PlanForm onSelect={p => { markSubmitted(key); handlePlanSelect(p) }} />}
        </NovaBubble>
      )

    return null
  }

  // ── Bottom input ──────────────────────────────────────────────────────────

  const showInput = ["creds", "mt5", "ai_rules"].includes(phase)
  const inputPlaceholder =
    phase === "ai_rules" ? "Tell Nova about your trading preferences…" :
    phase === "creds"    ? "Ask about Telegram API credentials…" :
    phase === "mt5"      ? "Ask about MT5 credentials…" : ""

  return (
    <>
      <style>{`@keyframes nova-bounce { 0%,100%{transform:translateY(0);opacity:.4} 50%{transform:translateY(-4px);opacity:1} }`}</style>

      <div className="flex flex-col h-full" style={{ minHeight: 480 }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-black font-bold shadow-[0_0_14px_rgba(0,232,135,0.28)]">N</div>
          <div>
            <p className="font-semibold text-white text-sm">Nova</p>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-[11px] text-emerald-400/65">Setup assistant · online</p>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 min-h-0">
          {messages.map(m => renderMsg(m))}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        {showInput && (
          <div className="shrink-0 border-t border-white/[0.06] px-4 py-3">
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
