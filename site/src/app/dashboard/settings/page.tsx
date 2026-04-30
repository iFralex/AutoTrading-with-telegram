"use client"

import { useState, useEffect } from "react"
import {
  ShieldAlert, Pencil, Check, Play, Pause, Trash2,
  Loader2, AlertTriangle, Server,
} from "lucide-react"
import { useDashboard } from "@/src/components/dashboard/DashboardContext"
import { api } from "@/src/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder:text-white/20 focus:outline-none transition-all"
const inputStyle = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
const labelCls = "block text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-1.5"

type Period = "daily" | "weekly" | "monthly" | "custom"

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, description, icon: Icon, children, accent }: {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  accent?: "red"
}) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${
      accent === "red" ? "border-red-500/20" : "border-white/[0.08]"
    }`}
      style={{ background: accent === "red" ? "rgba(239,68,68,0.03)" : "rgba(255,255,255,0.03)" }}>
      <div className={`flex items-start gap-3 px-5 py-4 border-b ${
        accent === "red" ? "border-red-500/10" : "border-white/[0.06]"
      }`}>
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${accent === "red" ? "text-red-400" : "text-white/40"}`} />
        <div>
          <p className={`text-sm font-bold ${accent === "red" ? "text-red-400" : "text-white"}`}>{title}</p>
          <p className="text-xs text-white/35 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  )
}

// ── Drawdown protection ───────────────────────────────────────────────────────

