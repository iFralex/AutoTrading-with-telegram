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
        // Token scaduto e refresh fallito, o utente non trovato → login
        router.push("/login")
      } else {
        setError(e instanceof Error ? e.message : "Errore nel caricamento")
      }
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { loadUser() }, [loadUser])

  const reload = useCallback(async () => { await loadUser() }, [loadUser])

  const updateData = useCallback((data: DashboardUserResponse) => {
    setUser(data.user)
    setLogs(data.logs)
    setTotalLogs(data.total_logs)
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() } catch { /* ignora errori di rete */ }
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
