import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { SetupWizard } from "@/src/components/setup/SetupWizard"
import { MetisLogo } from "@/src/components/MetisLogo"

export default async function SetupPage() {
  const jar = await cookies()
  if (jar.get("sf_logged_in")?.value === "1") redirect("/dashboard")
  return (
    <div className="min-h-screen bg-[#07090f] text-white overflow-x-hidden">
      {/* Background orbs */}
      <div className="fixed w-[700px] h-[700px] rounded-full pointer-events-none blur-[150px] -top-48 -left-36 bg-emerald-500/10 animate-pulse" />
      <div className="fixed w-[600px] h-[600px] rounded-full pointer-events-none blur-[150px] -bottom-24 -right-36 bg-violet-600/8 animate-pulse" style={{ animationDelay: "2s" }} />

      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 h-16 border-b border-white/5 bg-[#07090f]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <Link href="/"><MetisLogo /></Link>
          <Link href="/" className="text-sm text-white/35 hover:text-white transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back to home
          </Link>
        </div>
      </nav>

      <main className="relative z-10 flex flex-col items-center pt-20 px-4 sm:px-6" style={{ minHeight: "100dvh" }}>
        <div className="w-full max-w-xl bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden backdrop-blur-sm" style={{ marginTop: "1rem", marginBottom: "1rem", height: "calc(100dvh - 5.5rem)" }}>
          <SetupWizard />
        </div>
      </main>
    </div>
  )
}
