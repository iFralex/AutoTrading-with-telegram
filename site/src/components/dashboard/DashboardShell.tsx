"use client"

import { useState, useCallback, useEffect } from "react"
import {
  LayoutDashboard,
  BarChart2,
  Bot,
  Settings2,
  ScrollText,
  FlaskConical,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  History,
  TrendingUp,
} from "lucide-react"
import { api, type DashboardUserResponse } from "@/src/lib/api"
import { OverviewPage }   from "./pages/OverviewPage"
import { AnalyticsPage }  from "./pages/AnalyticsPage"
import { AIPage }         from "./pages/AIPage"
import { SettingsPage }   from "./pages/SettingsPage"
import { LogsPage }       from "./pages/LogsPage"
import { TestPage }       from "./pages/TestPage"
import { TradesPage }     from "./pages/TradesPage"
import { BacktestPage }   from "./pages/BacktestPage"

// ── Types ─────────────────────────────────────────────────────────────────────

type Section = "overview" | "analytics" | "ai" | "settings" | "logs" | "test" | "trades" | "backtest"

const NAV: {
  id: Section
  label: string
  Icon: React.ComponentType<{ className?: string }>
  hint?: string
}[] = [
  { id: "overview",  label: "Panoramica",     Icon: LayoutDashboard },
  { id: "analytics", label: "Statistiche",    Icon: BarChart2 },
  { id: "ai",        label: "AI & Costi",     Icon: Bot },
  { id: "settings",  label: "Configurazione", Icon: Settings2 },
  { id: "logs",      label: "Log Segnali",    Icon: ScrollText },
  { id: "trades",    label: "Trade Recenti",  Icon: History },
  { id: "backtest",  label: "Backtest",       Icon: TrendingUp },
  { id: "test",      label: "Strumenti",      Icon: FlaskConical },
]

// ── Shell ─────────────────────────────────────────────────────────────────────

