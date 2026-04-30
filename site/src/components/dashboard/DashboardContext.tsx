"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { api, type DashboardUser, type SignalLog, type DashboardUserResponse } from "@/src/lib/api"

interface DashboardContextValue {
  user: DashboardUser | null
  logs: SignalLog[]
  totalLogs: number
  loading: boolean
  error: string | null
  phone: string
  setPhone: (p: string) => void
  reload: () => Promise<void>
  updateData: (data: DashboardUserResponse) => void
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboard() {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider")
  return ctx
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [phone, setPhoneState] = useState("")
  const [user, setUser]       = useState<DashboardUser | null>(null)
  const [logs, setLogs]       = useState<SignalLog[]>([])
  const [totalLogs, setTotalLogs] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const loadUser = useCallback(async (p: string) => {
    if (!p.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getDashboardUser(p.trim())
      setUser(res.user)
      setLogs(res.logs)
      setTotalLogs(res.total_logs)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load account data")
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const setPhone = useCallback((p: string) => {
    setPhoneState(p)
    if (p) {
      sessionStorage.setItem("sf_phone", p)
      loadUser(p)
    }
  }, [loadUser])

  useEffect(() => {
    if (typeof window === "undefined") return
    const params  = new URLSearchParams(window.location.search)
    const urlPhone = params.get("phone") ?? ""
    const cached   = sessionStorage.getItem("sf_phone") ?? ""
    const p = urlPhone || cached
    if (p) {
      setPhoneState(p)
      if (urlPhone) sessionStorage.setItem("sf_phone", urlPhone)
      loadUser(p)
    }
  }, [loadUser])

  const reload = useCallback(async () => { await loadUser(phone) }, [loadUser, phone])

  const updateData = useCallback((data: DashboardUserResponse) => {
    setUser(data.user)
    setLogs(data.logs)
    setTotalLogs(data.total_logs)
  }, [])

  return (
    <DashboardContext.Provider
      value={{ user, logs, totalLogs, loading, error, phone, setPhone, reload, updateData }}
    >
      {children}
    </DashboardContext.Provider>
  )
}
