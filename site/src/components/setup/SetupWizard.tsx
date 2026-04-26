"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { api, ApiError, type SetupSession, type Group, type MT5Account, type VerifyCodeResponse } from "@/src/lib/api"

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
  { field: "extractionInstructions", label: "AI extraction instructions",   minPlan: "pro"   },
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
  mt5Server: "", mt5AccountName: "", sizingStrategy: "",
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
      update({ mt5AccountName: res.account.name })
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

function RulesStep({ data, update, onNext, onBack }: StepProps) {
  const [showAdv, setShowAdv] = useState(false)

  return (
    <div className={`${card} p-8`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-400/10 border border-amber-400/20">
          <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div>
          <h3 className="font-bold text-white">AI &amp; risk rules</h3>
          <p className="text-xs text-white/40">Tell the AI how to size and manage your trades</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Sizing — Core */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">Position sizing</span>
            <span className="text-emerald-400 text-xs normal-case font-normal">Required</span>
            <PlanBadge plan="core" />
          </div>
          <TA id="sizing" value={data.sizingStrategy} onChange={v => update({ sizingStrategy: v })} placeholder={"Example: " + SIZING_EX[0]} />
          <p className="text-xs text-white/22 mt-1.5">The AI uses this with your account balance, equity, and leverage to calculate lot size at each signal.</p>
          <div className="space-y-1.5 mt-2">
            {SIZING_EX.map(p => <Preset key={p} text={p} onClick={() => update({ sizingStrategy: p })} />)}
          </div>
        </div>

        {/* Range entry — Core */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">Range entry position</span>
            <span className="text-white/25 text-xs normal-case font-normal">Optional</span>
            <PlanBadge plan="core" />
          </div>
          <div className="flex items-center gap-4">
            <input type="range" min={0} max={100} step={5} value={Number(data.rangeEntryPct)}
              onChange={e => update({ rangeEntryPct: e.target.value })}
              className="flex-1 accent-emerald-400 cursor-pointer" />
            <span className="text-sm font-mono text-white/55 w-10 text-right shrink-0">{data.rangeEntryPct}%</span>
          </div>
          <p className="text-xs text-white/22 mt-1.5">Where to place a limit order within the signal&apos;s entry range. 0% = bottom, 50% = middle, 100% = top.</p>
        </div>

        {/* Entry if favorable — Core */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">Market entry if price is favorable</span>
            <PlanBadge plan="core" />
          </div>
          <div className="space-y-1.5">
            {([
              { val: false, label: "Disabled", desc: "Always place a pending order at the target price" },
              { val: true,  label: "Enabled",  desc: "Enter at market immediately if price is already past the entry target" },
            ] as const).map(opt => (
              <button key={String(opt.val)} type="button" onClick={() => update({ entryIfFavorable: opt.val })}
                className={`w-full text-left rounded-xl border px-4 py-2.5 transition-all ${
                  data.entryIfFavorable === opt.val
                    ? "border-emerald-400/25 bg-emerald-400/[0.06] text-white"
                    : "border-white/8 text-white/40 hover:border-white/15 hover:text-white/65"
                }`}>
                <span className="text-xs font-semibold">{opt.label}</span>
                <span className="block text-[11px] text-white/30 mt-0.5">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdv(v => !v)}
          className="w-full flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/8 px-4 py-3 text-sm text-white/45 hover:text-white/70 hover:bg-white/[0.04] transition-all"
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 text-white/28" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" />
            </svg>
            Advanced rules
            <span className="text-xs text-white/22">— Pro &amp; Elite</span>
          </span>
          <svg className={`w-4 h-4 transition-transform ${showAdv ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showAdv && (
          <div className="space-y-6 pt-1">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">AI extraction instructions</span>
                <span className="text-white/25 text-xs normal-case font-normal">Optional</span>
                <PlanBadge plan="pro" />
              </div>
              <TA id="extract" value={data.extractionInstructions} onChange={v => update({ extractionInstructions: v })} placeholder={"Example: " + EXTRACT_EX[0]} />
              <p className="text-xs text-white/22 mt-1.5">Injected into the AI signal parsing prompt. Use to normalize broker symbol names.</p>
              <div className="space-y-1.5 mt-2">{EXTRACT_EX.map(p => <Preset key={p} text={p} onClick={() => update({ extractionInstructions: p })} />)}</div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">Position management</span>
                <span className="text-white/25 text-xs normal-case font-normal">Optional</span>
                <PlanBadge plan="elite" />
              </div>
              <TA id="mgmt" value={data.managementStrategy} onChange={v => update({ managementStrategy: v })} placeholder={"Example: " + MGMT_EX[0]} />
              <p className="text-xs text-white/22 mt-1.5">How the AI manages open trades: break-even, trailing stop, partial close, etc.</p>
              <div className="space-y-1.5 mt-2">{MGMT_EX.map(p => <Preset key={p} text={p} onClick={() => update({ managementStrategy: p })} />)}</div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">When a signal is deleted</span>
                <span className="text-white/25 text-xs normal-case font-normal">Optional</span>
                <PlanBadge plan="elite" />
              </div>
              <div className="rounded-xl bg-amber-500/8 border border-amber-500/15 px-4 py-3 text-xs text-amber-300/75 mb-3 leading-relaxed">
                Signal rooms often delete messages to hide bad trades. Define what the AI should do when that happens.
              </div>
              <TA id="deletion" value={data.deletionStrategy} onChange={v => update({ deletionStrategy: v })} placeholder={"Example: " + DELETION_EX[0]} />
              <div className="space-y-1.5 mt-2">{DELETION_EX.map(p => <Preset key={p} text={p} onClick={() => update({ deletionStrategy: p })} />)}</div>
            </div>

            {/* AI confidence threshold — Pro */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">AI confidence threshold</span>
                <span className="text-white/25 text-xs normal-case font-normal">Optional</span>
                <PlanBadge plan="pro" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  <input type="range" min={0} max={100} step={10} value={Number(data.minConfidence)}
                    onChange={e => update({ minConfidence: e.target.value })}
                    className="flex-1 accent-emerald-400 cursor-pointer" />
                  <span className="text-sm font-mono text-white/55 w-10 text-right shrink-0">{data.minConfidence}</span>
                </div>
                <p className="text-xs text-white/28 italic">
                  {Number(data.minConfidence) === 0
                    ? "0 — Accept all signals regardless of AI confidence"
                    : Number(data.minConfidence) >= 80
                    ? `${data.minConfidence} — Only very clear, high-confidence signals`
                    : `${data.minConfidence} — Discard low-confidence signals`}
                </p>
              </div>
            </div>

            {/* Trading hours filter — Elite */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">Trading hours filter</span>
                <PlanBadge plan="elite" />
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  {([
                    { val: false, label: "Disabled", desc: "Execute signals 24/7 without restrictions" },
                    { val: true,  label: "Enabled",  desc: "Block signals outside the configured time window" },
                  ] as const).map(opt => (
                    <button key={String(opt.val)} type="button" onClick={() => update({ tradingHoursEnabled: opt.val })}
                      className={`w-full text-left rounded-xl border px-4 py-2.5 transition-all ${
                        data.tradingHoursEnabled === opt.val
                          ? "border-amber-400/25 bg-amber-400/[0.05] text-white"
                          : "border-white/8 text-white/40 hover:border-white/15 hover:text-white/65"
                      }`}>
                      <span className="text-xs font-semibold">{opt.label}</span>
                      <span className="block text-[11px] text-white/30 mt-0.5">{opt.desc}</span>
                    </button>
                  ))}
                </div>
                {data.tradingHoursEnabled && (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="text-xs text-white/30 mb-1.5 block">Start (UTC)</label>
                        <input type="number" min={0} max={23} value={data.tradingHoursStart}
                          onChange={e => update({ tradingHoursStart: String(Math.min(23, Math.max(0, Number(e.target.value)))) })}
                          className={inp} />
                      </div>
                      <div className="pt-5 text-white/25 text-sm shrink-0">→</div>
                      <div className="flex-1">
                        <label className="text-xs text-white/30 mb-1.5 block">End (UTC)</label>
                        <input type="number" min={0} max={23} value={data.tradingHoursEnd}
                          onChange={e => update({ tradingHoursEnd: String(Math.min(23, Math.max(0, Number(e.target.value)))) })}
                          className={inp} />
                      </div>
                    </div>
                    <p className="text-xs text-white/22 -mt-1">
                      {Number(data.tradingHoursStart) <= Number(data.tradingHoursEnd)
                        ? `Allowed ${data.tradingHoursStart.padStart(2,"0")}:00–${data.tradingHoursEnd.padStart(2,"0")}:59 UTC`
                        : `Overnight: ${data.tradingHoursStart.padStart(2,"0")}:00–${data.tradingHoursEnd.padStart(2,"0")}:59 UTC (+1d)`}
                    </p>
                    <div>
                      <p className="text-xs text-white/30 mb-2">Active days</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(["MON","TUE","WED","THU","FRI","SAT","SUN"] as const).map(day => {
                          const sel = data.tradingHoursDays.includes(day)
                          const labels: Record<string, string> = { MON:"Mon",TUE:"Tue",WED:"Wed",THU:"Thu",FRI:"Fri",SAT:"Sat",SUN:"Sun" }
                          return (
                            <button key={day} type="button"
                              onClick={() => update({ tradingHoursDays: sel
                                ? data.tradingHoursDays.filter(d => d !== day)
                                : [...data.tradingHoursDays, day] })}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                                sel ? "border-amber-400/25 bg-amber-400/[0.08] text-amber-300"
                                    : "border-white/8 text-white/30 hover:border-white/15 hover:text-white/60"
                              }`}>
                              {labels[day]}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Economic calendar — Elite */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">Economic calendar filter</span>
                <PlanBadge plan="elite" />
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  {([
                    { val: false, label: "Disabled", desc: "Does not check the economic calendar" },
                    { val: true,  label: "Enabled",  desc: "Adjusts signals near high-impact macro events (ForexFactory)" },
                  ] as const).map(opt => (
                    <button key={String(opt.val)} type="button" onClick={() => update({ ecoCalendarEnabled: opt.val })}
                      className={`w-full text-left rounded-xl border px-4 py-2.5 transition-all ${
                        data.ecoCalendarEnabled === opt.val
                          ? "border-amber-400/25 bg-amber-400/[0.05] text-white"
                          : "border-white/8 text-white/40 hover:border-white/15 hover:text-white/65"
                      }`}>
                      <span className="text-xs font-semibold">{opt.label}</span>
                      <span className="block text-[11px] text-white/30 mt-0.5">{opt.desc}</span>
                    </button>
                  ))}
                </div>
                {data.ecoCalendarEnabled && (
                  <>
                    <div>
                      <label className="text-xs text-white/30 mb-1.5 block">Event window (minutes before/after)</label>
                      <div className="flex items-center gap-2">
                        <input type="number" min={5} max={120} value={data.ecoCalendarWindow}
                          onChange={e => update({ ecoCalendarWindow: String(Math.min(120, Math.max(5, Number(e.target.value)))) })}
                          className={`${inp} w-24`} />
                        <span className="text-xs text-white/30">min (5–120)</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-white/30 mb-1.5 block">AI strategy during event <span className="text-white/20">(optional)</span></label>
                      <TA id="eco-strategy" value={data.ecoCalendarStrategy}
                        onChange={v => update({ ecoCalendarStrategy: v })}
                        placeholder="Example: Reduce lot size to 50% and widen SL" />
                      <p className="text-xs text-white/22 mt-1.5">If set, the AI applies this strategy instead of blocking the signal.</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Community visibility — Elite */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-white/45 uppercase tracking-wider">Signal room visibility</span>
                <PlanBadge plan="elite" />
              </div>
              <div className="space-y-1.5">
                {([
                  { val: false, label: "Private", desc: "Your signal room is not listed in the community" },
                  { val: true,  label: "Public",  desc: "Elite users can discover and follow your signal room" },
                ] as const).map(opt => (
                  <button key={String(opt.val)} type="button" onClick={() => update({ communityVisible: opt.val })}
                    className={`w-full text-left rounded-xl border px-4 py-2.5 transition-all ${
                      data.communityVisible === opt.val
                        ? "border-amber-400/25 bg-amber-400/[0.05] text-white"
                        : "border-white/8 text-white/40 hover:border-white/15 hover:text-white/65"
                    }`}>
                    <span className="text-xs font-semibold">{opt.label}</span>
                    <span className="block text-[11px] text-white/30 mt-0.5">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <GhostBtn onClick={onBack}>← Back</GhostBtn>
          <PrimaryBtn onClick={onNext} disabled={!data.sizingStrategy.trim()} className="flex-1">Continue →</PrimaryBtn>
        </div>
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
    { label: "AI extraction rules",         value: "Configured",                                                     minPlan: "pro"   as PlanId, show: !!data.extractionInstructions },
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
// Main wizard
// ════════════════════════════════════════════════════════════════════════════════

export function SetupWizard() {
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
