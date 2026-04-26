"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Users, RefreshCw, TrendingUp, TrendingDown, Minus,
  Star, ChevronDown, ChevronRight, UserPlus, UserMinus,
  AlertTriangle, BarChart3, Clock,
} from "lucide-react"
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts"
import { api, type CommunityGroup, type CommunityGroupDetail, type CommunityFollow } from "@/src/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtProfit(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return (v >= 0 ? "+" : "") + v.toFixed(2)
}

function ScoreBadge({ score, label }: { score: number | null; label: string }) {
  if (score === null) return <span className="text-xs text-muted-foreground">{label}</span>
  const cls =
    score >= 75 ? "bg-emerald-600/10 text-emerald-400 border-emerald-500/20" :
    score >= 55 ? "bg-indigo-600/10 text-indigo-400 border-indigo-500/20" :
    score >= 35 ? "bg-amber-600/10 text-amber-400 border-amber-500/20" :
                  "bg-red-600/10 text-red-400 border-red-500/20"
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${cls}`}>
      {score} — {label}
    </span>
  )
}

function WinRateBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${rate}%` }} />
      </div>
      <span className="text-xs font-mono text-foreground">{rate.toFixed(1)}%</span>
    </div>
  )
}

// ── Group card in the list ─────────────────────────────────────────────────────

