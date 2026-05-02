"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { api, ApiError, type DashboardUser, type SignalLog, type DashboardUserResponse } from "@/src/lib/api"

interface DashboardContextValue {
  user: DashboardUser | null
  logs: SignalLog[]
  totalLogs: number
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  updateData: (data: DashboardUserResponse) => void
  logout: () => Promise<void>
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboard() {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider")
  return ctx
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [user,      setUser]      = useState<DashboardUser | null>(null)
  const [logs,      setLogs]      = useState<SignalLog[]>([])
  const [totalLogs, setTotalLogs] = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const loadUser = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getMe()
      setUser(res.user)
      setLogs(res.logs)
      setTotalLogs(res.total_logs)
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
        // Clear sf_logged_in so the middleware doesn't redirect back to /dashboard
        document.cookie = "sf_logged_in=; max-age=0; path=/"
        router.push("/login")
      } else {
        setError(e instanceof Error ? e.message : "Session error")
      }
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { loadUser() }, [loadUser])

  // Refresh proattivo: rinnova il token prima che scada (TTL = 15 min) così
  // al prossimo reload il token è già fresco e non serve il retry reattivo.
  useEffect(() => {
    const refresh = () => api.refreshToken().catch(() => {})
    const interval = setInterval(refresh, 14 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === "visible") refresh() }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const reload = useCallback(async () => { await loadUser() }, [loadUser])

  const updateData = useCallback((data: DashboardUserResponse) => {
    setUser(data.user)
    setLogs(data.logs)
    setTotalLogs(data.total_logs)
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() } catch { /* ignora errori di rete */ }
    document.cookie = "sf_logged_in=; max-age=0; path=/"
    router.push("/login")
  }, [router])

  return (
    <DashboardContext.Provider
      value={{ user, logs, totalLogs, loading, error, reload, updateData, logout }}
    >
      {children}
    </DashboardContext.Provider>
  )
}
