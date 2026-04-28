"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { api, ApiError, type SetupSession, type Group, type MT5Account, type VerifyCodeResponse } from "@/src/lib/api"
import NovaChatWizard from "./NovaChatWizard"

// ─── Shared primitives ────────────────────────────────────────────────────────

function GradientText({ children }: { children: React.ReactNode }) {
  return <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">{children}</span>
}

function Spin() {
  return (
    <svg className="w-4 h-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-red-500/8 border border-red-500/20 px-4 py-3">
      <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="text-sm text-red-300 leading-relaxed">{msg}</p>
    </div>
  )
}

// ─── Plan helpers ─────────────────────────────────────────────────────────────

const PLAN_ORDER: PlanId[] = ["core", "pro", "elite"]

const FIELD_PLAN_MAP: { field: keyof SetupData; label: string; minPlan: PlanId; isSet?: (d: SetupData) => boolean }[] = [
  { field: "minConfidence",          label: "AI confidence threshold",      minPlan: "pro",   isSet: d => Number(d.minConfidence) > 0 },
  { field: "managementStrategy",     label: "Position management",          minPlan: "elite" },
  { field: "deletionStrategy",       label: "Signal deletion handling",     minPlan: "elite" },
  { field: "tradingHoursEnabled",    label: "Trading hours filter",         minPlan: "elite", isSet: d => d.tradingHoursEnabled },
  { field: "ecoCalendarEnabled",     label: "Economic calendar filter",     minPlan: "elite", isSet: d => d.ecoCalendarEnabled },
  { field: "communityVisible",       label: "Community room visibility",    minPlan: "elite", isSet: d => d.communityVisible },
]

function getMinPlan(data: SetupData): PlanId {
  const check = (f: typeof FIELD_PLAN_MAP[0]) =>
    f.isSet ? f.isSet(data) : !!(data[f.field] as string)?.trim?.()
  if (FIELD_PLAN_MAP.filter(f => f.minPlan === "elite").some(check)) return "elite"
  if (FIELD_PLAN_MAP.filter(f => f.minPlan === "pro").some(check)) return "pro"
  return "core"
}

function getAffectedFields(plan: PlanId, data: SetupData) {
  const planIdx = PLAN_ORDER.indexOf(plan)
  return FIELD_PLAN_MAP.filter(f => {
    if (PLAN_ORDER.indexOf(f.minPlan) <= planIdx) return false
    return f.isSet ? f.isSet(data) : !!(data[f.field] as string)?.trim?.()
  })
}

