"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { api, ApiError } from "@/src/lib/api"
import { normalizePhone } from "@/src/lib/utils"

const inp = "w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-400/40 transition-all"

export default function LoginPage() {
  const router  = useRouter()
  const [phone,    setPhone]    = useState("")
  const [password, setPassword] = useState("")
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const normalized = normalizePhone(phone)
    if (!normalized || !password) return
    setLoading(true)
    try {
      await api.login(normalized, password)
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore di connessione")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#07090f] text-white flex flex-col items-center justify-center px-4">
      {/* Background orbs */}
      <div className="fixed w-[600px] h-[600px] rounded-full pointer-events-none blur-[120px] -top-48 -left-36 bg-emerald-500/12 animate-pulse" />
      <div className="fixed w-[500px] h-[500px] rounded-full pointer-events-none blur-[120px] -bottom-24 -right-36 bg-violet-600/8 animate-pulse" />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2.5 font-bold text-lg mb-10">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-emerald-400 to-cyan-400">
            <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
            </svg>
          </span>
          <span className="bg-gradient-to-br from-emerald-400 via-cyan-400 to-violet-500 bg-clip-text text-transparent">SignalFlow</span>
          <span className="text-white/30 font-light text-sm -ml-1">AI</span>
        </Link>

        {/* Card */}
        <div className="bg-white/[0.03] border border-white/10 backdrop-blur-md rounded-2xl p-8">
          <h1 className="text-xl font-black text-white mb-1">Welcome back</h1>
          <p className="text-sm text-white/40 mb-8">Enter your phone number and password to continue.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">
                Phone number
              </label>
              <input
                type="tel"
                className={inp}
                placeholder="+39 333 123 4567"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                autoComplete="tel"
                autoFocus
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                  Password
                </label>
                <Link
                  href="/login/recover"
                  className="text-[11px] text-emerald-400/70 hover:text-emerald-400 transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                className={inp}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !phone || !password}
              className="w-full py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-emerald-400 to-cyan-400 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,232,135,0.3)] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2 mt-2"
            >
              {loading && (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {loading ? "Logging in…" : "Log In"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-white/30 mt-6">
          No account yet?{" "}
          <Link href="/setup" className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium">
            Set up with Nova
          </Link>
        </p>
      </div>
    </div>
  )
}