export function DashboardShell({ initialPhone = "" }: { initialPhone?: string }) {
  const [phone, setPhone]       = useState(initialPhone)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [data, setData]         = useState<DashboardUserResponse | null>(null)
  const [section, setSection]   = useState<Section>("overview")
  const [collapsed, setCollapsed] = useState(false)

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await api.getDashboardUser(trimmed)
      setData(res)
      setSection("overview")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore sconosciuto")
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-load on mount if phone is provided via URL param
  useEffect(() => {
    if (initialPhone) search(initialPhone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearUser = () => {
    setPhone("")
    setData(null)
    setError(null)
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className={`
          shrink-0 flex flex-col border-r border-white/[0.07] bg-card/40
          transition-[width] duration-200 ease-in-out
          ${collapsed ? "w-[56px]" : "w-[220px]"}
        `}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 h-14 px-3.5 border-b border-white/[0.07] shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <span className="text-indigo-400 text-sm leading-none">⚡</span>
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight text-foreground select-none">
              TradingBot
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2.5 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map(({ id, label, Icon }) => {
            const active   = section === id
            const disabled = !data && id !== "overview"
            return (
              <button
                key={id}
                onClick={() => !disabled && setSection(id)}
                disabled={disabled}
                title={collapsed ? label : undefined}
                className={`
                  w-full flex items-center gap-2.5 rounded-lg
                  px-2.5 py-2 text-sm transition-all duration-150
                  ${collapsed ? "justify-center" : ""}
                  ${active
                    ? "bg-indigo-600/15 text-indigo-300 border border-indigo-500/20 shadow-sm"
                    : disabled
                      ? "opacity-25 cursor-not-allowed text-muted-foreground"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground border border-transparent"
                  }
                `}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="truncate font-medium">{label}</span>}
              </button>
            )
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? "Espandi sidebar" : "Comprimi sidebar"}
          className={`
            mx-2 mb-3 flex items-center rounded-lg px-2.5 py-2
            text-muted-foreground hover:bg-white/[0.04] hover:text-foreground
            transition-colors border border-transparent
            ${collapsed ? "justify-center" : "gap-2"}
          `}
        >
          {collapsed
            ? <ChevronRight className="w-4 h-4" />
            : <>
                <ChevronLeft className="w-4 h-4" />
                <span className="text-xs font-medium">Comprimi</span>
              </>
          }
        </button>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="h-14 shrink-0 border-b border-white/[0.07] bg-background/80 backdrop-blur-sm flex items-center gap-4 px-5">

          {/* Search form */}
          <form
            onSubmit={e => { e.preventDefault(); search(phone) }}
            className="flex items-center gap-2 w-full max-w-xs"
          >
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
              <input
                type="tel"
                placeholder="+39123456789"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="
                  w-full pl-8 pr-8 py-1.5 text-sm font-mono
                  bg-white/[0.04] border border-white/[0.08] rounded-lg
                  placeholder:text-muted-foreground/40
                  focus:outline-none focus:border-indigo-500/40 focus:bg-white/[0.06]
                  transition-all
                "
              />
              {phone && (
                <button
                  type="button"
                  onClick={clearUser}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={loading || !phone.trim()}
              className="
                px-3 py-1.5 text-xs font-semibold rounded-lg
                bg-indigo-600 hover:bg-indigo-500 text-white
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors shrink-0
              "
            >
              {loading ? "…" : "Cerca"}
            </button>
          </form>

          {/* User badge (right side) */}
          {data && (
            <div className="ml-auto flex items-center gap-2.5">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${data.user.active ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
              <span className="text-sm font-mono text-foreground/70">{data.user.phone}</span>
              <span className="hidden sm:block text-xs px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-muted-foreground">
                {data.user.groups.length} {data.user.groups.length === 1 ? "canale" : "canali"}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                data.user.active
                  ? "bg-emerald-600/10 text-emerald-400 border-emerald-500/20"
                  : "bg-white/[0.04] text-muted-foreground border-white/10"
              }`}>
                {data.user.active ? "Attivo" : "Inattivo"}
              </span>
            </div>
          )}
        </header>

        {/* Error banner */}
        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2.5 px-4 py-3 rounded-xl border border-red-500/20 bg-red-600/5 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400/50 hover:text-red-400 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {loading ? (
            <LoadingState />
          ) : !data ? (
            <EmptyState onSearch={search} />
          ) : (
            <>
              {section === "overview"  && <OverviewPage  data={data} onUserUpdate={setData} onUserDelete={clearUser} />}
              {section === "analytics" && <AnalyticsPage userId={data.user.user_id} groups={data.user.groups} />}
              {section === "ai"        && <AIPage        userId={data.user.user_id} />}
              {section === "settings"  && <SettingsPage  data={data} onUserUpdate={setData} />}
              {section === "logs"      && <LogsPage      data={data} />}
              {section === "trades"    && <TradesPage    userId={data.user.user_id} />}
              {section === "backtest"  && <BacktestPage  userId={data.user.user_id} user={data.user} />}
              {section === "test"      && <TestPage      userId={data.user.user_id} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

// ── Empty / Loading states ────────────────────────────────────────────────────

function EmptyState({ onSearch }: { onSearch: (phone: string) => void }) {
  const [localPhone, setLocalPhone] = useState("")
  return (
    <div className="flex items-center justify-center h-full pb-16">
      <div className="text-center space-y-5 max-w-[320px] px-4">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center mx-auto">
          <LayoutDashboard className="w-7 h-7 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Nessun utente selezionato</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Inserisci un numero di telefono per accedere al profilo, ai log e alle statistiche.
          </p>
        </div>
        <form
          onSubmit={e => { e.preventDefault(); onSearch(localPhone) }}
          className="flex gap-2"
        >
          <input
            type="tel"
            placeholder="+39123456789"
            value={localPhone}
            onChange={e => setLocalPhone(e.target.value)}
            className="
              flex-1 px-3 py-2 text-sm font-mono
              bg-white/[0.04] border border-white/[0.08] rounded-lg
              placeholder:text-muted-foreground/40
              focus:outline-none focus:border-indigo-500/40 focus:bg-white/[0.06]
              transition-all
            "
          />
          <button
            type="submit"
            disabled={!localPhone.trim()}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors shrink-0"
          >
            Cerca
          </button>
        </form>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full pb-16">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">Caricamento dati utente…</p>
      </div>
    </div>
  )
}
