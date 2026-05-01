import Link from "next/link"

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "linear-gradient(135deg, #07090f 0%, #0b0f1a 100%)" }}
    >
      {/* Glow blob */}
      <div
        className="absolute w-[400px] h-[400px] rounded-full opacity-10 blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #10b981, #06b6d4)" }}
        aria-hidden
      />

      <div className="relative space-y-6 max-w-md">
        {/* Number */}
        <p
          className="text-[120px] font-black leading-none tracking-tighter select-none"
          style={{
            background: "linear-gradient(135deg, #10b981, #06b6d4, #8b5cf6)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          404
        </p>

        {/* Message */}
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-white">Page not found</h1>
          <p className="text-sm text-white/40 leading-relaxed">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href="/"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-500/15 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
          >
            Go home
          </Link>
          <Link
            href="/dashboard"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white/50 border border-white/[0.08] hover:bg-white/[0.04] hover:text-white/70 transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
