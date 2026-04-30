"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { api, ApiError } from "@/src/lib/api"
import { normalizePhone } from "@/src/lib/utils"

type Step = "phone" | "otp" | "password" | "done"

const inp = "w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-400/40 transition-all"

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function RecoverPage() {
  const router = useRouter()
  const [step,     setStep]     = useState<Step>("phone")
  const [phone,    setPhone]    = useState("")
  const [otp,      setOtp]      = useState("")
  const [password, setPassword] = useState("")
  const [confirm,  setConfirm]  = useState("")
  const [loginKey, setLoginKey] = useState("")
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function handlePhone(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const normalized = normalizePhone(phone)
    if (!normalized) return
    setLoading(true)
    try {
      const res = await api.forgotPassword(normalized)
      setLoginKey(res.login_key)
      setPhone(normalized)
      setStep("otp")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore di connessione")
    } finally {
      setLoading(false)
    }
  }

  async function handleOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!otp.trim()) return
    setStep("password")
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError("La password deve essere di almeno 8 caratteri"); return }
    if (password !== confirm) { setError("Le password non coincidono"); return }
    setLoading(true)
    try {
      await api.recoverPassword(phone, otp.trim(), password, loginKey)
      setStep("done")
      setTimeout(() => router.push("/dashboard"), 2000)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Codice non valido o scaduto")
      setStep("otp")
      setOtp("")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#07090f] text-white flex flex-col items-center justify-center px-4">
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

        <div className="bg-white/[0.03] border border-white/10 backdrop-blur-md rounded-2xl p-8">

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {(["phone", "otp", "password"] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  step === s ? "bg-emerald-400 text-black" :
                  ["phone", "otp", "password"].indexOf(step) > i ? "bg-emerald-400/20 text-emerald-400" :
                  "bg-white/8 text-white/30"
                }`}>{i + 1}</div>
                {i < 2 && <div className={`flex-1 h-px w-8 ${["phone","otp","password"].indexOf(step) > i ? "bg-emerald-400/40" : "bg-white/10"}`} />}
              </div>
            ))}
          </div>

          {/* ── Step 1: Phone ── */}
          {step === "phone" && (
            <form onSubmit={handlePhone} className="space-y-4">
              <div>
                <h1 className="text-xl font-black text-white mb-1">Recover password</h1>
                <p className="text-sm text-white/40 mb-6">Enter your phone number. We&apos;ll send a verification code via Telegram.</p>
                <label className="block text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">Phone number</label>
                <input type="tel" className={inp} placeholder="+39 333 123 4567" value={phone} onChange={e => setPhone(e.target.value)} autoFocus />
              </div>
              {error && <p className="text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
              <button type="submit" disabled={loading || !phone} className="w-full py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-emerald-400 to-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5">
                {loading ? <><Spinner /> Sending…</> : "Send code via Telegram"}
              </button>
            </form>
          )}

          {/* ── Step 2: OTP ── */}
          {step === "otp" && (
            <form onSubmit={handleOtp} className="space-y-4">
              <div>
                <h1 className="text-xl font-black text-white mb-1">Enter the code</h1>
                <p className="text-sm text-white/40 mb-6">Telegram sent a verification code to <span className="text-white/70 font-mono">{phone}</span>. Enter it below.</p>
                <label className="block text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">Verification code</label>
                <input
                  className={inp + " tracking-widest text-center text-lg font-bold"}
                  placeholder="·  ·  ·  ·  ·"
                  maxLength={8}
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                />
              </div>
              {error && <p className="text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
              <button type="submit" disabled={otp.length < 4} className="w-full py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-emerald-400 to-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:-translate-y-0.5">
                Continue
              </button>
              <button type="button" onClick={() => { setStep("phone"); setOtp(""); setError(null) }} className="w-full text-center text-xs text-white/30 hover:text-white/50 transition-colors py-1">
                ← Back
              </button>
            </form>
          )}

          {/* ── Step 3: New password ── */}
          {step === "password" && (
            <form onSubmit={handlePassword} className="space-y-4">
              <div>
                <h1 className="text-xl font-black text-white mb-1">Set new password</h1>
                <p className="text-sm text-white/40 mb-6">Choose a strong password for your account.</p>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">New password</label>
                <input type="password" className={inp} placeholder="Min. 8 characters" value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">Confirm password</label>
                <input type="password" className={inp} placeholder="Repeat password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
              </div>
              {error && <p className="text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
              <button type="submit" disabled={loading || password.length < 8 || password !== confirm} className="w-full py-3 rounded-xl text-sm font-bold text-black bg-gradient-to-r from-emerald-400 to-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5">
                {loading ? <><Spinner /> Saving…</> : "Set new password"}
              </button>
            </form>
          )}

          {/* ── Done ── */}
          {step === "done" && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <h2 className="text-lg font-black text-white mb-2">Password updated!</h2>
              <p className="text-sm text-white/40">Redirecting you to the dashboard…</p>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-white/30 mt-6">
          Remembered it?{" "}
          <Link href="/login" className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium">Back to login</Link>
        </p>
      </div>
    </div>
  )
}
