"use client"

import { useState, useEffect } from "react"
import {
  ChevronDown, ChevronUp, Plus, Trash2,
  Search, Hash, Loader2, Check, AlertTriangle, ShieldCheck,
} from "lucide-react"
import { useDashboard } from "@/src/components/dashboard/DashboardContext"
import { api, type UserGroup, type TrustScore, type Group } from "@/src/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

function ScoreBadge({ score, label }: { score: number | null; label: string }) {
  if (score === null) return null
  const cls =
    score >= 75 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
    score >= 55 ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
    score >= 35 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                  "bg-red-500/10 text-red-400 border-red-500/20"
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${cls}`}>
      {score} — {label}
    </span>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={`w-9 h-5 rounded-full transition-all shrink-0 ${checked ? "bg-emerald-500" : "bg-white/[0.12]"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      <span className={`block w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  )
}

const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder:text-white/20 focus:outline-none transition-all resize-none"
const inputStyle = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
const labelCls = "block text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-1.5"

// ── Single room card ──────────────────────────────────────────────────────────

function RoomCard({
  group, userId, trustScore, canRemove, onUpdate, onRemove,
}: {
  group: UserGroup
  userId: string
  trustScore: TrustScore | null
  canRemove: boolean
  onUpdate: (updated: UserGroup) => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<"strategy" | "filters" | "community">("strategy")
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Draft state
  const [sizing,    setSizing]    = useState(group.sizing_strategy ?? "")
  const [mgmt,      setMgmt]      = useState(group.management_strategy ?? "")
  const [deletion,  setDeletion]  = useState(group.deletion_strategy ?? "")
  const [entryPct,  setEntryPct]  = useState(String(group.range_entry_pct ?? 0))
  const [entryFav,  setEntryFav]  = useState(group.entry_if_favorable)
  const [thEnabled, setThEnabled] = useState(group.trading_hours_enabled)
  const [thStart,   setThStart]   = useState(String(group.trading_hours_start ?? 0))
  const [thEnd,     setThEnd]     = useState(String(group.trading_hours_end ?? 23))
  const [thDays,    setThDays]    = useState<string[]>(group.trading_hours_days ?? DAY_KEYS)
  const [ecoEnabled, setEcoEnabled] = useState(group.eco_calendar_enabled)
  const [ecoWindow, setEcoWindow]   = useState(String(group.eco_calendar_window ?? 60))
  const [ecoStrategy, setEcoStrategy] = useState(group.eco_calendar_strategy ?? "")
  const [extraction, setExtraction] = useState(group.extraction_instructions ?? "")
  const [minConf, setMinConf] = useState(String(group.min_confidence ?? 0.7))
  const [communityVisible, setCommunityVisible] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setErr(null)
    try {
      await api.updateUserGroup(userId, group.group_id, {
        sizing_strategy:         sizing.trim() || null,
        management_strategy:     mgmt.trim() || null,
        deletion_strategy:       deletion.trim() || null,
        extraction_instructions: extraction.trim() || null,
        min_confidence:          parseFloat(minConf) || 0.7,
        range_entry_pct:         parseFloat(entryPct) || 0,
        entry_if_favorable:   entryFav,
        trading_hours_enabled: thEnabled,
        trading_hours_start:  thEnabled ? parseInt(thStart) || 0 : null,
        trading_hours_end:    thEnabled ? parseInt(thEnd) || 23 : null,
        trading_hours_days:   thEnabled ? thDays : null,
        eco_calendar_enabled: ecoEnabled,
        eco_calendar_window:  ecoEnabled ? parseInt(ecoWindow) || 60 : undefined,
        eco_calendar_strategy: ecoEnabled ? (ecoStrategy.trim() || null) : null,
      })
      onUpdate({
        ...group,
        sizing_strategy:         sizing.trim() || null,
        management_strategy:     mgmt.trim() || null,
        deletion_strategy:       deletion.trim() || null,
        extraction_instructions: extraction.trim() || null,
        min_confidence:          parseFloat(minConf) || 0.7,
        range_entry_pct:         parseFloat(entryPct) || 0,
        entry_if_favorable:   entryFav,
        trading_hours_enabled: thEnabled,
        trading_hours_start:  thEnabled ? (parseInt(thStart) || 0) : null,
        trading_hours_end:    thEnabled ? (parseInt(thEnd) || 23) : null,
        trading_hours_days:   thEnabled ? thDays : null,
        eco_calendar_enabled: ecoEnabled,
        eco_calendar_window:  ecoEnabled ? (parseInt(ecoWindow) || 60) : group.eco_calendar_window,
        eco_calendar_strategy: ecoEnabled ? (ecoStrategy.trim() || null) : null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save")
    } finally { setSaving(false) }
  }

  const handleRemove = async () => {
    setRemoving(true)
    try {
      await api.removeUserGroup(userId, group.group_id)
      onRemove()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to remove room")
      setRemoving(false)
      setRemoveConfirm(false)
    }
  }

  const toggleDay = (day: string) => {
    setThDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] overflow-hidden"
      style={{ background: "rgba(255,255,255,0.03)" }}>

      {/* Room header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-emerald-400"
          style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.15)" }}>
          <Hash className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-white truncate">{group.group_name}</span>
            {trustScore && (
              <ScoreBadge score={trustScore.score} label={trustScore.label} />
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
              group.active
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-white/[0.04] text-white/30 border-white/[0.08]"
            }`}>
              {group.active ? "Active" : "Paused"}
            </span>
          </div>
          <p className="text-xs text-white/30 mt-0.5">
            ID {group.group_id} · {trustScore?.trade_count ?? 0} trades
          </p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-white/25 shrink-0" /> : <ChevronDown className="w-4 h-4 text-white/25 shrink-0" />}
      </button>

      {/* Expanded settings */}
      {expanded && (
        <div className="border-t border-white/[0.06]">

          {/* Tab bar */}
          <div className="flex gap-0 border-b border-white/[0.06] px-5">
            {(["strategy", "filters", "community"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-all capitalize ${
                  tab === t
                    ? "border-emerald-500 text-emerald-400"
                    : "border-transparent text-white/35 hover:text-white/60"
                }`}
              >
                {t === "strategy" ? "Strategy" : t === "filters" ? "Filters" : "Community"}
              </button>
            ))}
          </div>

          <div className="px-5 py-5 space-y-5">

            {/* ── Strategy tab ───────────────────────────────────────────── */}
            {tab === "strategy" && (
              <>
                <div>
                  <label className={labelCls}>Sizing strategy</label>
                  <textarea
                    rows={3}
                    value={sizing}
                    onChange={e => setSizing(e.target.value)}
                    placeholder="e.g. Always use 0.1 lots. Scale with account balance…"
                    className={inputCls}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className={labelCls}>Management strategy</label>
                  <textarea
                    rows={3}
                    value={mgmt}
                    onChange={e => setMgmt(e.target.value)}
                    placeholder="e.g. Move SL to breakeven after 20 pips profit…"
                    className={inputCls}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className={labelCls}>Message deletion strategy</label>
                  <textarea
                    rows={2}
                    value={deletion}
                    onChange={e => setDeletion(e.target.value)}
                    placeholder="e.g. If original signal is deleted, close the position…"
                    className={inputCls}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label className={labelCls}>Extraction instructions</label>
                  <textarea
                    rows={3}
                    value={extraction}
                    onChange={e => setExtraction(e.target.value)}
                    placeholder="e.g. Only extract signals mentioning specific pairs. Ignore update messages."
                    className={inputCls}
                    style={inputStyle}
                  />
                  <p className="text-[10px] text-white/25 mt-1">Custom instructions passed to the signal extraction AI</p>
                </div>
                <div>
                  <label className={labelCls}>
                    Min confidence — {Math.round(parseFloat(minConf || "0") * 100)}%
                  </label>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={minConf}
                    onChange={e => setMinConf(e.target.value)}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-white/20 mt-0.5">
                    <span>0% — execute all signals</span>
                    <span>100% — only high-confidence</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Entry range (%)</label>
                    <input
                      type="number" min={0} max={100} step={1}
                      value={entryPct}
                      onChange={e => setEntryPct(e.target.value)}
                      className={inputCls} style={inputStyle}
                    />
                    <p className="text-[10px] text-white/25 mt-1">Accept entry within N% of signal price</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className={labelCls}>Favorable entry</label>
                    <div className="flex items-center gap-3 pt-1">
                      <Toggle checked={entryFav} onChange={setEntryFav} />
                      <span className="text-xs text-white/40">Enter even if price moved in our favor</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── Filters tab ────────────────────────────────────────────── */}
            {tab === "filters" && (
              <>
                {/* Trading hours */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Trading hours</p>
                      <p className="text-xs text-white/35">Only place orders during specified hours</p>
                    </div>
                    <Toggle checked={thEnabled} onChange={setThEnabled} />
                  </div>

                  {thEnabled && (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>Start (UTC hour)</label>
                          <input
                            type="number" min={0} max={23} value={thStart}
                            onChange={e => setThStart(e.target.value)}
                            className={inputCls} style={inputStyle}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>End (UTC hour)</label>
                          <input
                            type="number" min={0} max={23} value={thEnd}
                            onChange={e => setThEnd(e.target.value)}
                            className={inputCls} style={inputStyle}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>Active days</label>
                        <div className="flex gap-1.5 flex-wrap">
                          {DAYS.map((day, i) => {
                            const key = DAY_KEYS[i]
                            const active = thDays.includes(key)
                            return (
                              <button
                                key={day}
                                onClick={() => toggleDay(key)}
                                className={`w-10 h-8 rounded-lg text-xs font-bold transition-all ${
                                  active
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                                    : "text-white/30 border border-white/[0.08] hover:border-white/[0.16]"
                                }`}
                                style={active ? {} : { background: "rgba(255,255,255,0.03)" }}
                              >{day}</button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Economic calendar */}
                <div className="pt-3 border-t border-white/[0.06] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Economic calendar</p>
                      <p className="text-xs text-white/35">Pause trading around high-impact news events</p>
                    </div>
                    <Toggle checked={ecoEnabled} onChange={setEcoEnabled} />
                  </div>

                  {ecoEnabled && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className={labelCls}>Window (minutes before & after news)</label>
                        <input
                          type="number" min={5} max={240} step={5}
                          value={ecoWindow}
                          onChange={e => setEcoWindow(e.target.value)}
                          className={inputCls} style={inputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Strategy during news window</label>
                        <textarea
                          rows={2}
                          value={ecoStrategy}
                          onChange={e => setEcoStrategy(e.target.value)}
                          placeholder="e.g. Close all positions 30 minutes before high-impact news…"
                          className={inputCls} style={inputStyle}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Community tab ───────────────────────────────────────────── */}
            {tab === "community" && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-amber-400" />
                      <p className="text-sm font-semibold text-white">Visible in community</p>
                    </div>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">
                      Allow other users to discover and follow this room&apos;s performance.
                      Your identity and room details remain private — only performance stats are shown.
                    </p>
                  </div>
                  <Toggle checked={communityVisible} onChange={setCommunityVisible} />
                </div>
                {communityVisible && (
                  <div className="px-4 py-3 rounded-xl border border-emerald-500/20 text-xs text-emerald-400"
                    style={{ background: "rgba(16,185,129,0.05)" }}>
                    This room will appear in the community leaderboard once it has at least 10 trades.
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {err && (
              <div className="flex items-center gap-2 text-xs text-red-400 px-3 py-2 rounded-lg border border-red-500/20"
                style={{ background: "rgba(239,68,68,0.05)" }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {err}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              {canRemove ? (
                !removeConfirm ? (
                  <button
                    onClick={() => setRemoveConfirm(true)}
                    className="flex items-center gap-1.5 text-xs text-red-400/60 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove room
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-300">Remove this room?</span>
                    <button
                      onClick={handleRemove}
                      disabled={removing}
                      className="text-xs font-bold text-white bg-red-600 hover:bg-red-500 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      {removing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Confirm
                    </button>
                    <button
                      onClick={() => setRemoveConfirm(false)}
                      className="text-xs text-white/35 hover:text-white/60 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )
              ) : <div />}

              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-black disabled:opacity-40 transition-all"
                style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
              >
                {saving
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : saved ? <Check className="w-4 h-4" /> : null
                }
                {saving ? "Saving…" : saved ? "Saved!" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add room modal ────────────────────────────────────────────────────────────

function AddRoomCard({ userId, onAdded }: { userId: string; onAdded: (g: UserGroup) => void }) {
  const [open, setOpen]       = useState(false)
  const [groups, setGroups]   = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding]   = useState(false)
  const [search, setSearch]   = useState("")
  const [selected, setSelected] = useState<Group | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const loadGroups = async () => {
    setLoading(true)
    try {
      const res = await api.getAvailableGroups(userId)
      setGroups(res.groups)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  const handleOpen = () => { setOpen(true); loadGroups() }

  const handleAdd = async () => {
    if (!selected) return
    setAdding(true)
    setErr(null)
    try {
      await api.addUserGroup(userId, Number(selected.id), selected.name)
      const res = await api.getUserGroups(userId)
      const added = res.groups.find(g => String(g.group_id) === String(selected.id))
      if (added) onAdded(added)
      setOpen(false)
      setSelected(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add room")
    } finally { setAdding(false) }
  }

  const filtered = groups.filter(g =>
    search === "" || g.name.toLowerCase().includes(search.toLowerCase())
  )

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-dashed border-white/[0.12] hover:border-emerald-500/30 text-white/30 hover:text-emerald-400 transition-all group"
        style={{ background: "rgba(255,255,255,0.01)" }}
      >
        <Plus className="w-4 h-4" />
        <span className="text-sm font-semibold">Add a room</span>
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] overflow-hidden"
      style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]">
        <p className="text-sm font-bold text-white">Add a new room</p>
        <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white/60 transition-colors text-xs">
          Cancel
        </button>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
          <input
            type="text"
            placeholder="Search Telegram groups & channels…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm text-white placeholder:text-white/20 focus:outline-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filtered.map(g => (
              <div
                key={g.id}
                onClick={() => setSelected(g)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all border ${
                  selected?.id === g.id
                    ? "border-emerald-500/25 text-emerald-400"
                    : "border-transparent hover:border-white/[0.08] text-white/55 hover:text-white/75"
                }`}
                style={selected?.id === g.id ? { background: "rgba(16,185,129,0.08)" } : { background: "rgba(255,255,255,0.02)" }}
              >
                <Hash className="w-3.5 h-3.5 shrink-0" />
                <span className="text-sm font-medium truncate">{g.name}</span>
                {g.members && <span className="ml-auto text-xs text-white/25">{g.members.toLocaleString()} members</span>}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-center py-6 text-sm text-white/25">No groups found</p>
            )}
          </div>
        )}

        {err && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {err}
          </p>
        )}

        <button
          onClick={handleAdd}
          disabled={!selected || adding}
          className="w-full py-2.5 rounded-xl text-sm font-bold text-black disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }}
        >
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {adding ? "Adding…" : selected ? `Add "${selected.name}"` : "Select a room first"}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RoomsPage() {
  const { user, reload } = useDashboard()
  const [groups, setGroups]     = useState<UserGroup[]>([])
  const [trustScores, setTrustScores] = useState<Record<number, TrustScore>>({})

  useEffect(() => {
    if (!user) return
    setGroups(user.groups)
    api.getTrustScores(user.user_id).then(res => {
      const map: Record<number, TrustScore> = {}
      for (const s of res.scores) map[s.group_id] = s
      setTrustScores(map)
    }).catch(() => {})
  }, [user])

  const updateGroup  = (updated: UserGroup) => setGroups(prev => prev.map(g => g.group_id === updated.group_id ? updated : g))
  const removeGroup  = (id: number) => setGroups(prev => prev.filter(g => g.group_id !== id))
  const addGroup     = (g: UserGroup) => setGroups(prev => [...prev, g])

  if (!user) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-white/30">Connect your account to manage rooms.</p>
    </div>
  )

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-black text-white">Signal Rooms</h2>
        <p className="text-sm text-white/35 mt-0.5">
          Configure strategy and filters for each Telegram room
        </p>
      </div>

      {groups.map(group => (
        <RoomCard
          key={group.group_id}
          group={group}
          userId={user.user_id}
          trustScore={trustScores[group.group_id] ?? null}
          canRemove={groups.length > 1}
          onUpdate={updateGroup}
          onRemove={() => removeGroup(group.group_id)}
        />
      ))}

      <AddRoomCard userId={user.user_id} onAdded={addGroup} />
    </div>
  )
}