function PlanBadge({ plan }: { plan: PlanId }) {
  const styles: Record<PlanId, string> = {
    core:  "bg-white/[0.05] text-white/40 border-white/10",
    pro:   "bg-emerald-500/[0.08] text-emerald-400/90 border-emerald-500/20",
    elite: "bg-amber-500/[0.08] text-amber-400/90 border-amber-500/20",
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-widest ${styles[plan]}`}>
      {plan}
    </span>
  )
}

function PrimaryBtn({ onClick, disabled, loading = false, children, className = "" }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode; className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-400 to-cyan-400 text-black font-bold rounded-xl py-3.5 px-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,232,135,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none ${className}`}
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
      className={`flex items-center justify-center gap-2 border border-white/12 text-white/55 font-medium rounded-xl py-3.5 px-6 transition-all hover:border-white/25 hover:text-white hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  )
}

const card = "bg-white/[0.03] border border-white/10 backdrop-blur-md rounded-2xl"
const inp  = "w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-emerald-400/40 focus:bg-white/[0.06] transition-all"
const lbl  = "block text-xs font-semibold text-white/45 uppercase tracking-wider mb-2"

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ["Telegram", "MT5", "AI Rules", "Payment", "Launch"]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center mb-8">
      {STEP_LABELS.map((label, i) => {
        const done   = i < current
        const active = i === current
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                done   ? "bg-gradient-to-br from-emerald-400 to-cyan-400 text-black shadow-[0_0_14px_rgba(0,232,135,0.35)]"
                : active ? "bg-white/[0.05] border-2 border-emerald-400 text-emerald-400"
                :          "bg-white/[0.03] border border-white/10 text-white/20"
              }`}>
                {done
                  ? <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                  : i + 1}
              </div>
              <span className={`text-[9px] font-semibold whitespace-nowrap transition-colors ${
                active ? "text-emerald-400" : done ? "text-white/40" : "text-white/18"
              }`}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`h-px w-5 sm:w-7 mx-1 mb-5 rounded-full transition-all duration-500 ${
                i < current ? "bg-gradient-to-r from-emerald-400 to-cyan-400" : "bg-white/8"
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Data & step props ────────────────────────────────────────────────────────

export type PlanId = "core" | "pro" | "elite"

export interface SetupData {
  plan: PlanId | ""
  phone: string
  apiId: string
  apiHash: string
  loginKey: string
  code: string
  userId: string
  groupId: string
  groupName: string
  mt5Login: string
  mt5Password: string
  mt5Server: string
  mt5AccountName: string
  mt5Balance: string
  mt5Currency: string
  sizingStrategy: string
  extractionInstructions: string
  managementStrategy: string
  deletionStrategy: string
  rangeEntryPct: string
  entryIfFavorable: boolean
  minConfidence: string
  tradingHoursEnabled: boolean
  tradingHoursStart: string
  tradingHoursEnd: string
  tradingHoursDays: string[]
  ecoCalendarEnabled: boolean
  ecoCalendarWindow: string
  ecoCalendarStrategy: string
  communityVisible: boolean
}

const EMPTY: SetupData = {
  plan: "", phone: "", apiId: "", apiHash: "", loginKey: "", code: "",
  userId: "", groupId: "", groupName: "", mt5Login: "", mt5Password: "",
  mt5Server: "", mt5AccountName: "", mt5Balance: "", mt5Currency: "", sizingStrategy: "",
  extractionInstructions: "", managementStrategy: "", deletionStrategy: "",
  rangeEntryPct: "50", entryIfFavorable: false,
  minConfidence: "0",
  tradingHoursEnabled: false, tradingHoursStart: "8", tradingHoursEnd: "22",
  tradingHoursDays: ["MON","TUE","WED","THU","FRI"],
  ecoCalendarEnabled: false, ecoCalendarWindow: "30", ecoCalendarStrategy: "",
  communityVisible: false,
}

interface StepProps {
  data: SetupData
  update: (p: Partial<SetupData>) => void
  onNext: () => void
  onBack: () => void
  jumpTo?: (step: number) => void
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 0 — Plan selection
// ════════════════════════════════════════════════════════════════════════════════

const PLANS = [
  {
    id: "core" as PlanId,
    name: "Core",
    price: "€79",
    tagline: "Get started with signal automation right away.",
    labelColor: "text-white/45",
    borderSel: "border-white/25",
    checkColor: "text-emerald-400",
    bgSel: "bg-white/[0.04]",
    features: ["1 Telegram signal room", "Instant order execution", "Automatic SL & TP", "Basic stats & history", "Step-by-step guided setup"],
  },
  {
    id: "pro" as PlanId,
    name: "Pro",
    price: "€149",
    popular: true,
    tagline: "For active traders following multiple analysts.",
    labelColor: "text-emerald-400",
    borderSel: "border-emerald-400/40",
    checkColor: "text-emerald-400",
    bgSel: "bg-emerald-500/[0.04]",
    features: ["Up to 5 signal rooms", "Advanced signal analysis", "Full stats & backtesting", "Performance dashboard", "Advanced metrics"],
  },
  {
    id: "elite" as PlanId,
    name: "Elite",
    price: "€299",
    tagline: "Professional traders & multi-account managers.",
    labelColor: "text-amber-400",
    borderSel: "border-amber-400/35",
    checkColor: "text-amber-400",
    bgSel: "bg-amber-500/[0.03]",
    features: ["Unlimited signal rooms", "Custom trading rules", "Auto position management", "Copy trading across accounts", "Priority support & onboarding"],
  },
]

// ════════════════════════════════════════════════════════════════════════════════
// STEP 0 — Telegram (phone → credentials → OTP → 2FA → group)
// ════════════════════════════════════════════════════════════════════════════════

type TgSub = "phone" | "session_found" | "creds" | "otp" | "2fa" | "group"

function TelegramStep({ data, update, onNext, onBack, jumpTo }: StepProps) {
  const router = useRouter()

  const initSub = (): TgSub => {
    if (data.userId) return "group"
    if (data.apiId) return "creds"
    return "phone"
  }

  const [sub, setSub]               = useState<TgSub>(initSub)
  const [loading, setLoading]       = useState(false)
  const [err, setErr]               = useState<string | null>(null)
  const [foundSession, setFoundSession] = useState<SetupSession | null>(null)
  const [twoFaPw, setTwoFaPw]       = useState("")
  const [groups, setGroups]         = useState<Group[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupsErr, setGroupsErr]   = useState<string | null>(null)
  const [search, setSearch]         = useState("")

  const clrErr = () => setErr(null)
  const filtered = groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()))

  async function loadGroups() {
    setGroupsLoading(true); setGroupsErr(null)
    try {
      const res = await api.getGroups(data.loginKey)
      setGroups(res.groups)
    } catch (ex) {
      setGroupsErr(ex instanceof ApiError ? ex.message : "Failed to load rooms.")
    } finally {
      setGroupsLoading(false)
    }
  }

  useEffect(() => {
    if (sub === "group") loadGroups()
  }, [sub]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phone ─────────────────────────────────────────────────────────────────
  async function handlePhone() {
    const phone = data.phone.trim()
    if (!phone) return
    setLoading(true); setErr(null); setFoundSession(null)
    try {
      const res = await api.getSession(phone)
      if (res.exists) {
        if (res.setup_complete) {
          router.push(`/dashboard?phone=${encodeURIComponent(phone)}`); return
        }
        setFoundSession(res)
        update({
          apiId:    String(res.api_id ?? ""),
          apiHash:  res.api_hash ?? "",
          loginKey: res.login_key ?? "",
          userId:   res.user_id ?? "",
          groupId:  res.group_id ?? "",
          groupName: res.group_name ?? "",
          mt5Login:  String(res.mt5_login ?? ""),
          mt5Server: res.mt5_server ?? "",
          sizingStrategy:         res.sizing_strategy ?? "",
          extractionInstructions: res.extraction_instructions ?? "",
          managementStrategy:     res.management_strategy ?? "",
          deletionStrategy:       res.deletion_strategy ?? "",
          rangeEntryPct:          String(res.range_entry_pct ?? 50),
          entryIfFavorable:       !!(res.entry_if_favorable),
          minConfidence:          String(res.min_confidence ?? 0),
          tradingHoursEnabled:    !!(res.trading_hours_enabled),
          tradingHoursStart:      String(res.trading_hours_start ?? 8),
          tradingHoursEnd:        String(res.trading_hours_end ?? 22),
          tradingHoursDays:       res.trading_hours_days ?? ["MON","TUE","WED","THU","FRI"],
          ecoCalendarEnabled:     !!(res.eco_calendar_enabled),
          ecoCalendarWindow:      String(res.eco_calendar_window ?? 30),
          ecoCalendarStrategy:    res.eco_calendar_strategy ?? "",
          communityVisible:       !!(res.community_visible),
        })
        setSub("session_found")
      } else {
        await api.saveSession({ phone })
        setSub("creds")
      }
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Unexpected error. Please retry.")
    } finally {
      setLoading(false)
    }
  }

  // ── Session resume/restart ────────────────────────────────────────────────
  function handleResume() {
    if (!foundSession) return
    const s = foundSession
    if (s.user_id) {
      if (s.group_id && s.mt5_login) {
        jumpTo?.(s.sizing_strategy ? 3 : 2)
      } else if (s.group_id) {
        jumpTo?.(1)
      } else {
        setSub("group")
      }
    } else {
      setSub("creds")
    }
  }

  async function handleRestart() {
    setLoading(true)
    try {
      await api.deleteSession(data.phone.trim())
      await api.saveSession({ phone: data.phone.trim() })
      update({ apiId: "", apiHash: "", loginKey: "", userId: "", groupId: "", groupName: "", mt5Login: "", mt5Server: "" })
      setFoundSession(null)
      setSub("creds")
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Unexpected error.")
    } finally {
      setLoading(false)
    }
  }

  // ── Credentials → send OTP ────────────────────────────────────────────────
  async function handleSendCode() {
    setLoading(true); setErr(null)
    try {
      const res = await api.requestCode(Number(data.apiId), data.apiHash, data.phone)
      update({ loginKey: res.login_key })
      await api.saveSession({ phone: data.phone, api_id: Number(data.apiId), api_hash: data.apiHash, login_key: res.login_key })
      setSub("otp")
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Failed to send code.")
    } finally {
      setLoading(false)
    }
  }

  // ── OTP verify ────────────────────────────────────────────────────────────
  async function handleVerifyCode() {
    setLoading(true); setErr(null)
    try {
      const res = await api.verifyCode(data.loginKey, data.code)
      if ("error" in res && res.error === "2fa_required") { setSub("2fa"); return }
      const v = res as VerifyCodeResponse
      update({ userId: v.user_id })
      await api.saveSession({ phone: data.phone, user_id: v.user_id })
      setSub("group")
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Invalid code.")
    } finally {
      setLoading(false)
    }
  }

  // ── 2FA verify ────────────────────────────────────────────────────────────
  async function handleVerifyPw() {
    setLoading(true); setErr(null)
    try {
      const res = await api.verifyPassword(data.loginKey, twoFaPw)
      update({ userId: res.user_id })
      await api.saveSession({ phone: data.phone, user_id: res.user_id })
      setSub("group")
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Incorrect password.")
    } finally {
      setLoading(false)
    }
  }

  // ── Group continue ────────────────────────────────────────────────────────
  async function handleGroupNext() {
    try {
      await api.saveSession({ phone: data.phone, group_id: data.groupId, group_name: data.groupName })
    } catch { /* non-blocking */ }
    onNext()
  }

  const subTitle: Record<TgSub, string> = {
    phone:         "Your phone number",
    session_found: "Existing session found",
    creds:         "Telegram API credentials",
    otp:           "Verify your identity",
    "2fa":         "Two-step verification",
    group:         "Select signal room",
  }

  return (
    <div className={`${card} p-8`}>
      <div className="flex items-center gap-3 mb-6">
        {sub === "group" ? (
          <>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-violet-400/10 border border-violet-400/20">
              <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-white">Select signal room</h3>
              <p className="text-xs text-white/40">Choose the Telegram channel or group to monitor</p>
            </div>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-400/10 border border-emerald-400/20">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-white">Connect Telegram</h3>
              <p className="text-xs text-white/40">{subTitle[sub]}</p>
            </div>
          </>
        )}
      </div>

      {/* ── Phone ── */}
      {sub === "phone" && (
        <div className="space-y-4">
          <div>
            <label className={lbl}>Phone number</label>
            <div className="flex gap-2">
              <div className="flex items-center bg-white/[0.04] border border-white/10 rounded-xl px-3 text-sm text-white/40 shrink-0">+</div>
              <input
                className={inp}
                type="tel"
                placeholder="39 333 123 4567"
                value={data.phone}
                autoFocus
                onChange={e => { update({ phone: e.target.value.replace(/\D/g, "") }); clrErr() }}
                onKeyDown={e => e.key === "Enter" && data.phone && !loading && handlePhone()}
              />
            </div>
            <p className="text-xs text-white/22 mt-1.5">International format without +. Example: <span className="font-mono text-white/35">393331234567</span></p>
          </div>
          {err && <ErrBox msg={err} />}
          <div className="pt-1">
            <PrimaryBtn onClick={handlePhone} disabled={!data.phone.trim()} loading={loading} className="w-full">
              {!loading && "Continue →"}
            </PrimaryBtn>
          </div>
        </div>
      )}

      {/* ── Session found ── */}
      {sub === "session_found" && foundSession && (
        <div className="space-y-4">
          <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 p-4">
            <p className="text-sm font-semibold text-amber-300 mb-1">Setup in progress</p>
            <p className="text-xs text-white/45 leading-relaxed">
              Found an existing session for <strong className="text-white">+{data.phone}</strong>. Resume from where you left off or start fresh.
            </p>
          </div>
          {err && <ErrBox msg={err} />}
          <PrimaryBtn onClick={handleResume} loading={loading} className="w-full">Resume setup →</PrimaryBtn>
          <GhostBtn onClick={handleRestart} disabled={loading} className="w-full">Start over</GhostBtn>
          <button
            onClick={() => { setFoundSession(null); update({ phone: "" }); setSub("phone") }}
            className="w-full text-xs text-white/28 hover:text-white/55 transition-colors py-1"
          >
            Use a different number
          </button>
        </div>
      )}

      {/* ── Credentials ── */}
      {sub === "creds" && (
        <div className="space-y-4">
          <div className="rounded-xl bg-violet-500/8 border border-violet-500/20 px-4 py-3 text-xs text-violet-300 leading-relaxed">
            Go to <strong className="text-violet-200">my.telegram.org</strong> → API development tools → create a new app. Copy the API ID and Hash below.{" "}
            <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline hover:text-violet-200 transition-colors">Open ↗</a>
          </div>
          <div>
            <label className={lbl}>API ID</label>
            <input className={inp} type="number" placeholder="12345678" value={data.apiId} onChange={e => { update({ apiId: e.target.value }); clrErr() }} disabled={loading} />
          </div>
          <div>
            <label className={lbl}>API Hash</label>
            <input className={`${inp} font-mono text-xs`} placeholder="0123456789abcdef…" value={data.apiHash} onChange={e => { update({ apiHash: e.target.value }); clrErr() }} disabled={loading} />
          </div>
          {err && <ErrBox msg={err} />}
          <p className="text-xs text-white/28 text-center">A code will be sent to <strong className="text-white/45">+{data.phone}</strong></p>
          <div className="flex gap-3">
            <GhostBtn onClick={() => setSub("phone")}>← Back</GhostBtn>
            <PrimaryBtn onClick={handleSendCode} disabled={!data.apiId.trim() || !data.apiHash.trim()} loading={loading} className="flex-1">
              {!loading && "Send Code →"}
            </PrimaryBtn>
          </div>
        </div>
      )}

      {/* ── OTP ── */}
      {sub === "otp" && (
        <div className="space-y-4">
          <p className="text-sm text-white/50 leading-relaxed">Enter the code Telegram sent to <strong className="text-white">+{data.phone}</strong>.</p>
          <div>
            <label className={lbl}>Verification code</label>
            <input
              className={`${inp} text-center tracking-[0.6em] text-xl font-mono`}
              placeholder="· · · · ·"
              maxLength={6}
              value={data.code}
              autoFocus
              onChange={e => { update({ code: e.target.value.replace(/\D/g, "") }); clrErr() }}
              onKeyDown={e => e.key === "Enter" && data.code.length >= 5 && !loading && handleVerifyCode()}
            />
          </div>
          {err && <ErrBox msg={err} />}
          <div className="flex gap-3">
            <GhostBtn onClick={() => { update({ code: "" }); setSub("creds") }}>← Back</GhostBtn>
            <PrimaryBtn onClick={handleVerifyCode} disabled={data.code.length < 5} loading={loading} className="flex-1">
              {!loading && "Verify →"}
            </PrimaryBtn>
          </div>
        </div>
      )}

      {/* ── 2FA ── */}
      {sub === "2fa" && (
        <div className="space-y-4">
          <div className="rounded-xl bg-violet-500/8 border border-violet-500/20 px-4 py-3 text-xs text-violet-300 leading-relaxed">
            Your account has two-step verification enabled. Enter your Telegram cloud password.
          </div>
          <div>
            <label className={lbl}>Cloud password</label>
            <input
              className={inp}
              type="password"
              placeholder="••••••••"
              value={twoFaPw}
              autoFocus
              onChange={e => { setTwoFaPw(e.target.value); clrErr() }}
              onKeyDown={e => e.key === "Enter" && twoFaPw && !loading && handleVerifyPw()}
            />
          </div>
          {err && <ErrBox msg={err} />}
          <div className="flex gap-3">
            <GhostBtn onClick={() => { setSub("otp"); clrErr() }}>← Back</GhostBtn>
            <PrimaryBtn onClick={handleVerifyPw} disabled={!twoFaPw} loading={loading} className="flex-1">
              {!loading && "Sign In →"}
            </PrimaryBtn>
          </div>
        </div>
      )}

      {/* ── Group (sub-step) ── */}
      {sub === "group" && (
        <div className="space-y-4">
          {groupsLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-white/35">
              <Spin /><span className="text-sm">Loading your rooms…</span>
            </div>
          )}
          {!groupsLoading && groupsErr && (
            <div className="space-y-3 py-2">
              <ErrBox msg={groupsErr} />
              <GhostBtn onClick={loadGroups} className="w-full">Try again</GhostBtn>
            </div>
          )}
          {!groupsLoading && !groupsErr && (
            <>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input className={`${inp} pl-10`} placeholder="Search channels and groups…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto -mx-1 px-1">
                {filtered.map(g => {
                  const sel = data.groupId === g.id
                  return (
                    <button
                      key={g.id}
                      onClick={() => update({ groupId: g.id, groupName: g.name })}
                      className={`w-full flex items-center gap-3 rounded-xl p-3 text-left transition-all border ${
                        sel ? "border-emerald-400/25 bg-emerald-400/[0.06] text-white" : "border-transparent hover:bg-white/[0.03] text-white/55 hover:text-white"
                      }`}
                    >
                      <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center transition-colors ${sel ? "bg-emerald-400/12" : "bg-white/[0.04]"}`}>
                        <svg className={`w-4 h-4 ${sel ? "text-emerald-400" : "text-white/25"}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          {g.type === "channel"
                            ? <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                            : <path strokeLinecap="round" strokeLinejoin="round" d="M17 20H7a2 2 0 01-2-2V5a2 2 0 012-2h10a2 2 0 012 2v13a2 2 0 01-2 2z" />}
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{g.name}</p>
                        <p className="text-xs text-white/28">{g.members > 0 ? `${g.members.toLocaleString()} members · ` : ""}{g.type === "channel" ? "Channel" : "Group"}</p>
                      </div>
                      {sel && (
                        <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </button>
                  )
                })}
                {filtered.length === 0 && (
                  <p className="text-center text-sm text-white/28 py-8">{search ? `No results for "${search}"` : "No channels or groups found"}</p>
                )}
              </div>
              <p className="text-xs text-white/22 text-center">{groups.length} rooms available</p>
            </>
          )}
          <div className="rounded-xl bg-white/[0.02] border border-white/8 px-4 py-3 text-xs text-white/38 leading-relaxed">
            You are setting up your first signal room. More rooms can be added from the dashboard based on your plan.
          </div>
          <div className="flex gap-3">
            <GhostBtn onClick={onBack}>← Back</GhostBtn>
            <PrimaryBtn onClick={handleGroupNext} disabled={!data.groupId || groupsLoading} className="flex-1">Continue →</PrimaryBtn>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 3 — MT5 account
// ════════════════════════════════════════════════════════════════════════════════

function MT5Step({ data, update, onNext, onBack }: StepProps) {
  const [showPw,   setShowPw]   = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState<string | null>(null)
  const [verified, setVerified] = useState<MT5Account | null>(null)
  const [mt5Unavail, setMt5Unavail] = useState(false)

  const allFilled = data.mt5Login.trim() && data.mt5Password && data.mt5Server.trim()

  function change(p: Partial<SetupData>) {
    update(p); setVerified(null); setErr(null); setMt5Unavail(false)
  }

  async function handleVerify() {
    setLoading(true); setErr(null); setVerified(null); setMt5Unavail(false)
    try {
      const res = await api.verifyMt5(Number(data.mt5Login), data.mt5Password, data.mt5Server, data.phone || undefined)
      setVerified(res.account)
      update({ mt5AccountName: res.account.name, mt5Balance: String(res.account.balance), mt5Currency: res.account.currency })
    } catch (ex) {
      if (ex instanceof ApiError && ex.status === 503) setMt5Unavail(true)
      else setErr(ex instanceof ApiError ? ex.message : "Verification failed.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`${card} p-8`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-cyan-400/10 border border-cyan-400/20">
          <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
          </svg>
        </div>
        <div>
          <h3 className="font-bold text-white">MetaTrader 5 account</h3>
          <p className="text-xs text-white/40">Enter your broker login credentials</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className={lbl}>Account number</label>
          <input className={inp} type="number" placeholder="12345678" value={data.mt5Login} onChange={e => change({ mt5Login: e.target.value })} />
        </div>

        <div>
          <label className={lbl}>Password</label>
          <div className="relative">
            <input className={`${inp} pr-11`} type={showPw ? "text" : "password"} placeholder="••••••••" value={data.mt5Password} onChange={e => change({ mt5Password: e.target.value })} />
            <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/28 hover:text-white/60 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                {showPw
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  : <><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>}
              </svg>
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-white/45 uppercase tracking-wider">Server name</label>
            <button onClick={() => setShowHelp(v => !v)} className="text-xs text-white/28 hover:text-white/55 transition-colors flex items-center gap-1">
              Where do I find this?
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={showHelp ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
              </svg>
            </button>
          </div>
          {showHelp && (
            <div className="rounded-xl bg-white/[0.02] border border-white/8 p-3 text-xs text-white/45 mb-2 leading-relaxed step-enter">
              Open MetaTrader 5 → <strong className="text-white/65">File</strong> → <strong className="text-white/65">Login to Trade Account</strong>. The server name appears in the list, e.g.{" "}
              <code className="font-mono text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">ICMarkets-Live01</code>
            </div>
          )}
          <input className={`${inp} font-mono`} placeholder="ICMarkets-Live01" value={data.mt5Server} onChange={e => change({ mt5Server: e.target.value })} />
        </div>

        {verified && (
          <div className="flex items-start gap-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20 px-4 py-3">
            <svg className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div>
              <p className="text-sm font-semibold text-emerald-300">Account verified</p>
              <p className="text-xs text-white/40 mt-0.5">{verified.name} · {verified.server} · {verified.balance.toLocaleString("en", { style: "currency", currency: verified.currency, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        {mt5Unavail && (
          <div className="flex items-start gap-3 rounded-xl bg-amber-500/8 border border-amber-500/20 px-4 py-3">
            <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div className="text-xs">
              <p className="font-semibold text-amber-300">Verification unavailable</p>
              <p className="text-amber-300/70 mt-0.5">MT5 is not on this server. Credentials are saved and will be verified on first Windows startup.</p>
            </div>
          </div>
        )}

        {err && <ErrBox msg={err} />}

        {!verified && !mt5Unavail && (
          <GhostBtn onClick={handleVerify} disabled={!allFilled || loading} className="w-full">
            {loading ? <><Spin />Verifying…</> : "Verify MT5 credentials"}
          </GhostBtn>
        )}

        <div className="flex gap-3">
          <GhostBtn onClick={onBack}>← Back</GhostBtn>
          <PrimaryBtn onClick={onNext} disabled={!(verified || mt5Unavail)} className="flex-1">Continue →</PrimaryBtn>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 4 — AI & risk rules
// ════════════════════════════════════════════════════════════════════════════════

const SIZING_EX  = ["Always use 0.1 lot per trade.", "Risk 2% of balance per trade, calculated on the distance to SL.", "Use 0.01 lot per $1,000 of balance."]
const MGMT_EX    = ["Move SL to break-even when price reaches 50% of the target.", "Close half at first TP and trail the rest.", "No active management: hold until SL or TP."]
const DELETION_EX = ["Close all related positions immediately.", "Close only if in profit. Otherwise move SL to break-even.", "Reduce position by half and move SL to break-even."]
const EXTRACT_EX  = ["Add .s suffix to all symbols (e.g. EURUSD → EURUSD.s).", "If the symbol contains 'XAU' or 'Gold', always use XAUUSD.s.", "Emit multiple TPs as separate objects with the same entry and SL."]

function Preset({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full text-left rounded-xl border border-white/[0.06] px-3 py-2.5 text-xs text-white/40 hover:border-emerald-400/20 hover:text-white/75 hover:bg-emerald-400/[0.025] transition-all flex items-start gap-2">
      <svg className="w-3 h-3 mt-0.5 shrink-0 text-white/20" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
      {text}
    </button>
  )
}

function TA({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <textarea id={id} rows={3} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/22 focus:outline-none focus:border-emerald-400/40 focus:bg-white/[0.05] transition-all resize-none" />
  )
}

// ── Signal Simulator helpers ──────────────────────────────────────────────────

type SimPhase = "signal" | "pipeline" | "chart"

type SimExtracted = {
  symbol: string; order_type: string; entry_price: number | [number, number] | null
  stop_loss: number | null; take_profit: number | null; lot_size: number | null
  order_mode: string; confidence: number | null
}

type SimAIResult = {
  tool_calls: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }>
  actions: Array<{ tool: string; [key: string]: unknown }>
  final_response: string
}

type SimEvent = { t: number; type: string; price: number; pnl?: number; description: string; ai_result?: SimAIResult }

type SimResult = {
  per_signal: Array<{ signal_index: number; symbol: string; order_type: string; entry: number | null; sl: number | null; tp: number | null; events: SimEvent[]; state: string }>
  total_pnl: number
}

type PricePt = { t: number; price: number }

type PretradeDecision = {
  signal_index: number; approved: boolean; reason: string
  modified_lots?: number | null; modified_sl?: number | null; modified_tp?: number | null
}
type PretradeToolCall = { name: string; args: Record<string, unknown>; result: Record<string, unknown> }
type PretradeAction = { tool: string; [key: string]: unknown }
type PretradeResult = {
  event_type: string; decisions: PretradeDecision[]
  tool_calls: PretradeToolCall[]; actions: PretradeAction[]; final_response: string
}
type MockPos   = { ticket: string; symbol: string; order_type: string; lots: string; profit: string }
type MockOrd   = { ticket: string; symbol: string; order_type: string; lots: string; price: string }

const CHART_W = 560
const CHART_H = 200
const CHART_PAD = { top: 16, right: 16, bottom: 28, left: 52 }

function priceToY(price: number, pMin: number, pMax: number): number {
  if (pMax === pMin) return CHART_H / 2
  const inner = CHART_H - CHART_PAD.top - CHART_PAD.bottom
  return CHART_PAD.top + inner * (1 - (price - pMin) / (pMax - pMin))
}
function tToX(t: number): number {
  const inner = CHART_W - CHART_PAD.left - CHART_PAD.right
  return CHART_PAD.left + t * inner
}
function xyToPricePt(svgX: number, svgY: number, pMin: number, pMax: number): PricePt {
  const inner_x = CHART_W - CHART_PAD.left - CHART_PAD.right
  const inner_y = CHART_H - CHART_PAD.top - CHART_PAD.bottom
  const t = Math.max(0, Math.min(1, (svgX - CHART_PAD.left) / inner_x))
  const price = pMin + (1 - Math.max(0, Math.min(1, (svgY - CHART_PAD.top) / inner_y))) * (pMax - pMin)
  return { t, price }
}

function PipelineCard({
  icon, title, badge, value, isEmpty, isRequired, expanded, onToggle, children,
}: {
  icon: React.ReactNode; title: string; badge?: React.ReactNode; value: string; isEmpty: boolean
  isRequired?: boolean; expanded: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className={`rounded-2xl border transition-all ${
      expanded ? "border-emerald-400/25 bg-emerald-400/[0.03]"
      : isRequired && isEmpty ? "border-amber-400/20 bg-amber-400/[0.025]"
      : isEmpty ? "border-white/8 bg-white/[0.02]"
      : "border-emerald-400/15 bg-emerald-400/[0.025]"
    }`}>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          expanded ? "bg-emerald-400/15" : isEmpty ? isRequired ? "bg-amber-400/10" : "bg-white/[0.04]" : "bg-emerald-400/10"
        }`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">{title}</span>
            {badge}
          </div>
          <p className={`text-xs mt-0.5 truncate ${isEmpty ? isRequired ? "text-amber-400/70" : "text-white/25" : "text-white/50"}`}>
            {isEmpty ? isRequired ? "Required — click to configure" : "Optional — click to configure" : value}
          </p>
        </div>
        <svg className={`w-4 h-4 text-white/25 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {expanded && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  )
}


function RulesStep({ data, update, onNext, onBack }: StepProps) {
  const [phase, setPhase]           = useState<SimPhase>("signal")
  const [recentMsgs, setRecentMsgs] = useState<{ id: number; text: string; date: string | null }[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [selectedMsg, setSelectedMsg]  = useState("")
  const [pasteMsg, setPasteMsg]        = useState("")
  const [extracting, setExtracting]    = useState(false)
  const [extracted, setExtracted]      = useState<SimExtracted[]>([])
  const [isSignal, setIsSignal]        = useState<boolean | null>(null)
  const [openCard, setOpenCard]        = useState<string | null>("sizing")

  // Chart phase
  const [priceMin, setPriceMin]   = useState("")
  const [priceMax, setPriceMax]   = useState("")
  const [pricePath, setPricePath] = useState<PricePt[]>([])
  const [tEvents, setTEvents]     = useState<{ t: number; type: string }[]>([])
  const [addEventMode, setAddEventMode] = useState(false)
  const [drawing, setDrawing]     = useState(false)
  const [simLoading, setSimLoading] = useState(false)
  const [simResult, setSimResult]   = useState<SimResult | null>(null)

  // AI strategy mock panel
  const [mockBalance,       setMockBalance]       = useState(() => data.mt5Balance || "10000")
  const [mockEquity,        setMockEquity]        = useState(() => data.mt5Balance || "10000")
  const [mockFreeMargin,    setMockFreeMargin]    = useState(() => data.mt5Balance || "10000")
  const [mockLeverage,      setMockLeverage]      = useState("100")
  const [mockCurrency,      setMockCurrency]      = useState(() => data.mt5Currency || "USD")
  const [mockServer,        setMockServer]        = useState("SimBroker-Demo")
  const [mockDailyPnl,      setMockDailyPnl]      = useState("0")
  const [mockWeeklyPnl,     setMockWeeklyPnl]     = useState("0")
  const [mockMonthlyPnl,    setMockMonthlyPnl]    = useState("0")
  const [mockOpenPositions, setMockOpenPositions] = useState<MockPos[]>([])
  const [mockPendingOrders, setMockPendingOrders] = useState<MockOrd[]>([])
  const [openMockSec,       setOpenMockSec]        = useState<string | null>(null)
  const [pretradeLoading,   setPretradeLoading]   = useState(false)
  const [pretradeResult,    setPretradeResult]    = useState<PretradeResult | null>(null)
  const [expandedToolCalls, setExpandedToolCalls] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)

  // Fetch recent messages when entering signal phase
  useEffect(() => {
    if (data.loginKey && data.groupId) {
      setLoadingMsgs(true)
      api.getRecentMessages(data.loginKey, data.groupId)
        .then(r => setRecentMsgs(r.messages))
        .catch(() => {})
        .finally(() => setLoadingMsgs(false))
    }
  }, [data.loginKey, data.groupId])

  // Pre-fill price range from all extracted signals
  useEffect(() => {
    if (extracted.length > 0 && !priceMin && !priceMax) {
      const levels: number[] = []
      for (const sig of extracted) {
        if (Array.isArray(sig.entry_price)) levels.push(sig.entry_price[0], sig.entry_price[1])
        else if (sig.entry_price != null) levels.push(sig.entry_price)
        if (sig.stop_loss != null) levels.push(sig.stop_loss)
        if (sig.take_profit != null) levels.push(sig.take_profit)
      }
      if (levels.length >= 2) {
        const range  = Math.max(...levels) - Math.min(...levels)
        const margin = range * 0.1
        setPriceMin(String(Math.round((Math.min(...levels) - margin) * 100) / 100))
        setPriceMax(String(Math.round((Math.max(...levels) + margin) * 100) / 100))
      }
    }
  }, [extracted, priceMin, priceMax])

  const activeMsg = selectedMsg || pasteMsg

  async function handleSelectMessage(text: string) {
    setSelectedMsg(text)
    setPasteMsg("")
    await runExtraction(text)
    setPhase("pipeline")
  }

  async function handleUsePaste() {
    if (!pasteMsg.trim()) return
    setSelectedMsg("")
    await runExtraction(pasteMsg)
    setPhase("pipeline")
  }

  async function runExtraction(text: string) {
    setExtracting(true)
    setExtracted([])
    setIsSignal(null)
    try {
      const res = await api.simulateSignal({
        message: text,
        sizing_strategy: data.sizingStrategy || undefined,
        extraction_instructions: data.extractionInstructions || undefined,
        management_strategy: data.managementStrategy || undefined,
      })
      setIsSignal(res.is_signal)
      setExtracted(res.extracted)
    } catch {}
    setExtracting(false)
  }

  // SVG mouse handlers
  function getSvgCoords(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (CHART_W / rect.width),
      y: (e.clientY - rect.top) * (CHART_H / rect.height),
    }
  }

  const pMin = parseFloat(priceMin) || 0
  const pMax = parseFloat(priceMax) || 1

  function handleSvgMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (pMax <= pMin) return
    const { x, y } = getSvgCoords(e)
    if (addEventMode) {
      const pt = xyToPricePt(x, y, pMin, pMax)
      setTEvents([{ t: pt.t, type: "signal_deleted" }])
      setAddEventMode(false)
      return
    }
    setDrawing(true)
    setPricePath([xyToPricePt(x, y, pMin, pMax)])
    setSimResult(null)
  }

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!drawing || addEventMode) return
    const { x, y } = getSvgCoords(e)
    const pt = xyToPricePt(x, y, pMin, pMax)
    setPricePath(prev => {
      if (prev.length === 0) return [pt]
      const last = prev[prev.length - 1]
      if (pt.t < last.t + 0.002) return prev   // only accept forward movement
      return [...prev, pt]
    })
  }

  function handleSvgMouseUp() {
    if (!drawing) return
    setDrawing(false)
    if (pricePath.length < 2) return
    // Normalize t to [0, 1] so the path always fills the full chart width
    const tMin = Math.min(...pricePath.map(p => p.t))
    const tMax = Math.max(...pricePath.map(p => p.t))
    const tRange = tMax - tMin || 1
    const normalized = pricePath.map(p => ({ t: (p.t - tMin) / tRange, price: p.price }))
    setPricePath(normalized)
    // Normalize pMin/pMax to exact data range so event markers align perfectly
    const prices = normalized.map(p => p.price)
    const dMin = Math.min(...prices)
    const dMax = Math.max(...prices)
    const range = dMax - dMin || 1
    const margin = range * 0.08
    const decs = range < 0.005 ? 5 : range < 0.05 ? 4 : range < 0.5 ? 3 : range < 5 ? 2 : range < 50 ? 1 : 0
    setPriceMin((dMin - margin).toFixed(decs))
    setPriceMax((dMax + margin).toFixed(decs))
  }

  async function handleRunSim() {
    if (!activeMsg.trim() || pricePath.length < 2) return
    setSimLoading(true)
    setPretradeResult(null)
    try {
      const hasStrategy = !!(data.managementStrategy?.trim() || data.sizingStrategy?.trim())

      if (hasStrategy) {
        // Full pipeline: extract → pretrade AI → stateful walk-forward with auto AI events
        const res = await api.simulateFull({
          message: activeMsg,
          sizing_strategy: data.sizingStrategy || undefined,
          extraction_instructions: data.extractionInstructions || undefined,
          management_strategy: data.managementStrategy || undefined,
          deletion_strategy: data.deletionStrategy || undefined,
          price_path: pricePath,
          timeline_events: tEvents,
          mock_state: buildMockState(),
        })
        setSimResult(res.simulation)
        if (res.pretrade) setPretradeResult(res.pretrade)
        if (!extracted.length && res.extracted.length) setExtracted(res.extracted)
        if (isSignal === null && res.is_signal !== null) setIsSignal(res.is_signal)
      } else {
        // No strategy — pure price path simulation (fast, no AI calls)
        const res = await api.simulateSignal({
          message: activeMsg,
          sizing_strategy: data.sizingStrategy || undefined,
          extraction_instructions: data.extractionInstructions || undefined,
          management_strategy: data.managementStrategy || undefined,
          deletion_strategy: data.deletionStrategy || undefined,
          price_path: pricePath,
          timeline_events: tEvents,
        })
        setSimResult(res.simulation)
        if (!extracted.length && res.extracted.length) setExtracted(res.extracted)
      }
    } catch {}
    setSimLoading(false)
  }

  function buildMockState() {
    return {
      balance:       parseFloat(mockBalance)    || 10000,
      equity:        parseFloat(mockEquity)     || 10000,
      free_margin:   parseFloat(mockFreeMargin) || 10000,
      leverage:      parseInt(mockLeverage)     || 100,
      currency:      mockCurrency  || "USD",
      server:        mockServer    || "SimBroker-Demo",
      daily_pnl:     parseFloat(mockDailyPnl)    || 0,
      weekly_pnl:    parseFloat(mockWeeklyPnl)   || 0,
      monthly_pnl:   parseFloat(mockMonthlyPnl)  || 0,
      open_positions: mockOpenPositions.map((p, i) => ({
        ticket:     parseInt(p.ticket)  || 100 + i,
        symbol:     p.symbol,
        order_type: p.order_type || "BUY",
        lots:       parseFloat(p.lots)   || 0.1,
        profit:     parseFloat(p.profit) || 0,
      })),
      pending_orders: mockPendingOrders.map((o, i) => ({
        ticket:     parseInt(o.ticket) || 200 + i,
        symbol:     o.symbol,
        order_type: o.order_type || "BUY_LIMIT",
        lots:       parseFloat(o.lots)  || 0.01,
        price:      parseFloat(o.price) || 0,
      })),
    }
  }

  async function handleRunPretrade() {
    if (!extracted.length) return
    setPretradeLoading(true); setPretradeResult(null)
    try {
      const res = await api.simulatePretrade({
        signals: extracted as Parameters<typeof api.simulatePretrade>[0]["signals"],
        message: activeMsg,
        management_strategy: data.managementStrategy || undefined,
        deletion_strategy: data.deletionStrategy || undefined,
        sizing_strategy: data.sizingStrategy || undefined,
        event_type: "pretrade",
        mock_state: buildMockState(),
      })
      setPretradeResult(res)
    } catch {}
    setPretradeLoading(false)
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function renderSignalBadge() {
    if (isSignal === null) return null
    return isSignal
      ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-400">Signal detected</span>
      : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.04] text-white/35">Not a signal</span>
  }

  function renderExtractedSummary() {
    if (extracting) return (
      <div className="flex items-center gap-2 text-xs text-white/40">
        <Spin /><span>Analyzing with AI…</span>
      </div>
    )
    if (isSignal === false) return (
      <p className="text-xs text-white/35 italic">No trading signal found in this message.</p>
    )
    if (!extracted.length) return null
    return (
      <div className="space-y-2">
        {extracted.map((s, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${s.order_type === "BUY" ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}>
              {s.order_type}
            </span>
            <span className="text-xs font-mono text-white/70">{s.symbol}</span>
            {s.entry_price !== null && (
              <span className="text-xs text-white/40 font-mono">
                @ {Array.isArray(s.entry_price) ? `${s.entry_price[0]}–${s.entry_price[1]}` : s.entry_price}
              </span>
            )}
            {s.stop_loss !== null && <span className="text-xs text-red-400/70 font-mono">SL {s.stop_loss}</span>}
            {s.take_profit !== null && <span className="text-xs text-emerald-400/70 font-mono">TP {s.take_profit}</span>}
            {s.confidence !== null && (
              <span className={`text-xs font-mono ${s.confidence >= 70 ? "text-emerald-400/60" : s.confidence >= 40 ? "text-amber-400/60" : "text-red-400/60"}`}>
                {s.confidence}% confidence
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  // ── Chart SVG helpers ───────────────────────────────────────────────────────

  function renderChart() {
    const hasRange = pMax > pMin
    const pathD = pricePath.length >= 2
      ? pricePath.map((pt, i) => `${i === 0 ? "M" : "L"} ${tToX(pt.t).toFixed(1)} ${priceToY(pt.price, pMin, pMax).toFixed(1)}`).join(" ")
      : null

    // Grid lines — decimal count from step magnitude, trailing zeros stripped
    const gridPrices = hasRange ? Array.from({ length: 5 }, (_, i) => pMin + (pMax - pMin) * i / 4) : []
    const step = hasRange ? (pMax - pMin) / 4 : 1
    const labelDecs = step < 0.0005 ? 6 : step < 0.005 ? 5 : step < 0.05 ? 4 : step < 0.5 ? 3 : step < 5 ? 2 : step < 50 ? 1 : 0
    const fmtLabel = (n: number) => {
      const s = parseFloat(n.toFixed(labelDecs)).toString()
      return s.includes("e") ? n.toFixed(labelDecs) : s
    }

    // Sim event markers on path
    const simMarkers: { cx: number; cy: number; type: string; pnl?: number }[] = []
    if (simResult && hasRange) {
      simResult.per_signal.forEach(sig => {
        sig.events.forEach(ev => {
          const cx = tToX(ev.t)
          const cy = priceToY(ev.price, pMin, pMax)
          simMarkers.push({ cx, cy, type: ev.type, pnl: ev.pnl })
        })
      })
    }

    return (
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className={`w-full rounded-xl border ${hasRange ? "border-white/10 cursor-crosshair" : "border-white/5"} bg-white/[0.02]`}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseUp}
      >
        {/* Grid */}
        {gridPrices.map((p, i) => {
          const y = priceToY(p, pMin, pMax)
          return (
            <g key={i}>
              <line x1={CHART_PAD.left} x2={CHART_W - CHART_PAD.right} y1={y} y2={y} stroke="white" strokeOpacity={0.04} strokeDasharray="2,3" />
              <text x={CHART_PAD.left - 4} y={y + 3.5} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.25)">{fmtLabel(p)}</text>
            </g>
          )
        })}

        {/* Signal level lines — all extracted signals */}
        {hasRange && extracted.flatMap((sig, si) => {
          const lines: React.ReactNode[] = []
          if (sig.stop_loss != null) {
            const y = priceToY(sig.stop_loss, pMin, pMax)
            lines.push(<line key={`sl-${si}`} x1={CHART_PAD.left} x2={CHART_W - CHART_PAD.right} y1={y} y2={y} stroke="#f87171" strokeOpacity={0.5} strokeDasharray="4,3" strokeWidth={1} />)
          }
          if (sig.take_profit != null) {
            const y = priceToY(sig.take_profit, pMin, pMax)
            lines.push(<line key={`tp-${si}`} x1={CHART_PAD.left} x2={CHART_W - CHART_PAD.right} y1={y} y2={y} stroke="#34d399" strokeOpacity={0.5} strokeDasharray="4,3" strokeWidth={1} />)
          }
          if (sig.entry_price != null) {
            const ep = sig.entry_price
            const epVal = Array.isArray(ep) ? (ep[0] + ep[1]) / 2 : ep
            const y = priceToY(epVal, pMin, pMax)
            lines.push(<line key={`ep-${si}`} x1={CHART_PAD.left} x2={CHART_W - CHART_PAD.right} y1={y} y2={y} stroke="#a3e635" strokeOpacity={0.4} strokeDasharray="4,3" strokeWidth={1} />)
          }
          return lines
        })}

        {/* Drawn path */}
        {pathD && (
          <path d={pathD} fill="none" stroke="#34d399" strokeWidth={2} strokeOpacity={0.8} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Timeline events */}
        {tEvents.map((ev, i) => {
          const x = tToX(ev.t)
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={CHART_PAD.top} y2={CHART_H - CHART_PAD.bottom} stroke="#fb923c" strokeOpacity={0.5} strokeDasharray="3,3" strokeWidth={1.5} />
              <text x={x} y={CHART_H - CHART_PAD.bottom + 12} textAnchor="middle" fontSize={7} fill="rgba(251,146,60,0.7)">deleted</text>
            </g>
          )
        })}

        {/* Simulation markers */}
        {simMarkers.map((m, i) => {
          const color = m.type === "tp" ? "#34d399" : m.type === "sl" ? "#f87171" : m.type === "entry" ? "#a3e635" : m.type === "expired" ? "#facc15" : m.type === "close" ? "#c084fc" : "#fb923c"
          return (
            <g key={i}>
              <circle cx={m.cx} cy={m.cy} r={5} fill={color} fillOpacity={0.9} />
              {m.pnl !== undefined && (
                <text x={m.cx} y={m.cy - 8} textAnchor="middle" fontSize={8} fill={m.pnl >= 0 ? "#34d399" : "#f87171"} fontWeight="bold">
                  {m.pnl >= 0 ? "+" : ""}{m.pnl.toFixed(0)}
                </text>
              )}
            </g>
          )
        })}

        {/* Placeholder text */}
        {!pathD && hasRange && (
          <text x={CHART_W / 2} y={CHART_H / 2 + 4} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.18)">
            Draw the price movement with your mouse
          </text>
        )}
        {!hasRange && (
          <text x={CHART_W / 2} y={CHART_H / 2 + 4} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.15)">
            Set price min & max above to enable drawing
          </text>
        )}
      </svg>
    )
  }

  return (
    <div className={`${card} p-8`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-violet-500/10 border border-violet-500/20">
          <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">Signal Simulator</h2>
          <p className="text-xs text-white/35 mt-0.5">Configure your AI rules using a real signal</p>
        </div>
      </div>

      {/* Phase tabs */}
      <div className="flex items-center gap-1 mb-6 p-1 rounded-xl bg-white/[0.03] border border-white/8">
        {([
          { id: "signal", label: "1. Pick signal" },
          { id: "pipeline", label: "2. Configure" },
          { id: "chart", label: "3. Simulate" },
        ] as const).map(tab => (
          <button key={tab.id} type="button"
            onClick={() => { if (tab.id === "pipeline" || tab.id === "chart") { if (!activeMsg) return } setPhase(tab.id) }}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${
              phase === tab.id
                ? "bg-white/[0.07] text-white"
                : "text-white/30 hover:text-white/60"
            } ${(tab.id === "pipeline" || tab.id === "chart") && !activeMsg ? "opacity-30 cursor-not-allowed" : ""}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">

        {/* ── Phase 1: signal picker ─────────────────────────────────────────── */}
        {phase === "signal" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Recent messages */}
              <div>
                <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Recent messages from {data.groupName || "your group"}</p>
                {loadingMsgs ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-14 rounded-xl bg-white/[0.03] border border-white/6 animate-pulse" />
                    ))}
                  </div>
                ) : recentMsgs.length === 0 ? (
                  <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-xs text-white/25">
                    No messages found — use the paste option →
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {recentMsgs.map(msg => (
                      <button key={msg.id} type="button"
                        onClick={() => handleSelectMessage(msg.text)}
                        className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all group ${
                          selectedMsg === msg.text
                            ? "border-violet-400/30 bg-violet-400/[0.06] text-white"
                            : "border-white/8 text-white/50 hover:border-white/18 hover:text-white/75 hover:bg-white/[0.03]"
                        }`}>
                        <p className="text-[11px] line-clamp-2 leading-relaxed">{msg.text}</p>
                        {msg.date && <p className="text-[10px] text-white/20 mt-1">{new Date(msg.date).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Paste */}
              <div>
                <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Or paste a message</p>
                <textarea rows={6} placeholder={"Paste a signal message here…\n\nExample:\nBUY XAUUSD @ 2340\nSL: 2325\nTP: 2365"}
                  value={pasteMsg} onChange={e => { setPasteMsg(e.target.value); setSelectedMsg("") }}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/18 focus:outline-none focus:border-violet-400/40 focus:bg-white/[0.05] transition-all resize-none" />
                <button type="button" onClick={handleUsePaste} disabled={!pasteMsg.trim()}
                  className="mt-2 w-full py-2.5 rounded-xl border border-violet-400/20 bg-violet-400/[0.05] text-xs font-semibold text-violet-300 hover:bg-violet-400/[0.10] disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                  Use this message →
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <GhostBtn onClick={onBack}>← Back</GhostBtn>
              <button type="button" onClick={() => setPhase("pipeline")}
                className="flex-1 text-center text-xs text-white/25 hover:text-white/50 transition-colors py-3">
                Skip simulator — configure manually →
              </button>
            </div>
          </>
        )}

        {/* ── Phase 2: pipeline config ───────────────────────────────────────── */}
        {phase === "pipeline" && (
          <>
            {/* Selected message display */}
            {activeMsg && (
              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Selected signal</span>
                      {renderSignalBadge()}
                    </div>
                    <p className="text-xs text-white/55 line-clamp-2 leading-relaxed">{activeMsg}</p>
                  </div>
                  <button onClick={() => setPhase("signal")} className="text-[10px] text-white/25 hover:text-white/55 shrink-0 transition-colors">change</button>
                </div>
                {(extracting || extracted.length > 0 || isSignal === false) && (
                  <div className="mt-2 pt-2 border-t border-white/6">
                    {renderExtractedSummary()}
                  </div>
                )}
              </div>
            )}

            {/* Pipeline cards */}
            <PipelineCard
              icon={<svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              title="Position Sizing"
              badge={<PlanBadge plan="core" />}
              value={data.sizingStrategy}
              isEmpty={!data.sizingStrategy.trim()}
              isRequired
              expanded={openCard === "sizing"}
              onToggle={() => setOpenCard(v => v === "sizing" ? null : "sizing")}
            >
              <TA id="sizing" value={data.sizingStrategy} onChange={v => update({ sizingStrategy: v })} placeholder={"Example: " + SIZING_EX[0]} />
              <p className="text-xs text-white/22">How much to trade per signal. The AI uses this rule when calculating lot size.</p>
              <div className="space-y-1.5">{SIZING_EX.map(p => <Preset key={p} text={p} onClick={() => update({ sizingStrategy: p })} />)}</div>

              <div className="border-t border-white/6 pt-3 space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">Range entry position</span>
                    <PlanBadge plan="core" />
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="range" min={0} max={100} step={5} value={Number(data.rangeEntryPct)}
                      onChange={e => update({ rangeEntryPct: e.target.value })}
                      className="flex-1 accent-emerald-400 cursor-pointer" />
                    <span className="text-xs font-mono text-white/55 w-10 text-right shrink-0">{data.rangeEntryPct}%</span>
                  </div>
                  <p className="text-xs text-white/22 mt-1">Position within entry range. 0%=bottom, 50%=mid, 100%=top.</p>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">Market entry if price is favorable</span>
                    <PlanBadge plan="core" />
                  </div>
                  <div className="flex gap-2">
                    {([{ val: false, label: "Off" }, { val: true, label: "On" }] as const).map(o => (
                      <button key={String(o.val)} type="button" onClick={() => update({ entryIfFavorable: o.val })}
                        className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-all ${data.entryIfFavorable === o.val ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300" : "border-white/8 text-white/35 hover:border-white/15"}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </PipelineCard>

            <PipelineCard
              icon={<svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
              title="Position Management"
              badge={<PlanBadge plan="elite" />}
              value={data.managementStrategy}
              isEmpty={!data.managementStrategy.trim()}
              expanded={openCard === "mgmt"}
              onToggle={() => setOpenCard(v => v === "mgmt" ? null : "mgmt")}
            >
              <TA id="mgmt" value={data.managementStrategy} onChange={v => update({ managementStrategy: v })} placeholder={"Example: " + MGMT_EX[0]} />
              <p className="text-xs text-white/22">How the AI manages open positions: break-even, trailing stop, partial close, etc.</p>
              <div className="space-y-1.5">{MGMT_EX.map(p => <Preset key={p} text={p} onClick={() => update({ managementStrategy: p })} />)}</div>
            </PipelineCard>

            <PipelineCard
              icon={<svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
              title="Signal Deletion"
              badge={<PlanBadge plan="elite" />}
              value={data.deletionStrategy}
              isEmpty={!data.deletionStrategy.trim()}
              expanded={openCard === "deletion"}
              onToggle={() => setOpenCard(v => v === "deletion" ? null : "deletion")}
            >
              <div className="rounded-xl bg-amber-500/8 border border-amber-500/15 px-3 py-2 text-xs text-amber-300/75 leading-relaxed">
                Signal rooms often delete messages to hide bad trades. Define what the AI should do.
              </div>
              <TA id="deletion" value={data.deletionStrategy} onChange={v => update({ deletionStrategy: v })} placeholder={"Example: " + DELETION_EX[0]} />
              <div className="space-y-1.5">{DELETION_EX.map(p => <Preset key={p} text={p} onClick={() => update({ deletionStrategy: p })} />)}</div>
            </PipelineCard>

            <PipelineCard
              icon={<svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" /></svg>}
              title="Advanced filters"
              badge={<span className="text-[10px] text-white/20">Pro & Elite</span>}
              value={[
                data.minConfidence !== "0" ? `Confidence ≥ ${data.minConfidence}` : "",
                data.extractionInstructions ? "Custom extraction rules" : "",
                data.tradingHoursEnabled ? "Trading hours filter" : "",
                data.ecoCalendarEnabled ? "Eco calendar filter" : "",
                data.communityVisible ? "Community visible" : "",
              ].filter(Boolean).join(" · ") || ""}
              isEmpty={!data.extractionInstructions && !Number(data.minConfidence) && !data.tradingHoursEnabled && !data.ecoCalendarEnabled && !data.communityVisible}
              expanded={openCard === "advanced"}
              onToggle={() => setOpenCard(v => v === "advanced" ? null : "advanced")}
            >
              {/* Extraction instructions */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">AI extraction instructions</span>
                  <span className="text-white/20 text-[10px]">Optional</span>
                  <PlanBadge plan="core" />
                </div>
                <TA id="extract" value={data.extractionInstructions} onChange={v => update({ extractionInstructions: v })} placeholder={"Example: " + EXTRACT_EX[0]} />
                <div className="space-y-1 mt-1.5">{EXTRACT_EX.map(p => <Preset key={p} text={p} onClick={() => update({ extractionInstructions: p })} />)}</div>
              </div>
              {/* Confidence threshold */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">AI confidence threshold</span>
                  <PlanBadge plan="pro" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={100} step={10} value={Number(data.minConfidence)}
                    onChange={e => update({ minConfidence: e.target.value })}
                    className="flex-1 accent-emerald-400 cursor-pointer" />
                  <span className="text-xs font-mono text-white/55 w-10 text-right shrink-0">{data.minConfidence}</span>
                </div>
                <p className="text-xs text-white/22 mt-1">{Number(data.minConfidence) === 0 ? "0 — Accept all signals" : `Discard signals below ${data.minConfidence}% confidence`}</p>
              </div>
              {/* Trading hours */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">Trading hours filter</span>
                  <PlanBadge plan="elite" />
                </div>
                <div className="flex gap-2">
                  {([{ val: false, label: "Off" }, { val: true, label: "On" }] as const).map(o => (
                    <button key={String(o.val)} type="button" onClick={() => update({ tradingHoursEnabled: o.val })}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-all ${data.tradingHoursEnabled === o.val ? "border-amber-400/25 bg-amber-400/[0.08] text-amber-300" : "border-white/8 text-white/35 hover:border-white/15"}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
                {data.tradingHoursEnabled && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-white/25 mb-1 block">Start UTC</label>
                        <input type="number" min={0} max={23} value={data.tradingHoursStart}
                          onChange={e => update({ tradingHoursStart: String(Math.min(23, Math.max(0, Number(e.target.value)))) })}
                          className={inp} />
                      </div>
                      <span className="text-white/20 text-xs pt-4">→</span>
                      <div className="flex-1">
                        <label className="text-[10px] text-white/25 mb-1 block">End UTC</label>
                        <input type="number" min={0} max={23} value={data.tradingHoursEnd}
                          onChange={e => update({ tradingHoursEnd: String(Math.min(23, Math.max(0, Number(e.target.value)))) })}
                          className={inp} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(["MON","TUE","WED","THU","FRI","SAT","SUN"] as const).map(day => {
                        const sel = data.tradingHoursDays.includes(day)
                        const labels: Record<string, string> = { MON:"Mon",TUE:"Tue",WED:"Wed",THU:"Thu",FRI:"Fri",SAT:"Sat",SUN:"Sun" }
                        return (
                          <button key={day} type="button"
                            onClick={() => update({ tradingHoursDays: sel ? data.tradingHoursDays.filter(d => d !== day) : [...data.tradingHoursDays, day] })}
                            className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-all ${sel ? "border-amber-400/25 bg-amber-400/[0.08] text-amber-300" : "border-white/8 text-white/30 hover:border-white/15"}`}>
                            {labels[day]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              {/* Eco calendar */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">Economic calendar filter</span>
                  <PlanBadge plan="elite" />
                </div>
                <div className="flex gap-2">
                  {([{ val: false, label: "Off" }, { val: true, label: "On" }] as const).map(o => (
                    <button key={String(o.val)} type="button" onClick={() => update({ ecoCalendarEnabled: o.val })}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-all ${data.ecoCalendarEnabled === o.val ? "border-amber-400/25 bg-amber-400/[0.08] text-amber-300" : "border-white/8 text-white/35 hover:border-white/15"}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
                {data.ecoCalendarEnabled && (
                  <div className="mt-2 space-y-2">
                    <div>
                      <label className="text-[10px] text-white/25 mb-1 block">Event window (min)</label>
                      <input type="number" min={5} max={120} value={data.ecoCalendarWindow}
                        onChange={e => update({ ecoCalendarWindow: String(Math.min(120, Math.max(5, Number(e.target.value)))) })}
                        className={`${inp} w-24`} />
                    </div>
                    <TA id="eco-strategy" value={data.ecoCalendarStrategy} onChange={v => update({ ecoCalendarStrategy: v })} placeholder="AI strategy during events (optional)" />
                  </div>
                )}
              </div>
              {/* Community */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">Signal room visibility</span>
                  <PlanBadge plan="elite" />
                </div>
                <div className="flex gap-2">
                  {([{ val: false, label: "Private" }, { val: true, label: "Public" }] as const).map(o => (
                    <button key={String(o.val)} type="button" onClick={() => update({ communityVisible: o.val })}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-all ${data.communityVisible === o.val ? "border-amber-400/25 bg-amber-400/[0.08] text-amber-300" : "border-white/8 text-white/35 hover:border-white/15"}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </PipelineCard>

            <div className="flex gap-3 pt-2">
              <GhostBtn onClick={() => setPhase("signal")}>← Back</GhostBtn>
              <GhostBtn onClick={() => setPhase("chart")} className="flex-1">Draw chart & simulate →</GhostBtn>
              <PrimaryBtn onClick={onNext} disabled={!data.sizingStrategy.trim()} className="flex-1">Continue →</PrimaryBtn>
            </div>
          </>
        )}

        {/* ── Phase 3: drawable chart ────────────────────────────────────────── */}
        {phase === "chart" && (
          <>
            {/* Extracted signal compact summary */}
            {extracted.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/[0.02] border border-white/8">
                <div className="flex items-center gap-2 flex-wrap flex-1">{renderExtractedSummary()}</div>
                <button onClick={() => setPhase("pipeline")} className="text-[10px] text-white/25 hover:text-white/55 transition-colors shrink-0">edit config</button>
              </div>
            )}

            {/* Price range */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className={lbl}>Price min</label>
                <input type="number" step="any" className={inp} placeholder="e.g. 2300" value={priceMin} onChange={e => setPriceMin(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className={lbl}>Price max</label>
                <input type="number" step="any" className={inp} placeholder="e.g. 2400" value={priceMax} onChange={e => setPriceMax(e.target.value)} />
              </div>
              <div className="pt-6">
                <button type="button" onClick={() => { setPricePath([]); setTEvents([]); setSimResult(null) }}
                  className="px-3 py-2.5 rounded-xl border border-white/8 text-xs text-white/30 hover:text-white/60 hover:border-white/15 transition-all">
                  Clear
                </button>
              </div>
            </div>

            {/* Chart */}
            <div className="select-none">
              {renderChart()}
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-3 text-[10px] text-white/25">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#a3e635] opacity-50"></span> Entry</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#34d399] opacity-50"></span> TP</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#f87171] opacity-50"></span> SL</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#fb923c] opacity-50"></span> Deleted</span>
                </div>
                <div className="flex-1" />
                {tEvents.length > 0 && (
                  <button type="button"
                    onClick={() => setTEvents([])}
                    className="text-[9px] text-orange-400/60 hover:text-orange-400 border border-orange-400/20 hover:border-orange-400/40 rounded px-1.5 py-0.5 transition-all">
                    deletion event ✕
                  </button>
                )}
                <button type="button"
                  onClick={() => setAddEventMode(v => !v)}
                  className={`px-3 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${addEventMode ? "border-orange-400/30 bg-orange-400/[0.08] text-orange-300" : "border-white/8 text-white/35 hover:border-white/15 hover:text-white/60"}`}>
                  {addEventMode ? "Click chart to place" : "+ Add deletion event"}
                </button>
              </div>
            </div>

            {/* Run simulation */}
            <button type="button" onClick={handleRunSim}
              disabled={simLoading || pricePath.length < 2 || !activeMsg.trim()}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-bold rounded-xl py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(139,92,246,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none">
              {simLoading && <Spin />}
              {simLoading
                ? "Running full simulation…"
                : pricePath.length < 2
                  ? "Draw a price path first"
                  : (data.managementStrategy?.trim() || data.sizingStrategy?.trim())
                    ? "Run full simulation (pretrade + AI events) →"
                    : "Run simulation →"}
            </button>

            {/* Simulation result */}
            {simResult && (
              <div className="space-y-3">
                {/* Pretrade decisions — shown here when produced by Run simulation */}
                {pretradeResult && pretradeResult.decisions.length > 0 && (
                  <div className="rounded-xl border border-violet-400/15 bg-violet-400/[0.02] px-3 py-2.5 space-y-1.5">
                    <p className="text-[10px] font-semibold text-violet-300/60 uppercase tracking-wider">Pre-trade AI decisions</p>
                    {pretradeResult.decisions.map((d, di) => {
                      const sig = extracted[d.signal_index]
                      const isModified = d.approved && (d.modified_lots != null || d.modified_sl != null || d.modified_tp != null)
                      return (
                        <div key={di} className={`flex items-start gap-2 text-[10px] px-2 py-1.5 rounded-lg ${
                          !d.approved ? "bg-red-400/[0.06] text-red-300/80"
                          : isModified ? "bg-amber-400/[0.06] text-amber-300/80"
                          : "bg-emerald-400/[0.04] text-emerald-300/80"
                        }`}>
                          <span className={`font-bold shrink-0 ${!d.approved ? "text-red-400" : isModified ? "text-amber-400" : "text-emerald-400"}`}>
                            {!d.approved ? "✗" : isModified ? "~" : "✓"}
                          </span>
                          <span className="font-mono text-white/50 shrink-0">{sig ? `${sig.order_type} ${sig.symbol}` : `Signal ${d.signal_index}`}</span>
                          {isModified && (
                            <span className="font-mono text-amber-300/60">
                              {d.modified_lots != null && `lots:${d.modified_lots} `}
                              {d.modified_sl != null && `SL:${d.modified_sl} `}
                              {d.modified_tp != null && `TP:${d.modified_tp}`}
                            </span>
                          )}
                          <span className="text-white/30 flex-1 leading-relaxed">{d.reason}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${simResult.total_pnl >= 0 ? "border-emerald-400/20 bg-emerald-400/[0.05]" : "border-red-400/20 bg-red-400/[0.04]"}`}>
                  <span className="text-sm font-semibold text-white/70">Simulated P&amp;L</span>
                  <span className={`text-lg font-bold font-mono ${simResult.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {simResult.total_pnl >= 0 ? "+" : ""}{simResult.total_pnl.toFixed(2)} <span className="text-xs font-normal opacity-50">approx.</span>
                  </span>
                </div>
                {simResult.per_signal.map((sig, si) => (
                  <div key={si} className="space-y-1">
                    <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{sig.order_type} {sig.symbol}</p>
                    {sig.events.length === 0 ? (
                      <p className="text-xs text-white/20 italic">No events — price never crossed key levels</p>
                    ) : (
                      sig.events.map((ev, ei) => (
                        <div key={ei} className="space-y-1">
                          <div className={`flex items-center gap-3 text-xs px-3 py-2 rounded-lg ${
                            ev.type === "tp" ? "bg-emerald-400/[0.04] text-emerald-300/80"
                            : ev.type === "sl" ? "bg-red-400/[0.04] text-red-300/80"
                            : ev.type === "entry" ? "bg-white/[0.03] text-white/55"
                            : "bg-orange-400/[0.04] text-orange-300/80"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              ev.type === "tp" ? "bg-emerald-400" : ev.type === "sl" ? "bg-red-400" : ev.type === "entry" ? "bg-white/40" : "bg-orange-400"
                            }`} />
                            <span className="flex-1">{ev.description}</span>
                            {ev.pnl !== undefined && (
                              <span className={`font-mono font-bold ${ev.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {ev.pnl >= 0 ? "+" : ""}{ev.pnl.toFixed(2)}
                              </span>
                            )}
                          </div>
                          {/* Inline AI reaction for this event */}
                          {ev.ai_result && (ev.ai_result.actions.length > 0 || ev.ai_result.tool_calls.length > 0 || ev.ai_result.final_response) && (
                            <div className="ml-4 rounded-lg border border-violet-400/12 bg-violet-400/[0.025] px-2.5 py-2 space-y-1.5">
                              <p className="text-[9px] font-semibold text-violet-300/50 uppercase tracking-wider">AI reaction</p>
                              {ev.ai_result.actions.length > 0 && (
                                <div className="space-y-1">
                                  {ev.ai_result.actions.map((ac, ai) => {
                                    const { tool, simulated: _s, ...rest } = ac as { tool: string; simulated?: unknown; [k: string]: unknown }
                                    return (
                                      <div key={ai} className="rounded border border-amber-400/10 bg-amber-400/[0.03] px-2 py-1 font-mono text-[9px]">
                                        <span className="text-amber-300 font-semibold">{tool}</span>
                                        <span className="text-white/25 ml-1.5">{JSON.stringify(rest).slice(0, 80)}</span>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                              {ev.ai_result.final_response && (
                                <p className="text-[9px] text-white/35 leading-relaxed">{ev.ai_result.final_response.slice(0, 200)}{ev.ai_result.final_response.length > 200 ? "…" : ""}</p>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── AI Strategy simulation panel ─────────────────────────────── */}
            {extracted.length > 0 && (
              <div className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.02] p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-violet-400/10 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-violet-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  </div>
                  <span className="text-xs font-semibold text-violet-300 uppercase tracking-wider">AI Strategy Simulation</span>
                </div>

                {/* Mock MT5 context — collapsible sections */}
                {(() => {
                  const mockInp = "w-full bg-white/[0.04] border border-white/8 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-violet-400/30 transition-all"
                  const secBtn = (key: string, label: string, badge?: string) => (
                    <button type="button" onClick={() => setOpenMockSec(v => v === key ? null : key)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.05] border border-white/6 transition-all">
                      <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">{label}</span>
                      <div className="flex items-center gap-2">
                        {badge && <span className="text-[9px] text-white/25">{badge}</span>}
                        <svg className={`w-3 h-3 text-white/20 transition-transform ${openMockSec === key ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </div>
                    </button>
                  )
                  return (
                    <div className="space-y-1.5">
                      {/* Account */}
                      {secBtn("account", "Account", `${mockCurrency} ${parseFloat(mockBalance).toLocaleString()}`)}
                      {openMockSec === "account" && (
                        <div className="px-1 pb-1 space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { label: "Balance", value: mockBalance, set: setMockBalance },
                              { label: "Equity", value: mockEquity, set: setMockEquity },
                              { label: "Free margin", value: mockFreeMargin, set: setMockFreeMargin },
                              { label: "Leverage", value: mockLeverage, set: setMockLeverage },
                              { label: "Currency", value: mockCurrency, set: setMockCurrency, text: true },
                              { label: "Server", value: mockServer, set: setMockServer, text: true },
                            ] as const).map(f => (
                              <div key={f.label}>
                                <label className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5 block">{f.label}</label>
                                <input type={"text" in f && f.text ? "text" : "number"} step="any" value={f.value}
                                  onChange={e => f.set(e.target.value)} className={mockInp} />
                              </div>
                            ))}
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { label: "Daily P&L", value: mockDailyPnl, set: setMockDailyPnl },
                              { label: "Weekly P&L", value: mockWeeklyPnl, set: setMockWeeklyPnl },
                              { label: "Monthly P&L", value: mockMonthlyPnl, set: setMockMonthlyPnl },
                            ] as const).map(f => (
                              <div key={f.label}>
                                <label className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5 block">{f.label}</label>
                                <input type="number" step="any" value={f.value} onChange={e => f.set(e.target.value)} className={mockInp} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Open positions */}
                      {secBtn("positions", "Open positions", mockOpenPositions.length > 0 ? `${mockOpenPositions.length} open` : "none")}
                      {openMockSec === "positions" && (
                        <div className="px-1 pb-1 space-y-1.5">
                          {mockOpenPositions.map((pos, pi) => (
                            <div key={pi} className="flex gap-1.5 items-center">
                              <input placeholder="Symbol" value={pos.symbol} onChange={e => setMockOpenPositions(p => p.map((x, i) => i === pi ? { ...x, symbol: e.target.value.toUpperCase() } : x))}
                                className={`${mockInp} w-24`} />
                              <div className="flex rounded-lg border border-white/8 overflow-hidden shrink-0">
                                {(["BUY","SELL"] as const).map(t => (
                                  <button key={t} type="button" onClick={() => setMockOpenPositions(p => p.map((x, i) => i === pi ? { ...x, order_type: t } : x))}
                                    className={`px-2 py-1.5 text-[10px] font-bold transition-all ${pos.order_type === t ? t === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400" : "text-white/25 hover:text-white/50"}`}>
                                    {t}
                                  </button>
                                ))}
                              </div>
                              <input placeholder="Lots" type="number" step="0.01" value={pos.lots} onChange={e => setMockOpenPositions(p => p.map((x, i) => i === pi ? { ...x, lots: e.target.value } : x))}
                                className={`${mockInp} w-16`} />
                              <input placeholder="Profit" type="number" step="any" value={pos.profit} onChange={e => setMockOpenPositions(p => p.map((x, i) => i === pi ? { ...x, profit: e.target.value } : x))}
                                className={`${mockInp} w-20`} />
                              <input placeholder="Ticket" type="number" value={pos.ticket} onChange={e => setMockOpenPositions(p => p.map((x, i) => i === pi ? { ...x, ticket: e.target.value } : x))}
                                className={`${mockInp} w-16`} />
                              <button type="button" onClick={() => setMockOpenPositions(p => p.filter((_, i) => i !== pi))}
                                className="text-white/20 hover:text-red-400 transition-colors shrink-0 px-1">✕</button>
                            </div>
                          ))}
                          <button type="button"
                            onClick={() => setMockOpenPositions(p => [...p, { ticket: String(100 + p.length), symbol: extracted[0]?.symbol || "XAUUSD", order_type: "BUY", lots: "0.1", profit: "0" }])}
                            className="text-[10px] text-violet-400/70 hover:text-violet-400 transition-colors">+ Add position</button>
                        </div>
                      )}

                      {/* Pending orders */}
                      {secBtn("pending", "Pending orders", mockPendingOrders.length > 0 ? `${mockPendingOrders.length} pending` : "none")}
                      {openMockSec === "pending" && (
                        <div className="px-1 pb-1 space-y-1.5">
                          {mockPendingOrders.map((ord, oi) => (
                            <div key={oi} className="flex gap-1.5 items-center">
                              <input placeholder="Symbol" value={ord.symbol} onChange={e => setMockPendingOrders(p => p.map((x, i) => i === oi ? { ...x, symbol: e.target.value.toUpperCase() } : x))}
                                className={`${mockInp} w-24`} />
                              <select value={ord.order_type} onChange={e => setMockPendingOrders(p => p.map((x, i) => i === oi ? { ...x, order_type: e.target.value } : x))}
                                className="bg-white/[0.04] border border-white/8 rounded-lg px-2 py-1.5 text-xs text-white/70 font-mono focus:outline-none focus:border-violet-400/30 transition-all">
                                {["BUY_LIMIT","SELL_LIMIT","BUY_STOP","SELL_STOP"].map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <input placeholder="Lots" type="number" step="0.01" value={ord.lots} onChange={e => setMockPendingOrders(p => p.map((x, i) => i === oi ? { ...x, lots: e.target.value } : x))}
                                className={`${mockInp} w-16`} />
                              <input placeholder="Price" type="number" step="any" value={ord.price} onChange={e => setMockPendingOrders(p => p.map((x, i) => i === oi ? { ...x, price: e.target.value } : x))}
                                className={`${mockInp} w-24`} />
                              <input placeholder="Ticket" type="number" value={ord.ticket} onChange={e => setMockPendingOrders(p => p.map((x, i) => i === oi ? { ...x, ticket: e.target.value } : x))}
                                className={`${mockInp} w-16`} />
                              <button type="button" onClick={() => setMockPendingOrders(p => p.filter((_, i) => i !== oi))}
                                className="text-white/20 hover:text-red-400 transition-colors shrink-0 px-1">✕</button>
                            </div>
                          ))}
                          <button type="button"
                            onClick={() => setMockPendingOrders(p => [...p, { ticket: String(200 + p.length), symbol: extracted[0]?.symbol || "XAUUSD", order_type: "BUY_LIMIT", lots: "0.01", price: "" }])}
                            className="text-[10px] text-violet-400/70 hover:text-violet-400 transition-colors">+ Add order</button>
                        </div>
                      )}

                    </div>
                  )
                })()}

                {/* Run pretrade button */}
                <button type="button" onClick={handleRunPretrade}
                  disabled={pretradeLoading}
                  className="w-full flex items-center justify-center gap-2 border border-violet-400/25 bg-violet-400/[0.06] hover:bg-violet-400/[0.1] text-violet-300 font-semibold text-xs rounded-xl py-2.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  {pretradeLoading && <Spin />}
                  {pretradeLoading ? "Running AI pre_trade…" : "Run AI pre_trade strategy (standalone)"}
                </button>
                {simResult && (
                  <p className="text-[9px] text-violet-300/35 text-center -mt-1">
                    Pre-trade already included in the full simulation above
                  </p>
                )}

                {/* Pretrade results — shown only for standalone runs (not when full sim already ran) */}
                {pretradeResult && !simResult && (
                  <div className="space-y-3">
                    {/* Decisions */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Signal decisions</p>
                      {pretradeResult.decisions.map((d, di) => {
                        const sig = extracted[d.signal_index]
                        const label = sig ? `[${di}] ${sig.order_type} ${sig.symbol}` : `Signal ${d.signal_index}`
                        const isModified = !d.approved ? false : (d.modified_lots != null || d.modified_sl != null || d.modified_tp != null)
                        return (
                          <div key={di} className={`rounded-xl border px-3 py-2.5 text-xs space-y-1 ${
                            !d.approved ? "border-red-400/20 bg-red-400/[0.04]"
                            : isModified ? "border-amber-400/20 bg-amber-400/[0.04]"
                            : "border-emerald-400/20 bg-emerald-400/[0.04]"
                          }`}>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold ${!d.approved ? "text-red-400" : isModified ? "text-amber-400" : "text-emerald-400"}`}>
                                {!d.approved ? "✗ Rejected" : isModified ? "~ Modified" : "✓ Approved"}
                              </span>
                              <span className="text-white/50 font-mono">{label}</span>
                            </div>
                            {isModified && (
                              <div className="flex flex-wrap gap-2 text-[10px] font-mono text-amber-300/70">
                                {d.modified_lots != null && <span>lots: {d.modified_lots}</span>}
                                {d.modified_sl != null && <span>SL: {d.modified_sl}</span>}
                                {d.modified_tp != null && <span>TP: {d.modified_tp}</span>}
                              </div>
                            )}
                            <p className="text-white/40 text-[10px] leading-relaxed">{d.reason}</p>
                          </div>
                        )
                      })}
                    </div>

                    {/* Tool calls log */}
                    {pretradeResult.tool_calls.length > 0 && (
                      <div>
                        <button type="button" onClick={() => setExpandedToolCalls(v => !v)}
                          className="flex items-center gap-1.5 text-[10px] text-white/30 hover:text-white/55 transition-colors">
                          <svg className={`w-3 h-3 transition-transform ${expandedToolCalls ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
                          Tool calls ({pretradeResult.tool_calls.length})
                        </button>
                        {expandedToolCalls && (
                          <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                            {pretradeResult.tool_calls.map((tc, ti) => (
                              <div key={ti} className="rounded-lg bg-white/[0.02] border border-white/6 px-2.5 py-2 font-mono text-[10px]">
                                <span className="text-violet-300">{tc.name}</span>
                                <span className="text-white/25 ml-2">{JSON.stringify(tc.args).slice(0, 80)}</span>
                                <div className="text-white/20 mt-0.5">→ {JSON.stringify(tc.result).slice(0, 80)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Write actions taken */}
                    {pretradeResult.actions && pretradeResult.actions.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-amber-400/60 uppercase tracking-wider">AI actions (simulated)</p>
                        {pretradeResult.actions.map((ac, ai) => {
                          const { tool, simulated: _s, ...rest } = ac
                          return (
                            <div key={ai} className="rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-2.5 py-2 font-mono text-[10px]">
                              <span className="text-amber-300 font-semibold">{tool}</span>
                              <span className="text-white/30 ml-2">{JSON.stringify(rest).slice(0, 100)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* AI reasoning */}
                    {pretradeResult.final_response && (
                      <div className="rounded-xl bg-white/[0.02] border border-white/6 px-3 py-2.5">
                        <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1.5">AI reasoning</p>
                        <p className="text-xs text-white/50 leading-relaxed whitespace-pre-wrap">{pretradeResult.final_response}</p>
                      </div>
                    )}

                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <GhostBtn onClick={() => setPhase("pipeline")}>← Back</GhostBtn>
              <PrimaryBtn onClick={onNext} disabled={!data.sizingStrategy.trim()} className="flex-1">Continue →</PrimaryBtn>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 5 — Payment (mock)
// ════════════════════════════════════════════════════════════════════════════════

function fmtCard(v: string) { const d = v.replace(/\D/g, "").slice(0, 16); return d.replace(/(.{4})/g, "$1 ").trim() }
function fmtExp(v: string)  { const d = v.replace(/\D/g, "").slice(0, 4);  return d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d }

function PaymentStep({ data, update, onNext, onBack }: StepProps) {
  const minPlan = getMinPlan(data)
  const minIdx  = PLAN_ORDER.indexOf(minPlan)

  const [selectedPlan,    setSelectedPlan]    = useState<PlanId>(minPlan)
  const [pendingDowngrade, setPendingDowngrade] = useState<PlanId | null>(null)
  const [name,    setName]    = useState("")
  const [cardNum, setCardNum] = useState("")
  const [expiry,  setExpiry]  = useState("")
  const [cvc,     setCvc]     = useState("")
  const [loading, setLoading] = useState(false)

  const plan     = PLANS.find(p => p.id === selectedPlan)!
  const canPay   = name.trim() && cardNum.replace(/\s/g, "").length === 16 && expiry.length === 5 && cvc.length >= 3
  const affected = pendingDowngrade ? getAffectedFields(pendingDowngrade, data) : []

  function handleSelectPlan(p: PlanId) {
    if (PLAN_ORDER.indexOf(p) < minIdx) {
      const aff = getAffectedFields(p, data)
      if (aff.length > 0) { setPendingDowngrade(p); return }
    }
    setSelectedPlan(p); setPendingDowngrade(null)
  }

  function confirmDowngrade() {
    if (!pendingDowngrade) return
    const updates: Partial<SetupData> = {}
    getAffectedFields(pendingDowngrade, data).forEach(f => { (updates as Record<string, string>)[f.field] = "" })
    update(updates)
    setSelectedPlan(pendingDowngrade); setPendingDowngrade(null)
  }

  function handlePay() {
    setLoading(true)
    update({ plan: selectedPlan })
    setTimeout(() => { setLoading(false); onNext() }, 1400)
  }

  const configFeatures = [
    { label: "Telegram account",    value: `+${data.phone}`,                                         minPlan: "core"  as PlanId, show: !!data.phone },
    { label: "Signal room",         value: data.groupName,                                            minPlan: "core"  as PlanId, show: !!data.groupId },
    { label: "MT5 account",         value: data.mt5AccountName || data.mt5Login,                     minPlan: "core"  as PlanId, show: !!data.mt5Login },
    { label: "Position sizing",     value: "Configured",                                             minPlan: "core"  as PlanId, show: !!data.sizingStrategy },
    { label: "Range entry position",        value: `${data.rangeEntryPct}%`,                                         minPlan: "core"  as PlanId, show: Number(data.rangeEntryPct) !== 50 },
    { label: "Market entry if favorable",   value: "Enabled",                                                        minPlan: "core"  as PlanId, show: data.entryIfFavorable },
    { label: "AI extraction rules",         value: "Configured",                                                     minPlan: "core"  as PlanId, show: !!data.extractionInstructions },
    { label: "AI confidence threshold",     value: `≥ ${data.minConfidence}`,                                        minPlan: "pro"   as PlanId, show: Number(data.minConfidence) > 0 },
    { label: "Position management",         value: "Configured",                                                     minPlan: "elite" as PlanId, show: !!data.managementStrategy },
    { label: "Deletion handling",           value: "Configured",                                                     minPlan: "elite" as PlanId, show: !!data.deletionStrategy },
    { label: "Trading hours",               value: `${data.tradingHoursStart}:00–${data.tradingHoursEnd}:59 UTC`,   minPlan: "elite" as PlanId, show: data.tradingHoursEnabled },
    { label: "Economic calendar filter",    value: `±${data.ecoCalendarWindow} min`,                                 minPlan: "elite" as PlanId, show: data.ecoCalendarEnabled },
    { label: "Community room",              value: "Public",                                                         minPlan: "elite" as PlanId, show: data.communityVisible },
  ].filter(f => f.show)

  const minPlanObj = PLANS.find(p => p.id === minPlan)!

  return (
    <div className={`${card} p-8`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-400/10 border border-emerald-400/20">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
          </svg>
        </div>
        <div>
          <h3 className="font-bold text-white">Payment</h3>
          <p className="text-xs text-white/40">Secure checkout · Cancel anytime</p>
        </div>
      </div>

      {/* Configuration summary */}
      <div className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2">Your configuration</p>
        <div className="rounded-xl border border-white/8 overflow-hidden">
          {configFeatures.map(({ label, value, minPlan: fp }, i) => (
            <div key={label} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-white/5" : ""}`}>
              <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
              <span className="text-xs text-white/55 flex-1 min-w-0 truncate">
                <span className="text-white/80">{label}</span>{value !== "Configured" ? ` · ${value}` : ""}
              </span>
              <PlanBadge plan={fp} />
            </div>
          ))}
        </div>
      </div>

      {/* Plan selection */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Choose plan</p>
          <span className="text-xs text-white/30">
            Minimum: <span className={minPlanObj.labelColor}>{minPlanObj.name}</span>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PLANS.map(p => {
            const sel       = selectedPlan === p.id
            const isLower   = PLAN_ORDER.indexOf(p.id) < minIdx
            const isPending = pendingDowngrade === p.id
            return (
              <button
                key={p.id}
                onClick={() => handleSelectPlan(p.id)}
                className={`relative p-3 rounded-xl border text-left transition-all duration-200 ${
                  sel       ? `${p.borderSel} ${p.bgSel}`
                  : isPending ? "border-amber-400/30 bg-amber-500/[0.04]"
                  : isLower   ? "border-white/6 bg-white/[0.015] opacity-55 hover:opacity-75"
                  :             "border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.03]"
                }`}
              >
                {p.id === minPlan && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap ${
                      p.id === "elite" ? "bg-amber-400/20 text-amber-300" : "bg-emerald-400/20 text-emerald-300"
                    }`}>Recommended</span>
                  </div>
                )}
                <div className={`text-[9px] font-bold uppercase tracking-widest mb-0.5 ${p.labelColor}`}>{p.name}</div>
                <div className="text-base font-black text-white leading-tight">{p.price}<span className="text-white/25 text-[10px] font-normal">/mo</span></div>
                {isLower && <p className="text-[9px] text-amber-400/65 mt-1 leading-tight">Removes features</p>}
              </button>
            )
          })}
        </div>

        {/* Downgrade warning */}
        {pendingDowngrade && affected.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-500/8 border border-amber-500/20 p-4">
            <p className="text-sm font-semibold text-amber-300 mb-1">
              Downgrade to {PLANS.find(p => p.id === pendingDowngrade)?.name}?
            </p>
            <p className="text-xs text-white/45 mb-3 leading-relaxed">
              The following configured rules will be <strong className="text-amber-300">removed</strong>:
            </p>
            <ul className="space-y-1 mb-4">
              {affected.map(f => (
                <li key={f.field} className="flex items-center gap-2 text-xs text-amber-300/70">
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  {f.label}
                </li>
              ))}
            </ul>
            <p className="text-xs text-white/30 mb-2">
              Still available in the {PLANS.find(p => p.id === pendingDowngrade)?.name} dashboard:
            </p>
            <ul className="space-y-1 mb-4">
              {PLANS.find(p => p.id === pendingDowngrade)!.features.map(f => (
                <li key={f} className="flex items-center gap-2 text-xs text-white/40">
                  <svg className="w-3 h-3 shrink-0 text-emerald-400/60" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <GhostBtn onClick={() => setPendingDowngrade(null)} className="flex-1 !py-2 text-xs">Cancel</GhostBtn>
              <button
                onClick={confirmDowngrade}
                className="flex-1 text-xs font-semibold py-2 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-300 hover:bg-amber-500/25 transition-all"
              >
                Confirm
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Payment form */}
      <div className="space-y-4">
        <div>
          <label className={lbl}>Name on card</label>
          <input className={inp} placeholder="John Smith" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Card number</label>
          <input className={`${inp} font-mono tracking-wider`} placeholder="1234 5678 9012 3456" maxLength={19} value={cardNum} onChange={e => setCardNum(fmtCard(e.target.value))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Expiry</label>
            <input className={`${inp} font-mono`} placeholder="MM/YY" maxLength={5} value={expiry} onChange={e => setExpiry(fmtExp(e.target.value))} />
          </div>
          <div>
            <label className={lbl}>CVC</label>
            <input className={`${inp} font-mono tracking-widest`} placeholder="123" maxLength={4} value={cvc} onChange={e => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          </div>
        </div>
        <div className="flex items-center justify-center gap-5 py-1">
          {[
            ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "SSL secured"],
            ["M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", "PCI compliant"],
            ["M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z", "Cancel anytime"],
          ].map(([path, label]) => (
            <div key={label} className="flex items-center gap-1.5 text-xs text-white/22">
              <svg className="w-3.5 h-3.5 text-white/18" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={path} /></svg>
              {label}
            </div>
          ))}
        </div>
        <PrimaryBtn onClick={handlePay} disabled={!canPay || !!pendingDowngrade} loading={loading} className="w-full mt-2">
          {!loading && `Subscribe — ${plan.price}/month →`}
        </PrimaryBtn>
        <GhostBtn onClick={onBack} className="w-full">← Back</GhostBtn>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 6 — Launch
// ════════════════════════════════════════════════════════════════════════════════

function LaunchStep({ data, onBack }: StepProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [done, setDone]       = useState(false)

  async function handleStart() {
    setLoading(true); setErr(null)
    try {
      await api.completeSetup({
        login_key: data.loginKey,
        user_id:   data.userId,
        api_id:    Number(data.apiId),
        api_hash:  data.apiHash,
        phone:     data.phone,
        group_id:  data.groupId,
        group_name: data.groupName,
        mt5_login:  data.mt5Login ? Number(data.mt5Login) : undefined,
        mt5_password: data.mt5Password || undefined,
        mt5_server:   data.mt5Server || undefined,
        sizing_strategy:         data.sizingStrategy || undefined,
        extraction_instructions: data.extractionInstructions || undefined,
        management_strategy:     data.managementStrategy || undefined,
        deletion_strategy:       data.deletionStrategy || undefined,
        range_entry_pct:         Number(data.rangeEntryPct),
        entry_if_favorable:      data.entryIfFavorable,
        min_confidence:          Number(data.minConfidence),
        trading_hours_enabled:   data.tradingHoursEnabled,
        trading_hours_start:     Number(data.tradingHoursStart),
        trading_hours_end:       Number(data.tradingHoursEnd),
        trading_hours_days:      data.tradingHoursDays,
        eco_calendar_enabled:    data.ecoCalendarEnabled,
        eco_calendar_window:     Number(data.ecoCalendarWindow),
        eco_calendar_strategy:   data.ecoCalendarStrategy || undefined,
        community_visible:       data.communityVisible,
      })
      setDone(true)
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Unexpected error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className={`${card} p-10 text-center`}>
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 bg-gradient-to-br from-emerald-400/15 to-cyan-400/8 border border-emerald-400/25 shadow-[0_0_60px_rgba(0,232,135,0.12)]">
          <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-2xl font-black text-white mb-2"><GradientText>Bot is live!</GradientText></h2>
        <p className="text-sm text-white/45 leading-relaxed max-w-xs mx-auto mb-8">
          SignalFlow AI is now listening on <strong className="text-white">{data.groupName}</strong> and will execute every signal automatically — 24/7.
        </p>
        <div className="rounded-xl bg-emerald-500/8 border border-emerald-500/18 px-4 py-3 text-xs text-white/40 leading-relaxed mb-6">
          You can close this page. The bot runs independently on our servers.
        </div>
        <PrimaryBtn onClick={() => router.push(`/dashboard?phone=${encodeURIComponent(data.phone)}`)} className="w-full">
          Go to dashboard →
        </PrimaryBtn>
      </div>
    )
  }

  const plan = PLANS.find(p => p.id === data.plan) ?? PLANS[1]
  const summary = [
    { d: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z", label: "Telegram", value: `+${data.phone}` },
    { d: "M7 20l4-16m2 16l4-16M6 9h14M4 15h14", label: "Signal room", value: data.groupName },
    { d: "M22 7l-13.5 8.5-5-5L2 17M16 7h6v6", label: "MT5 account", value: data.mt5AccountName ? `${data.mt5AccountName} · ${data.mt5Server}` : `${data.mt5Login} · ${data.mt5Server}` },
    { d: "M3 10h18M3 14h18M10 3v18", label: "Plan", value: `${plan.name} — ${plan.price}/month` },
    { d: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", label: "Position sizing", value: data.sizingStrategy.length > 55 ? data.sizingStrategy.slice(0, 52) + "…" : data.sizingStrategy },
  ]

  return (
    <div className={`${card} p-8`}>
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-gradient-to-br from-emerald-400/12 to-cyan-400/6 border border-emerald-400/20">
          <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-black text-white mb-1">Setup complete</h2>
        <p className="text-sm text-white/40">Review your configuration and start the bot.</p>
      </div>

      <div className="rounded-xl border border-white/8 overflow-hidden mb-6">
        {summary.map(({ d, label, value }, i) => (
          <div key={label} className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-white/5" : ""}`}>
            <div className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center bg-emerald-400/8">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={d} />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/30">{label}</p>
              <p className="text-sm font-medium text-white truncate">{value}</p>
            </div>
            <svg className="w-4 h-4 text-emerald-400/60 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
        ))}
      </div>

      <div className={`rounded-xl border px-4 py-3 mb-4 ${
        plan.id === "elite" ? "border-amber-400/20 bg-amber-500/[0.03]"
        : plan.id === "pro"  ? "border-emerald-400/20 bg-emerald-500/[0.03]"
        :                      "border-white/10 bg-white/[0.02]"
      }`}>
        <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${plan.labelColor}`}>
          {plan.name} — active features
        </p>
        <ul className="space-y-1.5">
          {plan.features.slice(0, 3).map(f => (
            <li key={f} className="flex items-center gap-2 text-xs text-white/50">
              <svg className={`w-3.5 h-3.5 shrink-0 ${plan.checkColor}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {err && <div className="mb-4"><ErrBox msg={err} /></div>}

      <div className="space-y-3">
        <PrimaryBtn onClick={handleStart} loading={loading} className="w-full">
          {!loading && "Start the bot →"}
        </PrimaryBtn>
        <GhostBtn onClick={onBack} disabled={loading} className="w-full">← Review settings</GhostBtn>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// Main wizard — replaced by Nova chat interface
// ════════════════════════════════════════════════════════════════════════════════

export function SetupWizard() {
  return <NovaChatWizard />
}

function _OldSetupWizard_unused() {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<SetupData>(EMPTY)

  const update  = (p: Partial<SetupData>) => setData(prev => ({ ...prev, ...p }))
  const jumpTo  = (s: number) => setStep(s)

  const goNext = async () => {
    try {
      switch (step) {
        // step 0 (Telegram+Group): session save handled inside TelegramStep
        case 1:
          await api.saveSession({ phone: data.phone, mt5_login: Number(data.mt5Login), mt5_server: data.mt5Server, mt5_password: data.mt5Password }); break
        case 2:
          await api.saveSession({
            phone: data.phone,
            sizing_strategy: data.sizingStrategy,
            extraction_instructions: data.extractionInstructions || undefined,
            management_strategy: data.managementStrategy || undefined,
            deletion_strategy: data.deletionStrategy || undefined,
            range_entry_pct: Number(data.rangeEntryPct),
            entry_if_favorable: data.entryIfFavorable,
            min_confidence: Number(data.minConfidence),
            trading_hours_enabled: data.tradingHoursEnabled,
            trading_hours_start: Number(data.tradingHoursStart),
            trading_hours_end: Number(data.tradingHoursEnd),
            trading_hours_days: data.tradingHoursDays,
            eco_calendar_enabled: data.ecoCalendarEnabled,
            eco_calendar_window: Number(data.ecoCalendarWindow),
            eco_calendar_strategy: data.ecoCalendarStrategy || undefined,
            community_visible: data.communityVisible,
          }); break
      }
    } catch { /* non-blocking */ }
    setStep(s => Math.min(s + 1, 4))
  }

  const goBack = async () => {
    try {
      switch (step) {
        case 1:
          await api.clearSessionFields(data.phone, ["mt5_login", "mt5_password", "mt5_server"])
          update({ mt5Login: "", mt5Password: "", mt5Server: "", mt5AccountName: "" }); break
        case 2:
          await api.clearSessionFields(data.phone, [
            "sizing_strategy", "extraction_instructions", "management_strategy", "deletion_strategy",
            "range_entry_pct", "entry_if_favorable", "min_confidence",
            "trading_hours_enabled", "trading_hours_start", "trading_hours_end", "trading_hours_days",
            "eco_calendar_enabled", "eco_calendar_window", "eco_calendar_strategy", "community_visible",
          ])
          update({
            sizingStrategy: "", extractionInstructions: "", managementStrategy: "", deletionStrategy: "",
            rangeEntryPct: "50", entryIfFavorable: false,
            minConfidence: "0",
            tradingHoursEnabled: false, tradingHoursStart: "8", tradingHoursEnd: "22",
            tradingHoursDays: ["MON","TUE","WED","THU","FRI"],
            ecoCalendarEnabled: false, ecoCalendarWindow: "30", ecoCalendarStrategy: "",
            communityVisible: false,
          }); break
      }
    } catch { /* non-blocking */ }
    setStep(s => Math.max(s - 1, 0))
  }

  const props: StepProps = { data, update, onNext: goNext, onBack: goBack, jumpTo }

  return (
    <div className="w-full mx-auto max-w-xl">
      <StepIndicator current={step} />
      <div key={step} className="step-enter">
        {step === 0 && <TelegramStep {...props} />}
        {step === 1 && <MT5Step      {...props} />}
        {step === 2 && <RulesStep    {...props} />}
        {step === 3 && <PaymentStep  {...props} />}
        {step === 4 && <LaunchStep   {...props} />}
      </div>
    </div>
  )
}
