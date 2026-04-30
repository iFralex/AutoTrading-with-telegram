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
          {[["#features", "Features"], ["#how-it-works", "How It Works"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
            <a key={href} href={href} className="hover:text-white transition-colors">{label}</a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-white/50 hover:text-white transition-colors px-4 py-2">Log In</Link>
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
          {[["#features", "Features"], ["#how-it-works", "How It Works"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
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
            Zero Emotion · Instant Execution · Always On
          </Badge>
        </div>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-black leading-tight tracking-tight mb-6 text-white">
          Stop missing trades.<br />
          <GradientText>Start profiting on autopilot.</GradientText>
        </h1>

        <p className="text-lg sm:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
          Follow your Telegram signal rooms and let our AI execute every trade for you —
          in under a second, no hesitation, no emotion,{" "}
          <strong className="text-white/75">24/7.</strong>
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <PrimaryBtn href="#pricing" className="text-base px-8 py-4 w-full sm:w-auto">Chat with Nova →</PrimaryBtn>
          <OutlineBtn href="#how-it-works" className="text-base px-8 py-4 w-full sm:w-auto">How It Works</OutlineBtn>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-14 text-center">
          {[["24/7", "Always On"], ["<1s", "Signal → Order"], ["0", "Emotions"], ["5 min", "Nova Setup"]].map(([val, label], i) => (
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
    {
      num: "1", from: "from-emerald-400", to: "to-cyan-400",
      title: "Chat with Nova to get set up",
      body: "Nova, our AI setup assistant, walks you through everything in a conversation — no forms, no manuals. Connect your Telegram account, choose your signal room, link your MT5 broker account. Then tell Nova how you trade, in your own words.",
      tags: [["Nova AI assistant","text-emerald-400 bg-emerald-400/10 border-emerald-400/20"],["Telegram + MT5","text-emerald-400 bg-emerald-400/10 border-emerald-400/20"],["Plain language rules","text-emerald-400 bg-emerald-400/10 border-emerald-400/20"]],
    },
    {
      num: "2", from: "from-cyan-400", to: "to-violet-500",
      title: "Preview on a real signal",
      body: "Paste a message from your channel — or pick one directly from recent messages. Nova shows a chart with entry, SL, and TP, then simulates how your strategy would have played out. You see exactly what will happen before a single order goes live.",
      tags: [["Live signal preview","text-violet-400 bg-violet-400/10 border-violet-400/20"],["Strategy simulation","text-violet-400 bg-violet-400/10 border-violet-400/20"],["Zero risk","text-violet-400 bg-violet-400/10 border-violet-400/20"]],
    },
    {
      num: "3", from: "from-violet-500", to: "to-red-500",
      title: "Trades execute automatically",
      body: "From the moment you launch, every signal in your room is handled in under a second. The system reads, extracts, filters by your rules, and opens the order — 24/7, with no action needed on your part.",
      tags: [["Instant execution","text-red-400 bg-red-400/10 border-red-400/20"],["Zero emotion","text-red-400 bg-red-400/10 border-red-400/20"],["Always on","text-red-400 bg-red-400/10 border-red-400/20"]],
    },
  ]
  return (
    <section id="how-it-works" className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[500px] h-[500px] rounded-full blur-[120px] top-1/2 -left-48 -translate-y-1/2 bg-violet-600/15 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10">
        <Reveal className="text-center mb-16">
          <Badge>How It Works</Badge>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-4 text-white">Three steps. Zero effort.</h2>
          <p className="text-lg text-white/45 max-w-xl mx-auto">Chat with Nova, preview on a real signal, and go live — all in under 5 minutes.</p>
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
function Features() {
  const hoverCls = "transition-all duration-300 hover:bg-white/[0.06] hover:border-emerald-400/25 hover:-translate-y-1"
  const cardBase = `bg-white/[0.03] border border-white/10 backdrop-blur-md rounded-2xl ${hoverCls}`

  return (
    <section id="features" className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[600px] h-[600px] rounded-full blur-[120px] -top-24 -right-48 bg-emerald-500/12 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10">
        <Reveal className="text-center mb-16">
          <Badge>Features</Badge>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-4 text-white">
            Everything you need.<br />
            <GradientText>Nothing you don&apos;t.</GradientText>
          </h2>
          <p className="text-lg text-white/45 max-w-xl mx-auto">Every feature is designed for traders who are tired of missing opportunities and watching screens all day.</p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* ── Row 1: Instant Execution (wide) + Zero Emotion ── */}
          <Reveal className="md:col-span-2">
            <div className={`${cardBase} p-8 h-full flex flex-col justify-between min-h-[260px]`}>
              <div>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-emerald-400 bg-emerald-400/10">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <h3 className="text-2xl font-black text-white mb-2">Instant Signal Execution</h3>
                <p className="text-white/50 text-sm leading-relaxed max-w-sm">Your trade opens before you even see the message. No delays, no hesitation, no missed entries — ever.</p>
              </div>
              <div className="mt-8 pt-6 border-t border-white/5 flex items-baseline gap-4">
                <span className="text-6xl font-black text-emerald-400">&lt;1s</span>
                <span className="text-sm text-white/40 leading-snug">from signal<br />to live order</span>
              </div>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className={`${cardBase} p-6 h-full flex flex-col justify-between min-h-[260px]`}>
              <div>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-violet-400 bg-violet-400/10">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                </div>
                <h3 className="text-xl font-black text-white mb-2">Zero Emotion Trading</h3>
                <p className="text-white/50 text-sm leading-relaxed">Rules execute perfectly every time. No second-guessing, no panic, no greed.</p>
              </div>
              <div className="mt-6 pt-4 border-t border-white/5 space-y-2.5">
                {["No hesitation", "No FOMO", "No fear", "No missed entries"].map(item => (
                  <div key={item} className="flex items-center gap-2 text-sm text-white/65">
                    <CheckIcon />{item}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* ── Row 2: Analytics + Multi-room + Backtest ── */}
          <Reveal delay={0}>
            <div className={`${cardBase} p-6 h-full`}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-violet-400 bg-violet-400/10">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              </div>
              <h3 className="font-black text-base text-white mb-1.5">Performance Analytics</h3>
              <p className="text-white/45 text-sm mb-4 leading-relaxed">Know exactly which providers make you money and which don&apos;t.</p>
              <div className="grid grid-cols-2 gap-2">
                {[["Win Rate","71.3%","text-emerald-400"],["Profit Factor","2.1×","text-white"],["Max Drawdown","−8.2%","text-red-400"],["Sharpe Ratio","1.84","text-white"]].map(([l,v,c]) => (
                  <div key={l} className="bg-white/[0.04] rounded-xl p-3">
                    <div className="text-xs text-white/35 mb-0.5">{l}</div>
                    <div className={`text-sm font-bold ${c}`}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className={`${cardBase} p-6 h-full`}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-red-400 bg-red-400/10">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
              </div>
              <h3 className="font-black text-base text-white mb-1.5">Multiple Signal Rooms</h3>
              <p className="text-white/45 text-sm leading-relaxed">Follow as many Telegram channels as you want simultaneously. Each room has independent risk settings and position sizing.</p>
            </div>
          </Reveal>

          <Reveal delay={200}>
            <div className={`${cardBase} p-6 h-full`}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-amber-400 bg-amber-400/10">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" /></svg>
              </div>
              <h3 className="font-black text-base text-white mb-1.5">Historical Backtesting</h3>
              <p className="text-white/45 text-sm leading-relaxed">Test any signal provider against real historical market data before risking a single dollar. See the real equity curve.</p>
            </div>
          </Reveal>

          {/* ── Row 3: Position Management (wide) + Risk Protection ── */}
          <Reveal className="md:col-span-2" delay={0}>
            <div className={`${cardBase} p-6 h-full`}>
              <div className="flex items-start gap-4 mb-4">
                <div className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-cyan-400 bg-cyan-400/10">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 2a10 10 0 100 20A10 10 0 0012 2zM12 8v4l3 3" /></svg>
                </div>
                <div>
                  <h3 className="font-black text-base text-white mb-1.5">Automatic Position Management</h3>
                  <p className="text-white/45 text-sm leading-relaxed">Set your rules once. The system moves your stop loss, closes partials, and reacts to any event — without you lifting a finger.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {["Move SL to break-even","Trailing stop loss","Partial position close","Auto-exit on signal revocation"].map(tag => (
                  <span key={tag} className="text-xs px-3 py-1.5 rounded-full bg-cyan-400/10 border border-cyan-400/20 text-cyan-400">{tag}</span>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className={`${cardBase} p-6 h-full`}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-red-400 bg-red-400/10">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" /></svg>
              </div>
              <h3 className="font-black text-base text-white mb-1.5">Automatic Risk Protection</h3>
              <p className="text-white/45 text-sm leading-relaxed">Signal deleted by the analyst? The system reacts instantly — close, reduce, or move to break-even based on your rules.</p>
            </div>
          </Reveal>

          {/* ── Row 4: Minor features strip ── */}
          <Reveal className="md:col-span-3" delay={0}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { path: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", cls: "text-green-400 bg-green-400/10", title: "Secure by Design", body: "Your credentials never leave your systems. Read-only Telegram access, fully encrypted." },
                { path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2", cls: "text-cyan-400 bg-cyan-400/10", title: "Complete Trade History", body: "Every signal, every order, every result — logged with full timestamp and details." },
                { path: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z", cls: "text-violet-400 bg-violet-400/10", title: "Test Any Signal Risk-Free", body: "Preview exactly how the AI interprets a message before it touches your account." },
                { path: "M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3", cls: "text-emerald-400 bg-emerald-400/10", title: "Telegram Alerts & Reports", body: "Get notified on every executed trade. Receive a weekly P&L summary — straight to your Telegram." },
              ].map(({ path, cls, title, body }) => (
                <div key={title} className="flex items-start gap-3 bg-white/[0.02] border border-white/5 rounded-xl p-4 hover:bg-white/[0.04] transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cls}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={path} /></svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white mb-0.5">{title}</p>
                    <p className="text-xs text-white/40 leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>

          {/* ── Row 5: Range Orders + Community ── */}
          <Reveal className="md:col-span-2" delay={0}>
            <div className={`${cardBase} p-6 h-full`}>
              <div className="flex items-start gap-4 mb-4">
                <div className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-emerald-400 bg-emerald-400/10">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="font-black text-base text-white">Range Orders & Optimized Entry</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/20 text-emerald-400">Core</span>
                  </div>
                  <p className="text-white/45 text-sm leading-relaxed">Don&apos;t enter blindly at the signal price. Set a range and the system waits for a more favorable entry — or skips if the price never reaches it.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {["Configurable entry range %", "Entry if price moves in your favor", "Auto-skip if entry window missed", "Separate settings per room"].map(tag => (
                  <span key={tag} className="text-xs px-3 py-1.5 rounded-full bg-emerald-400/10 border border-emerald-400/20 text-emerald-400">{tag}</span>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className={`${cardBase} p-6 h-full`}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-amber-400 bg-amber-400/10">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="font-black text-base text-white">Community & Copy Trading</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-400">Elite</span>
              </div>
              <p className="text-white/45 text-sm leading-relaxed">Make your room public and let others follow your signals automatically. Or browse top providers by Trust Score and copy their trades in one click.</p>
            </div>
          </Reveal>

        </div>
      </div>
    </section>
  )
}

// ─── AI Pipeline ───────────────────────────────────────────────────────────
function AIPipeline() {
  const steps = [
    { letter: "1", gradient: "from-emerald-400 to-cyan-400", textBlack: true, title: "Signal detection", body: "The system reads every message in real time and instantly identifies whether it's a trading signal — even if informally written or in different languages.", tag: <><span className="px-2 py-0.5 rounded text-xs bg-emerald-400/10 text-emerald-400">Signal ✓</span><span className="px-2 py-0.5 rounded text-xs bg-white/5 text-white/40">Noise ✗</span></> },
    { letter: "2", gradient: "from-violet-700 to-violet-500", textBlack: false, title: "Automatic parsing", body: "The AI engine extracts direction, entry price, stop loss, and take profit from every signal — in any format, even unstructured.", tag: <span className="font-mono px-2 py-0.5 rounded text-xs bg-white/5 text-emerald-400">{"BUY XAUUSD @ 2342 · SL 2330 · TP 2360"}</span> },
    { letter: "3", gradient: "from-amber-500 to-red-500", textBlack: false, title: "Custom filter", model: "from Core", elite: false, body: "Define position sizing and entry rules in plain language (Core). Pro adds AI confidence filtering. Elite adds full position management — approve, modify, or close on any event." },
    { letter: "✓", gradient: "from-green-500 to-green-700", textBlack: true, title: "Order opened automatically", body: "The order is placed on your account in under a second, with stop loss and take profit already set. The position is monitored until it closes." },
  ]
  const dividerGrads = ["from-emerald-400/40 to-violet-500/40","from-violet-500/40 to-red-500/40","from-red-500/40 to-green-500/40"]

  return (
    <section className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[500px] h-[500px] rounded-full blur-[120px] -bottom-24 left-1/2 -translate-x-1/2 bg-blue-500/10 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10 grid lg:grid-cols-2 gap-16 items-center">
        {/* Pipeline visual */}
        <Reveal>
          <GlassCard className="p-6 border-violet-500/20">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/35 mb-6">How the AI engine works</p>
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
          <Badge>Proprietary AI Engine</Badge>
          <h2 className="text-4xl font-black mt-6 mb-6 text-white">Reads any signal.<br />Executes in milliseconds.</h2>
          <p className="text-white/50 leading-relaxed mb-6">Our AI engine is trained to understand trading signals in any format — not just structured ones. It works even with analysts who write informally, change formats, or use abbreviations.</p>
          <ul className="space-y-4">
            {[
              "Understands signals written in any language or style",
              "Zero configuration: no code, no formulas",
              "Set risk rules in plain language",
              "Every decision is logged and visible in the dashboard",
            ].map(t => (
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
    name: "Core", price: "€79", tagline: "Automate your first signal room — with sizing rules, range entry, and Telegram alerts included.",
    ctaLabel: "Get Started",
    features: [
      { label: "1 Telegram signal room" },
      { label: "Automatic signal detection" },
      { label: "Instant order execution" },
      { label: "Automatic stop loss & take profit" },
      { label: "Position sizing rules", bold: true },
      { label: "Custom signal extraction hints", bold: true },
      { label: "Range orders with optimized entry", bold: true },
      { label: "Entry filter: only if price moves in your favor", bold: true },
      { label: "Telegram trade alerts (per executed order)" },
      { label: "Weekly P&L summary via Telegram" },
      { label: "Dashboard with basic stats" },
      { label: "Full signal & trade history" },
      { label: "Risk-free signal testing" },
      { label: "Nova AI-guided setup chat" },
      { label: "Encrypted & protected credentials" },
    ],
    notIncluded: ["Advanced signal analysis", "Backtesting & PDF reports", "AI position management"],
  },
  {
    name: "Pro", price: "€149", tagline: "Multiple rooms, full analytics, and smart signal filtering with AI confidence scoring.",
    popular: true, ctaLabel: "Get Started →", prevPlan: "Core",
    features: [
      { label: "Up to 5 Telegram signal rooms", bold: true },
      { label: "Advanced signal analysis (zero false positives)" },
      { label: "Separate settings per room" },
      { label: "AI confidence threshold — filter low-certainty signals", bold: true },
      { label: "Full stats & charts" },
      { label: "Historical signal backtesting" },
      { label: "Performance dashboard (win rate, drawdown, P&L)" },
      { label: "Advanced metrics (profit factor, Sharpe ratio)" },
      { label: "Trust Score per signal provider", bold: true },
      { label: "Monthly PDF report + on-demand generation", bold: true },
    ],
    notIncluded: ["AI position management", "Signal deletion handling", "Trading hours & calendar filters"],
  },
  {
    name: "Elite", price: "€299", tagline: "Unlimited rooms, AI-managed positions, smart filters, and community sharing.",
    elite: true, ctaLabel: "Contact the team", prevPlan: "Pro",
    features: [
      { label: "Unlimited signal rooms", bold: true },
      { label: "AI position management (approve / modify / close)", bold: true },
      { label: "Signal deletion handling — auto-react when analyst deletes", bold: true },
      { label: "Auto-close when signal is revoked", bold: true },
      { label: "Trading hours filter (UTC range + day selector)", bold: true },
      { label: "Economic calendar — auto-pause around news events", bold: true },
      { label: "Community room visibility — others follow your signals", bold: true },
      { label: "Copy trading across accounts", bold: true },
      { label: "Priority support with dedicated onboarding", bold: true },
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
          <Badge>Plans & Pricing</Badge>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-4 text-white">
            Pick your plan.<br /><GradientText>Start automating.</GradientText>
          </h2>
          <p className="text-lg text-white/45 max-w-xl mx-auto">All plans include the automation engine, dashboard and guided setup. No contracts. Cancel anytime.</p>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6 items-stretch">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 100}>
              <PricingCard plan={plan} />
            </Reveal>
          ))}
        </div>
        <p className="text-center text-xs mt-8 text-white/28">Prices ex. VAT. Subscription includes all required infrastructure. No contracts — cancel at any time.</p>
      </div>
    </section>
  )
}

// ─── Comparison Table ──────────────────────────────────────────────────────
const TABLE: { label: string; core: boolean | string; pro: boolean | string; elite: boolean | string }[] = [
  { label: "Signal rooms monitored",             core: "1",    pro: "5",           elite: "Unlimited" },
  { label: "Automatic signal detection",         core: true,   pro: true,          elite: true },
  { label: "Advanced signal analysis",           core: false,  pro: true,          elite: true },
  { label: "Automatic order execution",          core: true,   pro: true,          elite: true },
  { label: "Position sizing rules",              core: true,   pro: true,          elite: true },
  { label: "Custom signal extraction hints",     core: true,   pro: true,          elite: true },
  { label: "Range orders with optimized entry",  core: true,   pro: true,          elite: true },
  { label: "Entry if favorable filter",          core: true,   pro: true,          elite: true },
  { label: "Trade alerts & weekly P&L summary",  core: true,   pro: true,          elite: true },
  { label: "AI confidence threshold",            core: false,  pro: true,          elite: true },
  { label: "Trust Score per signal provider",    core: false,  pro: true,          elite: true },
  { label: "Advanced stats & charts",            core: false,  pro: true,          elite: true },
  { label: "Historical signal backtesting",      core: false,  pro: true,          elite: true },
  { label: "Monthly PDF performance report",     core: false,  pro: true,          elite: true },
  { label: "AI position management",             core: false,  pro: false,         elite: true },
  { label: "Signal deletion handling",           core: false,  pro: false,         elite: true },
  { label: "Auto-close on signal revocation",    core: false,  pro: false,         elite: true },
  { label: "Trading hours filter",               core: false,  pro: false,         elite: true },
  { label: "Economic calendar filter",           core: false,  pro: false,         elite: true },
  { label: "Community room visibility",          core: false,  pro: false,         elite: true },
  { label: "Copy trading across accounts",       core: false,  pro: false,         elite: true },
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
        <h3 className="text-2xl font-black text-center mb-10 text-white">Full Plan Comparison</h3>
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
  { q: "Do I need to be at my computer to execute signals?", a: "No. SignalFlow AI runs fully automatically, 24/7. As soon as a signal arrives from your Telegram room, the system recognizes it and opens the order on your account — even while you sleep, work, or travel. You don't have to do a thing." },
  { q: "What happens if a signal comes in at night?", a: "The system is always on. No downtime, no pauses. Every signal — day or night, weekends or holidays — is processed and the trade is opened automatically in under a second." },
  { q: "Which brokers does it work with?", a: "SignalFlow AI works with any broker that offers a MetaTrader 5 account: IC Markets, Pepperstone, Exness, XM, Tickmill, FP Markets and hundreds more. During setup, just enter your account credentials — the system verifies everything automatically." },
  { q: "Is my Telegram account safe?", a: "Yes. The system reads signal room messages in read-only mode — it never sends messages, modifies your account, or accesses your private chats. It only sees the groups you choose. Your credentials never leave your systems." },
  { q: "What is signal backtesting?", a: "Backtesting lets you test a provider's past signals against real historical market data, without risking real money. You can see how many trades would have won, total profit, max drawdown, and the equity curve. Great for evaluating a new analyst before following them." },
  { q: "How do custom trading rules work?", a: "You write your rules in plain language. Core includes position sizing rules (e.g. \"risk 1% per trade\"), signal extraction hints (e.g. \"ignore signals without a stop loss\"), and entry filters. Pro adds an AI confidence threshold to filter uncertain signals. Elite adds full position management rules (e.g. \"move to break-even at 50% of TP\"), trading hours, and economic calendar filters. No code required at any level." },
  { q: "Does the plan include everything, or are there hidden costs?", a: "The subscription includes everything: the automation engine, dashboard, analytics, and all infrastructure required to run the system. No surprise charges. The price you see is what you pay every month." },
  { q: "Can I use SignalFlow AI without technical knowledge?", a: "Absolutely. Setup is handled by Nova, our AI chat assistant — you just answer its questions in plain language. No forms, no manuals, nothing to install or code. Nova connects your Telegram, links your MT5 account, and even lets you preview a real signal before going live. Most users are up and running in under 5 minutes." },
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
          <h2 className="text-4xl font-black mt-4 text-white">Questions? We have answers.</h2>
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
          Stop missing trades.<br /><GradientText>Chat with Nova. Go live.</GradientText>
        </h2>
        <p className="text-lg text-white/48 mb-10 max-w-xl mx-auto">Connect your Telegram signal rooms and let the system execute every trade for you — no emotion, no delays, 24/7.</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <PrimaryBtn href="#pricing" className="text-base px-10 py-4 w-full sm:w-auto">Choose your plan →</PrimaryBtn>
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
            <p className="text-sm text-white/40 max-w-xs leading-relaxed">Trading automation for Telegram signal room followers. Your trades, executed automatically.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/28 mb-4">Product</p>
            <ul className="space-y-2.5 text-sm text-white/50">
              {[["#features","Features"],["#pricing","Pricing"],["#how-it-works","How It Works"],["#faq","FAQ"]].map(([href,label]) => (
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
