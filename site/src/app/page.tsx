"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

// ─── Scroll-reveal wrapper ─────────────────────────────────────────────────
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold: 0.08 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

// ─── Reusable components ───────────────────────────────────────────────────
function GradientText({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`bg-gradient-to-br from-emerald-400 via-cyan-400 to-violet-500 bg-clip-text text-transparent ${className}`}>
      {children}
    </span>
  )
}

function GoldText({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`bg-gradient-to-r from-amber-400 to-amber-600 bg-clip-text text-transparent ${className}`}>{children}</span>
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 text-xs font-semibold uppercase tracking-widest">
      {children}
    </span>
  )
}

function GlassCard({ children, className = "", hover = false }: { children: React.ReactNode; className?: string; hover?: boolean }) {
  return (
    <div className={`bg-white/[0.03] border border-white/10 backdrop-blur-md rounded-2xl ${hover ? "transition-all duration-300 hover:bg-white/[0.06] hover:border-emerald-400/25 hover:-translate-y-1" : ""} ${className}`}>
      {children}
    </div>
  )
}

function CheckIcon({ color = "text-emerald-400" }: { color?: string }) {
  return (
    <svg className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
function XIcon() {
  return (
    <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-white/20" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function PrimaryBtn({ href, children, className = "", onClick }: { href: string; children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className={`inline-flex items-center justify-center bg-gradient-to-r from-emerald-400 to-cyan-400 text-black font-bold rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,232,135,0.35)] ${className}`}>
      {children}
    </Link>
  )
}

function OutlineBtn({ href, children, className = "", onClick }: { href: string; children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className={`inline-flex items-center justify-center border border-white/15 text-white/75 font-medium rounded-xl transition-all duration-200 hover:border-white/30 hover:text-white hover:bg-white/5 ${className}`}>
      {children}
    </Link>
  )
}

// ─── Navigation ────────────────────────────────────────────────────────────
function Nav() {
  const [open, setOpen] = useState(false)
  return (
    <nav className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl bg-[#07090f]/85 border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-lg">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-emerald-400 to-cyan-400">
            <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
            </svg>
          </span>
          <GradientText>SignalFlow</GradientText>
          <span className="text-white/30 font-light text-sm -ml-1">AI</span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-white/55">
          {[["#features", "Features"], ["#how-it-works", "How it works"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
            <a key={href} href={href} className="hover:text-white transition-colors">{label}</a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-white/50 hover:text-white transition-colors px-4 py-2">Log in</Link>
          <PrimaryBtn href="#pricing" className="text-sm px-5 py-2">Get Started</PrimaryBtn>
        </div>

        <button className="md:hidden text-white/60 hover:text-white" onClick={() => setOpen(!open)}>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="md:hidden px-6 pb-4 text-sm text-white/70 flex flex-col gap-3 border-t border-white/5">
          {[["#features", "Features"], ["#how-it-works", "How it works"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
            <a key={href} href={href} className="hover:text-white py-1" onClick={() => setOpen(false)}>{label}</a>
          ))}
          <PrimaryBtn href="#pricing" className="text-sm px-5 py-2.5 mt-2 text-center w-full" onClick={() => setOpen(false)}>Get Started</PrimaryBtn>
        </div>
      )}
    </nav>
  )
}

// ─── Hero ──────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 overflow-hidden bg-[#07090f]">
      {/* Orbs */}
      <div className="absolute w-[700px] h-[700px] rounded-full pointer-events-none blur-[120px] -top-48 -left-36 bg-emerald-500/20 animate-pulse" />
      <div className="absolute w-[600px] h-[600px] rounded-full pointer-events-none blur-[120px] -bottom-24 -right-36 bg-violet-600/15 animate-pulse" style={{ animationDelay: "1.5s" }} />
      <div className="absolute w-[400px] h-[400px] rounded-full pointer-events-none blur-[120px] top-1/3 right-10 bg-blue-500/12 animate-pulse" style={{ animationDelay: "3s" }} />

      <div className="relative z-10 max-w-5xl mx-auto text-center">
        <div className="mb-6 flex justify-center">
          <Badge>
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.381z" />
            </svg>
            Powered by Gemini 2.5 AI · Live MT5 Execution
          </Badge>
        </div>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-black leading-tight tracking-tight mb-6 text-white">
          Trade Smarter.<br />
          <GradientText>Never Miss a Signal.</GradientText>
        </h1>

        <p className="text-lg sm:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
          SignalFlow AI bridges your Telegram signal channels to MetaTrader 5 in real time.
          AI reads every message, parses the trade, and executes it on your live account —{" "}
          <strong className="text-white/75">24/7, fully automated.</strong>
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <PrimaryBtn href="#pricing" className="text-base px-8 py-4 w-full sm:w-auto">Start in 3 Minutes →</PrimaryBtn>
          <OutlineBtn href="#how-it-works" className="text-base px-8 py-4 w-full sm:w-auto">See how it works</OutlineBtn>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-14 text-center">
          {[["24/7", "Always Active"], ["<1s", "Signal to Order"], ["100%", "Automated"], ["3 min", "Setup Time"]].map(([val, label], i) => (
            <div key={i} className="flex items-center gap-8 sm:gap-14">
              {i > 0 && <div className="w-px h-8 bg-white/10 hidden sm:block" />}
              <div>
                <div className="text-3xl font-black"><GradientText>{val}</GradientText></div>
                <div className="text-xs mt-1 font-medium uppercase tracking-wider text-white/35">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dashboard mockup */}
      <div className="relative z-10 mt-20 max-w-4xl mx-auto w-full">
        <div className="bg-white/[0.03] border border-emerald-400/15 backdrop-blur-md rounded-2xl overflow-hidden shadow-[0_40px_120px_rgba(0,232,135,0.1)]">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-white/[0.02]">
            {["#ff5f57","#febc2e","#28c840"].map(c => <span key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />)}
            <span className="text-xs text-white/30 ml-3 font-mono">SignalFlow AI · Dashboard</span>
          </div>
          <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Signals Detected", value: "1,284", sub: "↑ 12.4% this week", subCls: "text-emerald-400" },
              { label: "Orders Executed",  value: "1,107", sub: "86.2% success rate",  subCls: "text-emerald-400" },
              { label: "Total P&L",        value: "+$4,832", sub: "Last 90 days",      subCls: "text-emerald-400", valCls: "text-emerald-400" },
              { label: "Win Rate",         value: "71.3%",   sub: "Profit Factor 2.1", subCls: "text-white/35" },
            ].map(({ label, value, sub, subCls, valCls }) => (
              <div key={label} className="bg-white/[0.03] border border-white/8 rounded-xl p-4">
                <div className="text-xs text-white/40 mb-1">{label}</div>
                <div className={`text-2xl font-black ${valCls ?? "text-white"}`}>{value}</div>
                <div className={`text-xs mt-1 ${subCls}`}>{sub}</div>
              </div>
            ))}
          </div>
          <div className="px-6 pb-6">
            <div className="bg-white/[0.03] border border-white/8 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold text-white/50">Equity Curve — 90 days</span>
                <span className="text-xs text-white/30">USD</span>
              </div>
              <svg viewBox="0 0 800 100" className="w-full h-20" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00e887" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#00e887" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d="M0,90 L40,85 L80,78 L120,82 L160,70 L200,65 L240,72 L280,58 L320,48 L360,52 L400,40 L440,32 L480,38 L520,25 L560,16 L600,20 L640,9 L680,3 L720,6 L760,1 L800,0 L800,100 L0,100Z" fill="url(#cg)" />
                <path d="M0,90 L40,85 L80,78 L120,82 L160,70 L200,65 L240,72 L280,58 L320,48 L360,52 L400,40 L440,32 L480,38 L520,25 L560,16 L600,20 L640,9 L680,3 L720,6 L760,1 L800,0" fill="none" stroke="#00e887" strokeWidth={2.5} />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Ticker ────────────────────────────────────────────────────────────────
function Ticker() {
  const s = ["XAUUSD","EURUSD","GBPJPY","NAS100","US30","BTCUSD","OIL","SP500","USDJPY","GBPUSD","EURGBP","AUDUSD"]
  const doubled = [...s, ...s]
  return (
    <div className="overflow-hidden border-y border-white/5 bg-white/[0.015] py-3.5">
      <div className="flex gap-12 text-sm font-medium text-white/28 whitespace-nowrap" style={{ animation: "lp-ticker 28s linear infinite" }}>
        {doubled.map((sym, i) => (
          <span key={i} className="flex items-center gap-12">
            {sym}
            <span className="text-white/10">·</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── How It Works ──────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    { num: "1", from: "from-emerald-400", to: "to-cyan-400", title: "Connect in 3 Minutes", body: "Run through the guided 10-step wizard. Link your Telegram account, choose which signal channels to monitor, and enter your MT5 broker credentials.", tags: [["Telegram Auth","text-emerald-400 bg-emerald-400/10 border-emerald-400/20"],["MT5 Verify","text-emerald-400 bg-emerald-400/10 border-emerald-400/20"],["2FA Support","text-emerald-400 bg-emerald-400/10 border-emerald-400/20"]] },
    { num: "2", from: "from-cyan-400", to: "to-violet-500", title: "AI Reads Every Signal", body: "Gemini 2.5 Flash instantly classifies each message. If it's a signal, Gemini 2.5 Pro extracts symbol, direction, entry, SL, TP, and lot size — even from messy text.", tags: [["Flash Detection","text-violet-400 bg-violet-400/10 border-violet-400/20"],["Pro Extraction","text-violet-400 bg-violet-400/10 border-violet-400/20"],["AI Filter","text-violet-400 bg-violet-400/10 border-violet-400/20"]] },
    { num: "3", from: "from-violet-500", to: "to-red-500", title: "Orders Execute Instantly", body: "The parsed signal is placed on your live MT5 account as a market or pending order. The AI agent monitors open positions and reacts to events 24/7.", tags: [["Live Execution","text-red-400 bg-red-400/10 border-red-400/20"],["Position Watch","text-red-400 bg-red-400/10 border-red-400/20"],["24/7 VPS","text-red-400 bg-red-400/10 border-red-400/20"]] },
  ]
  return (
    <section id="how-it-works" className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[500px] h-[500px] rounded-full blur-[120px] top-1/2 -left-48 -translate-y-1/2 bg-violet-600/15 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10">
        <Reveal className="text-center mb-16">
          <Badge>How It Works</Badge>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-4 text-white">Three steps. Zero effort.</h2>
          <p className="text-lg text-white/45 max-w-xl mx-auto">From Telegram message to live MT5 order in under a second — fully automatic, always on.</p>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map(({ num, from, to, title, body, tags }, i) => (
            <Reveal key={i} delay={i * 100}>
              <GlassCard hover className="p-8 h-full">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 text-black font-black text-xl bg-gradient-to-br ${from} ${to}`}>{num}</div>
                <h3 className="text-xl font-bold mb-3 text-white">{title}</h3>
                <p className="text-sm leading-relaxed mb-6 text-white/48">{body}</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map(([label, cls]) => (
                    <span key={label} className={`text-xs px-3 py-1 rounded-full border ${cls}`}>{label}</span>
                  ))}
                </div>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Features ──────────────────────────────────────────────────────────────
const FEATURES = [
  { path: "M13 10V3L4 14h7v7l9-11h-7z", color: "text-emerald-400 bg-emerald-400/10", title: "Dual-AI Signal Pipeline", body: "Gemini 2.5 Flash for instant classification, then Gemini 2.5 Pro for structured extraction. Fast, accurate, cost-efficient." },
  { path: "M12 2a10 10 0 100 20A10 10 0 0012 2zM12 8v4l3 3", color: "text-cyan-400 bg-cyan-400/10", title: "Real-Time Position Management", body: "An AI agent continuously watches open positions and reacts to events — close, modify, break-even — based on your natural-language strategy." },
  { path: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", color: "text-violet-400 bg-violet-400/10", title: "Advanced Analytics Dashboard", body: "Win rate, profit factor, Sharpe ratio, daily P&L charts, per-symbol breakdowns, equity curves, hourly distributions — all filterable by group." },
  { path: "M4 6h16M4 12h16M4 18h7", color: "text-amber-400 bg-amber-400/10", title: "Historical Backtesting", body: "Download historical Telegram messages, simulate on real MT5 price bars. Get equity curves, Sharpe ratio, and per-trade candlestick charts." },
  { path: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75", color: "text-red-400 bg-red-400/10", title: "Multi-Group Monitoring", body: "Monitor unlimited Telegram channels simultaneously. Each group gets its own AI configuration, sizing strategy, and extraction rules." },
  { path: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", color: "text-green-400 bg-green-400/10", title: "Encrypted & Secure", body: "MT5 credentials stored with Fernet symmetric encryption. Sessions persist on your VPS. Your data never leaves your server." },
  { path: "M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z", color: "text-emerald-400 bg-emerald-400/10", title: "Message Deletion Detection", body: "When a signal provider deletes a message, the bot automatically reacts — close positions, move to break-even, or reduce volume." },
  { path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", color: "text-cyan-400 bg-cyan-400/10", title: "Full Signal Audit Trail", body: "Every Telegram message is logged with timestamp, sender, AI decision, extracted signal data, MT5 ticket numbers, and error details." },
  { path: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z", color: "text-violet-400 bg-violet-400/10", title: "Tools & Simulators", body: "Test any Telegram message through the AI pipeline risk-free, or place direct JSON orders on MT5 to verify connectivity before going live." },
]

function Features() {
  return (
    <section id="features" className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[600px] h-[600px] rounded-full blur-[120px] -top-24 -right-48 bg-emerald-500/12 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10">
        <Reveal className="text-center mb-16">
          <Badge>Platform Features</Badge>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-4 text-white">
            Everything you need.<br />
            <GradientText>Nothing you don&apos;t.</GradientText>
          </h2>
          <p className="text-lg text-white/45 max-w-xl mx-auto">A complete suite of trading automation tools built for serious traders.</p>
        </Reveal>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ path, color, title, body }, i) => (
            <Reveal key={i} delay={i * 50}>
              <GlassCard hover className="p-6 h-full">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${color}`}>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
                  </svg>
                </div>
                <h3 className="font-bold text-base mb-2 text-white">{title}</h3>
                <p className="text-sm leading-relaxed text-white/45">{body}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── AI Pipeline ───────────────────────────────────────────────────────────
function AIPipeline() {
  const steps = [
    { letter: "F", gradient: "from-emerald-400 to-cyan-400", textBlack: true, title: "Flash Detection", model: "Gemini 2.5 Flash", body: "Instantly classifies: signal or noise? <200ms latency, minimal cost per call.", tag: <><span className="px-2 py-0.5 rounded text-xs bg-emerald-400/10 text-emerald-400">Signal ✓</span><span className="px-2 py-0.5 rounded text-xs bg-white/5 text-white/40">Noise ✗</span></> },
    { letter: "P", gradient: "from-violet-700 to-violet-500", textBlack: false, title: "Pro Extraction", model: "Gemini 2.5 Pro", body: "Parses symbol, direction, entry (market/exact/range), SL, TP, and lot size from any format.", tag: <span className="font-mono px-2 py-0.5 rounded text-xs bg-white/5 text-emerald-400">{"{ BUY XAUUSD @ 2342 | SL 2330 | TP 2360 }"}</span> },
    { letter: "A", gradient: "from-amber-500 to-red-500", textBlack: false, title: "AI Pre-trade Filter", model: "Elite only", elite: true, body: "The AI evaluates the signal against your strategy. It can approve, reject, or modify before any order is placed." },
    { letter: "✓", gradient: "from-green-500 to-green-700", textBlack: true, title: "MT5 Order Execution", body: "Order placed on your live brokerage account. Ticket logged. Position watcher activated." },
  ]
  const dividerGrads = ["from-emerald-400/40 to-violet-500/40","from-violet-500/40 to-red-500/40","from-red-500/40 to-green-500/40"]

  return (
    <section className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[500px] h-[500px] rounded-full blur-[120px] -bottom-24 left-1/2 -translate-x-1/2 bg-blue-500/10 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10 grid lg:grid-cols-2 gap-16 items-center">
        {/* Pipeline visual */}
        <Reveal>
          <GlassCard className="p-6 border-violet-500/20">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/35 mb-6">AI Signal Pipeline</p>
            {steps.map(({ letter, gradient, textBlack, title, model, body, tag, elite }, i) => (
              <div key={i}>
                <div className="flex items-start gap-4 mb-5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold bg-gradient-to-br ${gradient} ${textBlack ? "text-black" : "text-white"}`}>{letter}</div>
                  <div>
                    <p className="text-sm font-semibold text-white mb-1">
                      {title}
                      {model && <span className={`text-xs font-normal ml-2 ${elite ? "text-amber-400/70" : "text-white/30"}`}>{model}</span>}
                    </p>
                    <p className="text-xs text-white/40 leading-relaxed">{body}</p>
                    {tag && <div className="flex gap-2 mt-2">{tag}</div>}
                  </div>
                </div>
                {i < steps.length - 1 && <div className={`w-px h-5 ml-4 mb-1 bg-gradient-to-b ${dividerGrads[i]}`} />}
              </div>
            ))}
          </GlassCard>
        </Reveal>
        {/* Copy */}
        <Reveal delay={200}>
          <Badge>Gemini 2.5 AI</Badge>
          <h2 className="text-4xl font-black mt-6 mb-6 text-white">Two models.<br />One perfect pipeline.</h2>
          <p className="text-white/50 leading-relaxed mb-6">A two-stage AI architecture: a fast Flash model pre-filters noise so the expensive Pro model only runs on real signals. Maximum accuracy at minimal cost.</p>
          <ul className="space-y-4">
            {["Natural-language strategy instructions — no code needed","Works with unstructured, messy signal formats from any channel","Custom extraction rules per group (symbol suffixes, format quirks)","Full AI cost tracking — token usage and cost per call, per day"].map(t => (
              <li key={t} className="flex items-start gap-3">
                <CheckIcon /><span className="text-sm text-white/70">{t}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  )
}

// ─── Pricing ───────────────────────────────────────────────────────────────
type PlanFeature = { label: string; bold?: boolean }
type Plan = { name: string; price: string; tagline: string; popular?: boolean; elite?: boolean; ctaLabel: string; features: PlanFeature[]; notIncluded?: string[]; prevPlan?: string }

const PLANS: Plan[] = [
  {
    name: "Core", price: "€79", tagline: "Perfect for solo traders getting started with signal automation.",
    ctaLabel: "Get Started",
    features: [
      { label: "1 Telegram group / channel" },
      { label: "AI signal detection (Gemini Flash)" },
      { label: "Live MT5 order execution" },
      { label: "Market & pending order types" },
      { label: "Dashboard overview & KPIs" },
      { label: "Signal log & audit trail" },
      { label: "Recent trades table" },
      { label: "Message simulator (risk-free)" },
      { label: "3-minute guided setup wizard" },
      { label: "Encrypted credential storage" },
    ],
    notIncluded: ["Pro AI extraction (Gemini Pro)", "Analytics & backtesting", "AI pre-trade filter"],
  },
  {
    name: "Pro", price: "€149", tagline: "For active traders who want full analytics and multi-group coverage.",
    popular: true, ctaLabel: "Get Started →", prevPlan: "Core",
    features: [
      { label: "Up to 5 Telegram groups", bold: true },
      { label: "AI signal extraction (Gemini 2.5 Pro)" },
      { label: "Per-group configuration & strategies" },
      { label: "Range entry orders with % slider" },
      { label: "Full statistics & chart analytics" },
      { label: "Historical backtesting engine" },
      { label: "AI & API cost tracking dashboard" },
      { label: "Performance metrics (Sharpe, PF, drawdown)" },
      { label: "Copy settings between groups" },
    ],
    notIncluded: ["AI pre-trade filter", "AI position management agent", "Signal propagation to followers"],
  },
  {
    name: "Elite", price: "€299", tagline: "For professional traders and fund managers who need the full AI suite.",
    elite: true, ctaLabel: "Contact Sales", prevPlan: "Pro",
    features: [
      { label: "Unlimited Telegram groups", bold: true },
      { label: "AI pre-trade filter (approve / reject / modify)", bold: true },
      { label: "AI position management agent", bold: true },
      { label: "AI deletion strategy", bold: true },
      { label: "Signal propagation to followers", bold: true },
      { label: "Multi-user isolated MT5 terminals", bold: true },
      { label: "Priority support & onboarding", bold: true },
      { label: "Custom strategy configuration session", bold: true },
    ],
  },
]

function PricingCard({ plan }: { plan: Plan }) {
  const isPopular = plan.popular
  const isElite = plan.elite
  return (
    <div className={`rounded-2xl p-8 flex flex-col relative h-full ${isPopular ? "border border-emerald-400/30 shadow-[0_0_60px_rgba(0,232,135,0.08)]" : isElite ? "bg-white/[0.03] border border-amber-400/15 backdrop-blur-md" : "bg-white/[0.03] border border-white/10 backdrop-blur-md"}`}
      style={isPopular ? { background: "linear-gradient(160deg,rgba(0,232,135,0.07) 0%,rgba(0,195,255,0.04) 100%)" } : undefined}>
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-4 py-1 rounded-full text-xs font-bold text-black bg-gradient-to-r from-emerald-400 to-cyan-400">Most Popular</span>
        </div>
      )}
      <div className="mb-6">
        <div className={`text-xs font-bold uppercase tracking-widest mb-3 ${isPopular ? "text-emerald-400" : isElite ? "text-amber-400" : "text-white/40"}`}>{plan.name}</div>
        <div className="flex items-end gap-1 mb-2">
          <span className="text-5xl font-black text-white">{plan.price}</span>
          <span className="text-white/40 mb-2">/month</span>
        </div>
        <p className="text-sm text-white/50">{plan.tagline}</p>
      </div>

      {isPopular ? (
        <PrimaryBtn href="/setup" className="text-sm py-3 px-6 rounded-xl mb-8 w-full">{plan.ctaLabel}</PrimaryBtn>
      ) : isElite ? (
        <Link href="/setup" className="block text-center font-bold py-3 px-6 rounded-xl mb-8 text-sm border border-amber-400/40 text-amber-400 bg-amber-400/8 hover:bg-amber-400/12 transition-colors">{plan.ctaLabel}</Link>
      ) : (
        <OutlineBtn href="/setup" className="text-sm py-3 px-6 rounded-xl mb-8 w-full">{plan.ctaLabel}</OutlineBtn>
      )}

      <div className="flex-1 space-y-3.5">
        <p className={`text-xs font-semibold uppercase tracking-wider mb-4 ${isPopular ? "text-emerald-400/70" : isElite ? "text-amber-400/70" : "text-white/25"}`}>
          {plan.prevPlan ? `Everything in ${plan.prevPlan}, plus` : "Included"}
        </p>
        {plan.features.map(({ label, bold }) => (
          <div key={label} className="flex items-start gap-3">
            <CheckIcon color={isElite ? "text-amber-400" : "text-emerald-400"} />
            <span className="text-sm text-white/75">{bold ? <strong>{label}</strong> : label}</span>
          </div>
        ))}
        {plan.notIncluded && plan.notIncluded.length > 0 && (
          <div className="pt-2 border-t border-white/5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-3 text-white/20">Not included</p>
            {plan.notIncluded.map(label => (
              <div key={label} className="flex items-start gap-3 mt-3 opacity-40">
                <XIcon />
                <span className="text-sm text-white/50">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Pricing() {
  return (
    <section id="pricing" className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[700px] h-[700px] rounded-full blur-[120px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-emerald-500/8 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10">
        <Reveal className="text-center mb-16">
          <Badge>Pricing</Badge>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-4 text-white">
            Choose your plan.<br /><GradientText>Trade at your level.</GradientText>
          </h2>
          <p className="text-lg text-white/45 max-w-xl mx-auto">All plans include the core engine, dashboard, and 3-minute setup. No contract. Cancel anytime.</p>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6 items-stretch">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 100}>
              <PricingCard plan={plan} />
            </Reveal>
          ))}
        </div>
        <p className="text-center text-xs mt-8 text-white/28">All prices exclude VAT. Gemini API costs billed separately by Google. No contract — cancel anytime.</p>
      </div>
    </section>
  )
}

// ─── Comparison Table ──────────────────────────────────────────────────────
const TABLE: { label: string; core: boolean | string; pro: boolean | string; elite: boolean | string }[] = [
  { label: "Telegram groups monitored",            core: "1",    pro: "5",   elite: "Unlimited" },
  { label: "AI signal detection (Gemini Flash)",   core: true,   pro: true,  elite: true },
  { label: "AI signal extraction (Gemini Pro)",    core: false,  pro: true,  elite: true },
  { label: "MT5 order execution",                  core: true,   pro: true,  elite: true },
  { label: "Range entry orders",                   core: false,  pro: true,  elite: true },
  { label: "Full analytics & statistics",          core: false,  pro: true,  elite: true },
  { label: "Historical backtesting engine",        core: false,  pro: true,  elite: true },
  { label: "AI pre-trade filter",                  core: false,  pro: false, elite: true },
  { label: "AI position management agent",         core: false,  pro: false, elite: true },
  { label: "AI deletion strategy",                 core: false,  pro: false, elite: true },
  { label: "Signal propagation to followers",      core: false,  pro: false, elite: true },
]

function Cell({ val, gold }: { val: boolean | string; gold?: boolean }) {
  if (typeof val === "string") return <span className="text-sm font-medium text-white/75">{val}</span>
  if (val) return <CheckIcon color={gold ? "text-amber-400" : "text-emerald-400"} />
  return <XIcon />
}

function ComparisonTable() {
  return (
    <section className="py-16 px-6 bg-[#07090f]">
      <Reveal className="max-w-4xl mx-auto">
        <h3 className="text-2xl font-black text-center mb-10 text-white">Full feature comparison</h3>
        <GlassCard className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.025]">
                <th className="text-left px-6 py-4 font-semibold text-white/45">Feature</th>
                <th className="px-4 py-4 text-center font-semibold text-white/45">Core</th>
                <th className="px-4 py-4 text-center font-bold text-emerald-400">Pro</th>
                <th className="px-4 py-4 text-center font-semibold"><GoldText>Elite</GoldText></th>
              </tr>
            </thead>
            <tbody>
              {TABLE.map((row, i) => (
                <tr key={row.label} className={`${i < TABLE.length - 1 ? "border-b border-white/5" : ""} ${i % 2 === 1 ? "bg-white/[0.01]" : ""}`}>
                  <td className="px-6 py-3.5 text-white/65">{row.label}</td>
                  <td className="px-4 py-3.5 text-center"><Cell val={row.core} /></td>
                  <td className="px-4 py-3.5 text-center"><Cell val={row.pro} /></td>
                  <td className="px-4 py-3.5 text-center"><Cell val={row.elite} gold={row.elite === true} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      </Reveal>
    </section>
  )
}

// ─── FAQ ───────────────────────────────────────────────────────────────────
const FAQ_ITEMS = [
  { q: "What brokers are supported?", a: "Any broker that offers a MetaTrader 5 account works with SignalFlow AI. This includes IC Markets, Pepperstone, Exness, Tickmill, FP Markets, XM, and hundreds more. You simply provide your MT5 login, password, and broker server address — we verify the connection and display your account balance." },
  { q: "Do I need a Windows VPS?", a: "Yes. MetaTrader 5 is Windows-only, so SignalFlow AI runs on a Windows VPS. A basic VPS (4 GB RAM, 2 cores) from providers like Contabo or Vultr costs roughly €5–€15/month. Our guided PowerShell setup script installs everything automatically." },
  { q: "Is my Telegram account safe?", a: "SignalFlow uses Telethon, an official MTProto client, with your own Telegram API credentials from my.telegram.org. The bot only reads messages from the groups you select — it never sends messages, modifies your account, or accesses private chats. Your session is stored locally on your own VPS and never transmitted externally." },
  { q: "What does the AI pre-trade filter do?", a: "Available on Elite. Write a natural-language strategy (e.g., \"Only take BUY trades on XAUUSD if price is above the 200 EMA\"). Before every signal reaches MT5, a Gemini AI agent evaluates it and can approve it as-is, reject it entirely, or modify it (e.g., adjust lot size or SL)." },
  { q: "How does backtesting work?", a: "The engine downloads historical Telegram messages, runs the full AI pipeline (Flash → Pro → optional pre-trade filter), then simulates trades on real MT5 historical price bars (M1 with H1 fallback). Results include equity curve, win rate, profit factor, Sharpe ratio, max drawdown, AI cost breakdown, and a full sortable trade table." },
  { q: "What is signal propagation?", a: "Elite plan only. A source user can link multiple follower accounts. When a signal executes on the source, it propagates to all followers — each executes it with their own MT5 credentials and lot-sizing strategy. Followers' live trading is automatically paused during backtests." },
  { q: "Are there additional costs beyond the subscription?", a: "Two extra costs apply: (1) Windows VPS — typically €5–€15/month. (2) Gemini API costs — AI calls are billed at your Google Cloud usage rate. For a typical trader monitoring 1–3 groups, Gemini costs stay under €5–€20/month. SignalFlow tracks all API costs in the dashboard." },
]

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <GlassCard>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-6 py-5 text-sm font-semibold text-left text-white/90 cursor-pointer">
        {q}
        <span className={`w-6 h-6 flex-shrink-0 ml-4 flex items-center justify-center rounded-full bg-emerald-400/10 text-emerald-400 transition-transform duration-200 ${open ? "rotate-45" : ""}`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </span>
      </button>
      {open && <div className="px-6 pb-5 text-sm text-white/55 leading-relaxed border-t border-white/5 pt-4">{a}</div>}
    </GlassCard>
  )
}

function FAQ() {
  return (
    <section id="faq" className="py-28 px-6 bg-[#07090f]">
      <div className="max-w-3xl mx-auto">
        <Reveal className="text-center mb-16">
          <Badge>FAQ</Badge>
          <h2 className="text-4xl font-black mt-4 text-white">Common questions</h2>
        </Reveal>
        <Reveal delay={100} className="space-y-3">
          {FAQ_ITEMS.map(item => <FaqItem key={item.q} {...item} />)}
        </Reveal>
      </div>
    </section>
  )
}

// ─── Final CTA ─────────────────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[800px] h-[800px] rounded-full blur-[120px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-emerald-500/8 pointer-events-none" />
      <div className="absolute w-[500px] h-[500px] rounded-full blur-[120px] top-1/2 left-1/3 -translate-y-1/2 bg-violet-600/8 pointer-events-none" />
      <Reveal className="relative z-10 max-w-3xl mx-auto text-center">
        <Badge>Ready to automate?</Badge>
        <h2 className="text-4xl md:text-5xl font-black mt-6 mb-6 text-white">
          Start trading on autopilot.<br /><GradientText>In 3 minutes.</GradientText>
        </h2>
        <p className="text-lg text-white/48 mb-10 max-w-xl mx-auto">Connect your Telegram signal channels to MetaTrader 5. Let AI handle the rest — 24 hours a day, 7 days a week.</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <PrimaryBtn href="#pricing" className="text-base px-10 py-4 w-full sm:w-auto">Choose Your Plan →</PrimaryBtn>
          <OutlineBtn href="#faq" className="text-base px-8 py-4 w-full sm:w-auto">Read the FAQ</OutlineBtn>
        </div>
      </Reveal>
    </section>
  )
}

// ─── Footer ────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-white/5 bg-white/[0.01] py-12 px-6 bg-[#07090f]">
      <div className="max-w-6xl mx-auto">
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-2.5 font-bold text-lg mb-3">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-emerald-400 to-cyan-400">
                <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
                </svg>
              </span>
              <GradientText>SignalFlow</GradientText><span className="text-white/30 font-light text-sm -ml-1">AI</span>
            </Link>
            <p className="text-sm text-white/40 max-w-xs leading-relaxed">Telegram signal automation for MetaTrader 5. Powered by Google Gemini 2.5 AI.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/28 mb-4">Product</p>
            <ul className="space-y-2.5 text-sm text-white/50">
              {[["#features","Features"],["#pricing","Pricing"],["#how-it-works","How it works"],["#faq","FAQ"]].map(([href,label]) => (
                <li key={href}><a href={href} className="hover:text-white transition-colors">{label}</a></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/28 mb-4">Legal</p>
            <ul className="space-y-2.5 text-sm text-white/50">
              {["Privacy Policy","Terms of Service","Risk Disclaimer"].map(l => (
                <li key={l}><a href="#" className="hover:text-white transition-colors">{l}</a></li>
              ))}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/5 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/28">
          <p>© 2024 SignalFlow AI. All rights reserved.</p>
          <p className="text-center">Trading involves risk. Past performance is not indicative of future results. This software is a tool, not financial advice.</p>
        </div>
      </div>
    </footer>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="text-white overflow-x-hidden">
      <Nav />
      <Hero />
      <Ticker />
      {/* divider */}
      <div className="h-px max-w-5xl mx-auto bg-gradient-to-r from-transparent via-white/6 to-transparent" />
      <HowItWorks />
      <div className="h-px max-w-5xl mx-auto bg-gradient-to-r from-transparent via-white/6 to-transparent" />
      <Features />
      <div className="h-px max-w-5xl mx-auto bg-gradient-to-r from-transparent via-white/6 to-transparent" />
      <AIPipeline />
      <div className="h-px max-w-5xl mx-auto bg-gradient-to-r from-transparent via-white/6 to-transparent" />
      <Pricing />
      <ComparisonTable />
      <div className="h-px max-w-5xl mx-auto bg-gradient-to-r from-transparent via-white/6 to-transparent" />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  )
}
