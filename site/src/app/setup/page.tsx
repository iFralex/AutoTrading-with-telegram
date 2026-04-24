import Link from "next/link"
import { SetupWizard } from "@/src/components/setup/SetupWizard"

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-[#07090f] text-white overflow-x-hidden">
      {/* Background orbs */}
      <div className="fixed w-[700px] h-[700px] rounded-full pointer-events-none blur-[150px] -top-48 -left-36 bg-emerald-500/10 animate-pulse" />
      <div className="fixed w-[600px] h-[600px] rounded-full pointer-events-none blur-[150px] -bottom-24 -right-36 bg-violet-600/8 animate-pulse" style={{ animationDelay: "2s" }} />

      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 h-16 border-b border-white/5 bg-[#07090f]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-lg">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-emerald-400 to-cyan-400">
              <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
              </svg>
            </span>
            <span className="bg-gradient-to-br from-emerald-400 via-cyan-400 to-violet-500 bg-clip-text text-transparent">SignalFlow</span>
            <span className="text-white/30 font-light text-sm -ml-1">AI</span>
          </Link>
          <Link href="/" className="text-sm text-white/35 hover:text-white transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back to home
          </Link>
        </div>
      </nav>

      <main className="relative z-10 min-h-screen flex flex-col items-center pt-28 pb-20 px-4 sm:px-6">
        <SetupWizard />
      </main>
    </div>
  )
}