function DrawdownSection({ userId }: { userId: string }) {
  const [status, setStatus] = useState<{
    paused: boolean; threshold: number | null; period: Period; period_days: number; strategy: string | null
  } | null>(null)
  const [loading, setLoading]   = useState(false)
  const [editing, setEditing]   = useState(false)
  const [draftPct, setDraftPct] = useState("")
  const [draftPeriod, setDraftPeriod] = useState<Period>("daily")
  const [draftDays, setDraftDays]     = useState(7)
  const [draftStrategy, setDraftStrategy] = useState("")
  const [saving, setSaving]     = useState(false)
  const [saveErr, setSaveErr]   = useState<string | null>(null)
  const [saved, setSaved]       = useState(false)
  const [resuming, setResuming] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.getDrawdownStatus(userId)
      .then(res => setStatus(res))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [userId])

  const startEdit = () => {
    setDraftPct(status?.threshold != null ? String(status.threshold) : "")
    setDraftPeriod(status?.period ?? "daily")
    setDraftDays(status?.period_days ?? 7)
    setDraftStrategy(status?.strategy ?? "")
    setSaveErr(null)
    setEditing(true)
  }

  const save = async () => {
    const pct = draftPct.trim() === "" ? null : parseFloat(draftPct)
    if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) {
      setSaveErr("Enter a value between 0 and 100")
      return
    }
    setSaving(true)
    setSaveErr(null)
    try {
      await api.updateDrawdownSettings(userId, {
        drawdown_alert_pct:   pct,
        drawdown_period:      draftPeriod,
        drawdown_period_days: draftPeriod === "custom" ? Math.max(1, draftDays) : undefined,
        drawdown_strategy:    draftStrategy.trim() || null,
      })
      setStatus(prev => ({
        paused:      prev?.paused ?? false,
        threshold:   pct,
        period:      draftPeriod,
        period_days: draftPeriod === "custom" ? draftDays : (prev?.period_days ?? 1),
        strategy:    draftStrategy.trim() || null,
      }))
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Failed to save")
    } finally { setSaving(false) }
  }

  const resume = async () => {
    setResuming(true)
    try {
      await api.resumeDrawdown(userId)
      setStatus(prev => prev ? { ...prev, paused: false } : null)
    } catch { /* ignore */ }
    finally { setResuming(false) }
  }

  if (loading) return <div className="py-4"><Loader2 className="w-5 h-5 text-emerald-400 animate-spin" /></div>

  return (
    <div className="space-y-4">

      {/* Paused alert */}
      {status?.paused && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-500/25"
          style={{ background: "rgba(239,68,68,0.08)" }}>
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="flex-1 text-xs text-red-300">
            Trading is <span className="font-bold">suspended</span> — drawdown threshold reached. Resume when ready.
          </p>
          <button
            onClick={resume}
            disabled={resuming}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black disabled:opacity-50 transition-all"
            style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
          >
            {resuming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Resume
          </button>
        </div>
      )}

      {/* Current settings */}
      {!editing ? (
        <div className="flex items-start gap-3">
          <div className="flex-1 rounded-xl border border-white/[0.06] px-4 py-3 font-mono text-sm"
            style={{ background: "rgba(0,0,0,0.15)" }}>
            {status?.threshold ? (
              <div className="space-y-1">
                <p className="text-white/70">
                  Threshold: <span className="text-white font-bold">{status.threshold}%</span>
                  {" · "}
                  <span className="text-white/55 capitalize">{
                    status.period === "custom"
                      ? `Last ${status.period_days} days`
                      : status.period
                  }</span>
                </p>
                {status.strategy && (
                  <p className="text-xs text-white/30 truncate">Strategy: {status.strategy}</p>
                )}
              </div>
            ) : (
              <span className="text-white/25 italic">Disabled</span>
            )}
          </div>
          <button
            onClick={startEdit}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-white/40 hover:text-white/70 border border-white/[0.08] hover:border-white/[0.16] transition-all mt-0"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            {saved ? <><Check className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">Saved</span></> : <><Pencil className="w-3.5 h-3.5" /> Edit</>}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Drawdown threshold (%)</label>
              <input
                type="number" min={0} max={100} step={0.5}
                value={draftPct}
                onChange={e => setDraftPct(e.target.value)}
                placeholder="e.g. 5 (empty = disabled)"
                className={inputCls} style={inputStyle}
              />
            </div>
            <div>
              <label className={labelCls}>Period</label>
              <select
                value={draftPeriod}
                onChange={e => setDraftPeriod(e.target.value as Period)}
                className={inputCls} style={inputStyle}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom (days)</option>
              </select>
            </div>
          </div>

          {draftPeriod === "custom" && (
            <div>
              <label className={labelCls}>Custom period (days)</label>
              <input
                type="number" min={1} max={365} value={draftDays}
                onChange={e => setDraftDays(parseInt(e.target.value) || 7)}
                className={inputCls} style={inputStyle}
              />
            </div>
          )}

          <div>
            <label className={labelCls}>Strategy when triggered (optional)</label>
            <textarea
              rows={2}
              value={draftStrategy}
              onChange={e => setDraftStrategy(e.target.value)}
              placeholder="e.g. Close all positions and pause until manually resumed…"
              className={`${inputCls} resize-none`} style={inputStyle}
            />
          </div>

          {saveErr && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {saveErr}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-black disabled:opacity-40 transition-all"
              style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-4 py-2 rounded-xl text-sm text-white/35 hover:text-white/60 border border-white/[0.08] transition-all"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Danger zone ───────────────────────────────────────────────────────────────

function DangerZone({ userId, phone, onDeleted }: {
  userId: string; phone: string; onDeleted: () => void
}) {
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleReset = async () => {
    setResetLoading(true)
    setErr(null)
    try {
      await api.resetUserStats(userId)
      setResetConfirm(false)
      window.location.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reset failed")
    } finally { setResetLoading(false) }
  }

  const handleDelete = async () => {
    setDeleteLoading(true)
    setErr(null)
    try {
      await api.deleteUser(userId)
      try { await api.deleteSession(phone) } catch { /* best-effort */ }
      sessionStorage.removeItem("sf_phone")
      onDeleted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Deletion failed")
    } finally { setDeleteLoading(false) }
  }

  return (
    <div className="space-y-4">
      {err && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {err}
        </p>
      )}

      {/* Reset stats */}
      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold text-white/70">Reset statistics</p>
          <p className="text-xs text-white/35 mt-0.5">
            Delete all signal logs and trade history. Settings, strategies, and credentials are preserved.
          </p>
        </div>
        {!resetConfirm ? (
          <button
            onClick={() => setResetConfirm(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-red-400 border border-red-500/25 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" /> Reset statistics
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-red-300 font-medium">This action is irreversible. Confirm?</p>
            <button
              onClick={handleReset}
              disabled={resetLoading}
              className="flex items-center gap-1 text-xs font-bold text-white bg-red-600 hover:bg-red-500 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {resetLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {resetLoading ? "Resetting…" : "Confirm reset"}
            </button>
            <button
              onClick={() => setResetConfirm(false)}
              disabled={resetLoading}
              className="text-xs text-white/35 hover:text-white/60 border border-white/[0.08] px-3 py-1.5 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="h-px bg-white/[0.05]" />

      {/* Delete account */}
      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold text-red-400">Delete account</p>
          <p className="text-xs text-white/35 mt-0.5">
            Permanently removes your account, Telegram session, MT5 credentials, all logs, and backtests.
            This cannot be undone.
          </p>
        </div>
        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-xs font-bold text-red-500 border border-red-600/40 hover:bg-red-600/10 px-3 py-1.5 rounded-lg transition-all"
            style={{ background: "rgba(239,68,68,0.05)" }}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete account and all data
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-red-300 font-medium">
              This will permanently delete <span className="text-red-200 font-bold">{phone}</span> and all associated data.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="flex items-center gap-1.5 text-xs font-bold text-white bg-red-700 hover:bg-red-600 px-4 py-1.5 rounded-lg transition-colors border border-red-600 disabled:opacity-50"
              >
                {deleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {deleteLoading ? "Deleting…" : "Yes, delete everything"}
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                disabled={deleteLoading}
                className="text-xs text-white/35 hover:text-white/60 border border-white/[0.08] px-3 py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user, phone, setPhone } = useDashboard()

  const handleDeleted = () => {
    setPhone("")
    window.location.href = "/"
  }

  if (!user) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-white/30">Connect your account to view settings.</p>
    </div>
  )

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-black text-white">Account Settings</h2>
        <p className="text-sm text-white/35 mt-0.5">Manage drawdown protection and account preferences</p>
      </div>

      {/* MT5 Account */}
      <Section title="MT5 Account" description="Your connected trading account" icon={Server}>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: "Login", value: user.mt5_login ? String(user.mt5_login) : "—" },
            { label: "Server", value: user.mt5_server ?? "—" },
            { label: "Phone", value: user.phone },
            { label: "Member since", value: new Date(user.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className={labelCls}>{label}</p>
              <p className="text-sm font-mono text-white/65 truncate">{value}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Drawdown protection */}
      <Section
        title="Drawdown Protection"
        description="Automatically pause trading if losses exceed your threshold"
        icon={ShieldAlert}
      >
        <DrawdownSection userId={user.user_id} />
      </Section>

      {/* Danger zone */}
      <Section
        title="Danger Zone"
        description="Irreversible actions — proceed with caution"
        icon={AlertTriangle}
        accent="red"
      >
        <DangerZone userId={user.user_id} phone={phone} onDeleted={handleDeleted} />
      </Section>
    </div>
  )
}
