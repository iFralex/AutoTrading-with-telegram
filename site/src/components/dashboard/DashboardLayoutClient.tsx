"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard, Radio, TrendingUp, FlaskConical,
  Users, Layers, Settings, ChevronLeft, ChevronRight,
  Zap, AlertTriangle, Loader2,
} from "lucide-react"
import { DashboardProvider, useDashboard } from "./DashboardContext"

// ── Navigation ────────────────────────────────────────────────────────────────

const NAV_MAIN = [
  { href: "/dashboard",           label: "Home",       Icon: LayoutDashboard },
  { href: "/dashboard/signals",   label: "Signals",    Icon: Radio },
  { href: "/dashboard/trades",    label: "Trades",     Icon: TrendingUp },
  { href: "/dashboard/backtest",  label: "Backtest",   Icon: FlaskConical },
  { href: "/dashboard/community", label: "Community",  Icon: Users },
  { href: "/dashboard/rooms",     label: "Rooms",      Icon: Layers },
]

const NAV_BOTTOM = [
  { href: "/dashboard/settings",  label: "Settings",   Icon: Settings },
]

const PAGE_TITLES: Record<string, string> = {
  "/dashboard":            "Home",
  "/dashboard/signals":    "Signals",
  "/dashboard/trades":     "Trades",
  "/dashboard/backtest":   "Backtest",
  "/dashboard/community":  "Community",
  "/dashboard/rooms":      "Rooms",
  "/dashboard/settings":   "Settings",
}

// ── Shell inner (uses context) ─────────────────────────────────────────────────

function ShellInner({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const { user, loading, error } = useDashboard()

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href)

  const pageTitle = PAGE_TITLES[pathname] ?? "Dashboard"

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "linear-gradient(135deg, #07090f 0%, #0b0f1a 100%)" }}
    >
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className={`
          shrink-0 flex flex-col border-r border-white/[0.06]
          transition-[width] duration-200 ease-in-out
          ${collapsed ? "w-[64px]" : "w-[220px]"}
        `}
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        {/* Brand */}
        <div className={`flex items-center h-14 border-b border-white/[0.06] shrink-0 ${collapsed ? "justify-center px-0" : "gap-2.5 px-4"}`}>
          <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #10b981, #06b6d4)" }}>
            <Zap className="w-3.5 h-3.5 text-black" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <span className="text-sm font-bold tracking-tight text-white select-none">
              SignalFlow
            </span>
          )}
        </div>

        {/* Main nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV_MAIN.map(({ href, label, Icon }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`
                  flex items-center rounded-xl px-2.5 py-2.5 text-sm transition-all duration-150 group
                  ${collapsed ? "justify-center" : "gap-3"}
                  ${active
                    ? "text-emerald-400 border border-emerald-500/20"
                    : "text-white/40 hover:text-white/75 border border-transparent hover:bg-white/[0.04]"
                  }
                `}
                style={active ? { background: "linear-gradient(90deg, rgba(16,185,129,0.12), rgba(6,182,212,0.05))" } : {}}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && (
                  <span className="font-medium truncate">{label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Bottom nav */}
        <div className="px-2 pb-1 space-y-0.5 border-t border-white/[0.05] pt-2">
          {NAV_BOTTOM.map(({ href, label, Icon }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`
                  flex items-center rounded-xl px-2.5 py-2.5 text-sm transition-all duration-150
                  ${collapsed ? "justify-center" : "gap-3"}
                  ${active
                    ? "text-emerald-400 border border-emerald-500/20"
                    : "text-white/40 hover:text-white/75 border border-transparent hover:bg-white/[0.04]"
                  }
                `}
                style={active ? { background: "linear-gradient(90deg, rgba(16,185,129,0.12), rgba(6,182,212,0.05))" } : {}}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="font-medium truncate">{label}</span>}
              </Link>
            )
          })}
        </div>

        {/* Bot status + collapse */}
        <div className={`px-3 pb-3 pt-2 space-y-2 border-t border-white/[0.05]`}>
          {/* Status pill */}
          {!collapsed && user && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${
              user.active
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : "bg-white/[0.04] border border-white/[0.08] text-white/40"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${user.active ? "bg-emerald-400 animate-pulse" : "bg-white/30"}`} />
              {user.active ? "Bot active" : "Bot paused"}
            </div>
          )}

          {/* Collapse button */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className={`w-full flex items-center rounded-xl px-2.5 py-2 text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-colors ${collapsed ? "justify-center" : "gap-2"}`}
          >
            {collapsed
              ? <ChevronRight className="w-4 h-4" />
              : <><ChevronLeft className="w-4 h-4" /><span className="text-xs font-medium">Collapse</span></>
            }
          </button>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="h-14 shrink-0 border-b border-white/[0.06] flex items-center gap-4 px-6"
          style={{ background: "rgba(7,9,15,0.8)", backdropFilter: "blur(12px)" }}>

          <h1 className="text-sm font-semibold text-white/80">{pageTitle}</h1>

          <div className="ml-auto flex items-center gap-3">
            {loading && (
              <Loader2 className="w-4 h-4 text-white/30 animate-spin" />
            )}
            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="hidden sm:block">Connection error</span>
              </div>
            )}
            {user && (
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-mono text-white/40 hidden sm:block"
                >
                  {user.phone}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                  user.active
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-white/[0.04] text-white/30 border-white/[0.08]"
                }`}>
                  {user.active ? "Live" : "Paused"}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

// ── Public export wraps with provider ────────────────────────────────────────

export function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <ShellInner>{children}</ShellInner>
    </DashboardProvider>
  )
}