function GroupCard({
  group,
  selected,
  onSelect,
  userId,
  following,
  onFollowToggle,
}: {
  group: CommunityGroup
  selected: boolean
  onSelect: () => void
  userId: string | undefined
  following: boolean
  onFollowToggle: (token: string, newState: boolean) => void
}) {
  const [busy, setBusy] = useState(false)

  const handleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!userId) return
    setBusy(true)
    try {
      if (following) {
        await api.unfollowCommunityGroup(group.token, userId)
        onFollowToggle(group.token, false)
      } else {
        await api.followCommunityGroup(group.token, userId)
        onFollowToggle(group.token, true)
      }
    } catch {
      // silently ignore
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onSelect}
      className={`
        px-4 py-3 cursor-pointer transition-colors border-b border-white/[0.04]
        hover:bg-white/[0.02]
        ${selected ? "bg-indigo-600/5 border-l-2 border-l-indigo-500" : ""}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{group.alias}</span>
            <ScoreBadge score={group.score} label={group.label} />
          </div>
          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">{group.trade_count} trades</span>
            <WinRateBar rate={group.win_rate} />
            <span className={`text-xs font-mono font-semibold ${
              (group.total_profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
            }`}>
              {fmtProfit(group.total_profit)}
            </span>
            {group.profit_factor !== null && (
              <span className="text-xs text-muted-foreground">PF {group.profit_factor?.toFixed(2)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {userId && (
            <button
              onClick={handleFollow}
              disabled={busy}
              className={`
                flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg
                transition-colors disabled:opacity-40
                ${following
                  ? "bg-red-600/10 text-red-400 hover:bg-red-600/20 border border-red-500/20"
                  : "bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20 border border-indigo-500/20"
                }
              `}
            >
              {following
                ? <><UserMinus className="w-3 h-3" /> Unfollow</>
                : <><UserPlus className="w-3 h-3" /> Follow</>
              }
            </button>
          )}
          {selected
            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </div>
      </div>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  token,
  userId,
  following,
  onFollowToggle,
}: {
  token: string
  userId: string | undefined
  following: boolean
  onFollowToggle: (token: string, newState: boolean) => void
}) {
  const [detail, setDetail] = useState<CommunityGroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [followBusy, setFollowBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.getCommunityGroup(token, userId)
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [token, userId])

  useEffect(() => { load() }, [load])

  const handleFollow = async () => {
    if (!userId) return
    setFollowBusy(true)
    try {
      if (following) {
        await api.unfollowCommunityGroup(token, userId)
        onFollowToggle(token, false)
      } else {
        await api.followCommunityGroup(token, userId)
        onFollowToggle(token, true)
      }
    } catch {
      // silently ignore
    } finally {
      setFollowBusy(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
      <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mr-2" />
      Loading…
    </div>
  )

  if (!detail) return (
    <div className="p-4 text-sm text-muted-foreground">Failed to load details.</div>
  )

  const ts = detail.trade_stats
  const equityData = detail.equity_curve

  return (
    <div className="p-4 space-y-4 border-t border-white/[0.07] bg-white/[0.01]">

      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <ScoreBadge score={detail.score} label={detail.label} />
          <span className="text-xs text-muted-foreground">{ts.total_trades} total trades</span>
          <span className={`text-xs font-mono font-semibold ${ts.total_profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {fmtProfit(ts.total_profit)}
          </span>
        </div>
        {userId && (
          <button
            onClick={handleFollow}
            disabled={followBusy}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40
              ${following
                ? "bg-red-600/10 text-red-400 hover:bg-red-600/20 border border-red-500/20"
                : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }
            `}
          >
            {following
              ? <><UserMinus className="w-3 h-3" /> Unfollow</>
              : <><UserPlus className="w-3 h-3" /> Follow & copy strategies</>
            }
          </button>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Win Rate", value: ts.win_rate != null ? `${ts.win_rate.toFixed(1)}%` : "—" },
          { label: "Profit Factor", value: ts.profit_factor != null ? ts.profit_factor.toFixed(2) : "—" },
          { label: "Avg Win", value: ts.avg_win != null ? `+${ts.avg_win.toFixed(2)}` : "—" },
          { label: "Avg Loss", value: ts.avg_loss != null ? ts.avg_loss.toFixed(2) : "—" },
          { label: "Best Trade", value: ts.best_trade != null ? fmtProfit(ts.best_trade) : "—" },
          { label: "Worst Trade", value: ts.worst_trade != null ? fmtProfit(ts.worst_trade) : "—" },
          { label: "Max Cons. Losses", value: String(ts.max_consecutive_losses ?? "—") },
          { label: "Active Days", value: String(ts.active_trading_days ?? "—") },
        ].map(({ label, value }) => (
          <div key={label} className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <div className="text-[10px] text-muted-foreground">{label}</div>
            <div className="text-xs font-mono font-semibold text-foreground mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      {equityData.length > 1 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> Cumulative P&L
          </div>
          <div className="h-[130px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="cgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: unknown) => [fmtProfit(typeof v === "number" ? v : null), "Cumulative"]}
                />
                <Area type="monotone" dataKey="cumulative_pnl" stroke="#6366f1" fill="url(#cgGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent trades table */}
      {detail.recent_trades.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Recent Trades
          </div>
          <div className="rounded-lg border border-white/[0.07] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.07] bg-white/[0.02]">
                  {["Symbol", "Dir", "Lots", "Profit", "Reason", "Closed"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.recent_trades.slice(0, 10).map((t, i) => (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.015]">
                    <td className="px-3 py-1.5 font-semibold">{t.symbol}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        t.order_type === "BUY"
                          ? "bg-emerald-600/10 text-emerald-400 border-emerald-500/20"
                          : "bg-red-600/10 text-red-400 border-red-500/20"
                      }`}>{t.order_type}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono">{(t.lots ?? 0).toFixed(2)}</td>
                    <td className="px-3 py-1.5">
                      {t.profit === null ? (
                        <span className="flex items-center gap-1 text-amber-400">
                          <AlertTriangle className="w-3 h-3" /> N/A
                        </span>
                      ) : (
                        <span className={`font-mono font-semibold flex items-center gap-1 ${
                          t.profit > 0 ? "text-emerald-400" : t.profit === 0 ? "text-muted-foreground" : "text-red-400"
                        }`}>
                          {t.profit > 0 ? <TrendingUp className="w-3 h-3" /> : t.profit === 0 ? <Minus className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {fmtProfit(t.profit)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{t.reason ?? "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                      {t.close_time ? new Date(t.close_time).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Following section ─────────────────────────────────────────────────────────

function FollowingSection({
  userId,
  refreshKey,
}: {
  userId: string
  refreshKey: number
}) {
  const [follows, setFollows] = useState<CommunityFollow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.listCommunityFollows(userId)
      .then(r => setFollows(r.following))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [userId, refreshKey])

  if (loading) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
      <div className="w-4 h-4 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin" />
      Loading follows…
    </div>
  )

  if (follows.length === 0) return (
    <p className="text-sm text-muted-foreground py-4">You are not following any community group yet.</p>
  )

  return (
    <div className="space-y-2">
      {follows.map(f => (
        <div key={f.token} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-white/[0.07] bg-white/[0.02]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{f.alias}</span>
              <ScoreBadge score={f.score} label={f.label} />
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-muted-foreground">{f.trade_count} trades</span>
              {f.win_rate !== null && (
                <span className="text-xs text-muted-foreground">WR {f.win_rate?.toFixed(1)}%</span>
              )}
              {f.total_profit !== null && (
                <span className={`text-xs font-mono font-semibold ${(f.total_profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {fmtProfit(f.total_profit)}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                since {new Date(f.followed_at).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CommunityPage({ userId }: { userId?: string }) {
  const [groups, setGroups]         = useState<CommunityGroup[]>([])
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [followRefresh, setFollowRefresh] = useState(0)
  const [followStates, setFollowStates]   = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listCommunityGroups(userId)
      setGroups(res.groups)
      const initial: Record<string, boolean> = {}
      for (const g of res.groups) initial[g.token] = g.is_following
      setFollowStates(initial)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Load failed")
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const onFollowToggle = (token: string, newState: boolean) => {
    setFollowStates(prev => ({ ...prev, [token]: newState }))
    setFollowRefresh(n => n + 1)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            <h1 className="text-xl font-semibold text-foreground">Community Groups</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Public anonymized channels ranked by trust score. Follow to copy their strategies.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-foreground disabled:opacity-40 transition-colors shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-red-500/20 bg-red-600/5 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!userId && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-600/5 text-sm text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Search a user to enable follow/unfollow actions.
        </div>
      )}

      {/* Groups list */}
      {!loading && groups.length === 0 && !error && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No public community groups found.
        </div>
      )}

      {groups.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.07] bg-white/[0.02]">
            <Star className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-medium text-foreground">Ranked Channels</span>
            <span className="ml-auto text-xs text-muted-foreground">{groups.length} channel{groups.length !== 1 ? "s" : ""}</span>
          </div>
          {groups.map(g => (
            <div key={g.token}>
              <GroupCard
                group={g}
                selected={selectedToken === g.token}
                onSelect={() => setSelectedToken(t => t === g.token ? null : g.token)}
                userId={userId}
                following={followStates[g.token] ?? false}
                onFollowToggle={onFollowToggle}
              />
              {selectedToken === g.token && (
                <DetailPanel
                  token={g.token}
                  userId={userId}
                  following={followStates[g.token] ?? false}
                  onFollowToggle={onFollowToggle}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Following section (only if user is loaded) */}
      {userId && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <UserPlus className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-foreground">Currently Following</h2>
          </div>
          <FollowingSection userId={userId} refreshKey={followRefresh} />
        </div>
      )}
    </div>
  )
}
