"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Users, Star, UserPlus, UserMinus, Loader2,
  TrendingUp, TrendingDown, Search, RefreshCw, BookMarked,
} from "lucide-react"
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts"
import { useDashboard } from "@/src/components/dashboard/DashboardContext"
import { api, type CommunityGroup, type CommunityGroupDetail, type CommunityFollow } from "@/src/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtProfit(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return (v >= 0 ? "+" : "") + "$" + Math.abs(v).toFixed(2)
}

// ── Score badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score, label }: { score: number | null; label: string }) {
  if (score === null) return <span className="text-xs text-white/25">{label}</span>
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

// ── Win rate bar ──────────────────────────────────────────────────────────────

function WinBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-xs text-white/25">—</span>
  const color = rate >= 60 ? "#10b981" : rate >= 45 ? "#f59e0b" : "#ef4444"
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${rate}%`, background: color }} />
      </div>
      <span className="text-xs font-mono text-white/55">{rate.toFixed(1)}%</span>
    </div>
  )
}

// ── Group list card ───────────────────────────────────────────────────────────

function GroupCard({
  group, selected, onSelect, userId, onFollowToggle,
}: {
  group: CommunityGroup
  selected: boolean
  onSelect: () => void
  userId: string | undefined
  onFollowToggle: (token: string, state: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [following, setFollowing] = useState(group.is_following)

  const handleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!userId) return
    setBusy(true)
    try {
      if (following) {
        await api.unfollowCommunityGroup(group.token, userId)
        setFollowing(false)
        onFollowToggle(group.token, false)
      } else {
        await api.followCommunityGroup(group.token, userId)
        setFollowing(true)
        onFollowToggle(group.token, true)
      }
    } catch { /* ignore */ }
    finally { setBusy(false) }
  }

  return (
    <div
      onClick={onSelect}
      className={`px-4 py-3.5 cursor-pointer transition-all border-b border-white/[0.04] hover:bg-white/[0.02] ${
        selected ? "border-l-2 border-l-emerald-500" : ""
      }`}
      style={selected ? { background: "rgba(16,185,129,0.04)" } : {}}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-white truncate">{group.alias}</span>
            <ScoreBadge score={group.score} label={group.label} />
          </div>
          <div className="flex items-center gap-3 mt-2">
            <WinBar rate={group.win_rate} />
            <span className="text-xs text-white/30">{group.trade_count} trades</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-white/40">P&L: <span className={group.total_profit >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtProfit(group.total_profit)}</span></span>
            {group.profit_factor && (
              <span className="text-xs text-white/40">PF: <span className="text-white/60">{group.profit_factor.toFixed(2)}</span></span>
            )}
          </div>
        </div>

        <button
          onClick={handleFollow}
          disabled={busy || !userId}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-40 ${
            following
              ? "text-white/40 border-white/[0.10] hover:text-red-400 hover:border-red-500/20"
              : "text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/10"
          }`}
        >
          {busy
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : following ? <UserMinus className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />
          }
          {following ? "Unfollow" : "Follow"}
        </button>
      </div>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ token, userId }: { token: string; userId: string | undefined }) {
  const [detail, setDetail] = useState<CommunityGroupDetail | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getCommunityGroup(token, userId)
      setDetail(res)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [token, userId])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center h-full py-20">
      <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
    </div>
  )

  if (!detail) return (
    <div className="text-center py-20 text-sm text-white/25">Failed to load details</div>
  )

  const ts = detail.trade_stats
  const equityData = (detail.equity_curve ?? []).map(p => ({
    day: new Date(p.day).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    pnl: p.cumulative_pnl,
  }))

  return (
    <div className="p-5 space-y-5 h-full overflow-y-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-white">{detail.alias}</h3>
          <div className="flex items-center gap-2 mt-1">
            <ScoreBadge score={detail.score} label={detail.label} />
            <span className="text-xs text-white/30">{detail.trade_count} trades total</span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      {ts && (
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: "Win rate",       value: ts.win_rate !== null ? `${ts.win_rate.toFixed(1)}%` : "—",
              accent: ts.win_rate !== null && ts.win_rate >= 55 ? "text-emerald-400" : "text-amber-400" },
            { label: "Profit factor",  value: ts.profit_factor !== null ? ts.profit_factor.toFixed(2) : "—",
              accent: ts.profit_factor !== null && ts.profit_factor > 1 ? "text-emerald-400" : "text-red-400" },
            { label: "Total P&L",      value: fmtProfit(ts.total_profit),
              accent: (ts.total_profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400" },
            { label: "Avg win",        value: ts.avg_win !== null ? `+$${ts.avg_win.toFixed(2)}` : "—",
              accent: "text-emerald-400" },
            { label: "Avg loss",       value: ts.avg_loss !== null ? `-$${Math.abs(ts.avg_loss).toFixed(2)}` : "—",
              accent: "text-red-400" },
            { label: "Max consec. losses", value: String(ts.max_consecutive_losses ?? "—"),
              accent: "text-amber-400" },
          ].map(({ label, value, accent }) => (
            <div key={label} className="rounded-xl border border-white/[0.06] px-3 py-2.5"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className={`text-sm font-black ${accent}`}>{value}</p>
              <p className="text-[10px] text-white/30 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Equity chart */}
      {equityData.length > 1 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold mb-3">Equity curve</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="commGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.2)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.2)" }} tickLine={false} axisLine={false} width={45} />
                <Tooltip
                  contentStyle={{ background: "#0b0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 11 }}
                  labelStyle={{ color: "rgba(255,255,255,0.4)" }}
                  itemStyle={{ color: "#10b981" }}
                />
                <Area type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2} fill="url(#commGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent trades */}
      {(detail.recent_trades?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold mb-3">Recent trades</p>
          <div className="space-y-1.5">
            {detail.recent_trades.slice(0, 8).map((t, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-white/[0.05]"
                style={{ background: "rgba(255,255,255,0.02)" }}>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                  t.order_type === "BUY"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border-red-500/20"
                }`}>{t.order_type}</span>
                <span className="text-xs font-bold text-white/70">{t.symbol}</span>
                <span className={`text-xs font-mono ml-auto ${(t.profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {t.profit !== null ? ((t.profit >= 0 ? "+" : "") + "$" + Math.abs(t.profit).toFixed(2)) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Follow card ───────────────────────────────────────────────────────────────

function FollowCard({
  follow, selected, onSelect, userId, onUnfollowed,
}: {
  follow: CommunityFollow
  selected: boolean
  onSelect: () => void
  userId: string | undefined
  onUnfollowed: () => void
}) {
  const [busy, setBusy] = useState(false)

  const handleUnfollow = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!userId) return
    setBusy(true)
    try {
      await api.unfollowCommunityGroup(follow.token, userId)
      onUnfollowed()
    } catch { /* ignore */ }
    finally { setBusy(false) }
  }

  const followedDate = new Date(follow.followed_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })

  return (
    <div
      onClick={onSelect}
      className={`px-4 py-3.5 cursor-pointer transition-all border-b border-white/[0.04] hover:bg-white/[0.02] ${
        selected ? "border-l-2 border-l-emerald-500" : ""
      }`}
      style={selected ? { background: "rgba(16,185,129,0.04)" } : {}}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-white truncate">{follow.alias}</span>
            <ScoreBadge score={follow.score} label={follow.label} />
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <WinBar rate={follow.win_rate} />
            <span className="text-xs text-white/30">{follow.trade_count} trades</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-white/40">
              P&L: <span className={(follow.total_profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}>
                {fmtProfit(follow.total_profit)}
              </span>
            </span>
            <span className="text-[10px] text-white/25">Since {followedDate}</span>
          </div>
        </div>
        <button
          onClick={handleUnfollow}
          disabled={busy || !userId}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border text-white/40 border-white/[0.10] hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserMinus className="w-3 h-3" />}
          Unfollow
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CommunityPage() {
  const { user } = useDashboard()
  const [groups, setGroups]         = useState<CommunityGroup[]>([])
  const [loading, setLoading]       = useState(false)
  const [selected, setSelected]     = useState<string | null>(null)
  const [search, setSearch]         = useState("")
  const [mainTab, setMainTab]       = useState<"discover" | "following">("discover")
  const [follows, setFollows]       = useState<CommunityFollow[]>([])
  const [followsLoading, setFollowsLoading] = useState(false)

  const loadFollows = useCallback(async () => {
    if (!user?.user_id) return
    setFollowsLoading(true)
    try {
      const res = await api.listCommunityFollows(user.user_id)
      setFollows(res.following)
    } catch { /* ignore */ }
    finally { setFollowsLoading(false) }
  }, [user?.user_id])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listCommunityGroups(user?.user_id)
      setGroups(res.groups)
      if (res.groups.length > 0 && !selected) setSelected(res.groups[0].token)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [user?.user_id, selected])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (mainTab === "following") loadFollows() }, [mainTab, loadFollows])

  const handleFollowToggle = (token: string, state: boolean) => {
    setGroups(prev => prev.map(g => g.token === token ? { ...g, is_following: state } : g))
  }

  const filtered = groups.filter(g =>
    search === "" || g.alias.toLowerCase().includes(search.toLowerCase())
  )

  const selectedGroup = groups.find(g => g.token === selected)

  return (
    <div className="h-full flex flex-col">

      {/* Page header */}
      <div className="px-6 py-4 border-b border-white/[0.06]">
        <h2 className="text-xl font-black text-white">Community</h2>
        <p className="text-sm text-white/35 mt-0.5">
          Discover and follow top-performing signal rooms
        </p>
      </div>

      {/* Content: 2-panel layout */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: group list */}
        <div className="w-[320px] shrink-0 flex flex-col border-r border-white/[0.06]">

          {/* Tab switcher */}
          <div className="flex gap-0 border-b border-white/[0.06]">
            {([
              { key: "discover",  label: "Discover",    Icon: Search },
              { key: "following", label: "My Following", Icon: BookMarked },
            ] as const).map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setMainTab(key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold border-b-2 transition-all ${
                  mainTab === key
                    ? "border-emerald-500 text-emerald-400"
                    : "border-transparent text-white/35 hover:text-white/55"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {key === "following" && follows.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-bold">
                    {follows.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {mainTab === "discover" && (
            <>
              {/* Search + refresh */}
              <div className="p-3 border-b border-white/[0.06] flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search rooms…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-xl text-xs text-white placeholder:text-white/25 focus:outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                  />
                </div>
                <button onClick={load} disabled={loading} className="px-2.5 rounded-xl text-white/30 hover:text-white/60 transition-colors border border-white/[0.08]"
                  style={{ background: "rgba(255,255,255,0.03)" }}>
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading && groups.length === 0 ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-12 text-sm text-white/25">
                    {search ? "No rooms match your search" : "No community rooms yet"}
                  </div>
                ) : filtered.map(g => (
                  <GroupCard
                    key={g.token}
                    group={g}
                    selected={selected === g.token}
                    onSelect={() => setSelected(g.token)}
                    userId={user?.user_id}
                    onFollowToggle={handleFollowToggle}
                  />
                ))}
              </div>

              {groups.length > 0 && (
                <div className="px-4 py-3 border-t border-white/[0.06] text-xs text-white/25">
                  Following {groups.filter(g => g.is_following).length} of {groups.length} rooms
                </div>
              )}
            </>
          )}

          {mainTab === "following" && (
            <div className="flex-1 overflow-y-auto">
              {followsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                </div>
              ) : follows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
                  <TrendingUp className="w-7 h-7 text-white/10" />
                  <p className="text-sm text-white/25">Not following any rooms yet</p>
                  <p className="text-xs text-white/15">Switch to Discover to find and follow signal rooms</p>
                </div>
              ) : follows.map(f => (
                <FollowCard
                  key={f.token}
                  follow={f}
                  selected={selected === f.token}
                  onSelect={() => setSelected(f.token)}
                  userId={user?.user_id}
                  onUnfollowed={loadFollows}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-hidden">
          {selected ? (
            <DetailPanel token={selected} userId={user?.user_id} key={selected} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <Users className="w-6 h-6 text-white/20" />
              </div>
              <p className="text-sm text-white/30">Select a room to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
