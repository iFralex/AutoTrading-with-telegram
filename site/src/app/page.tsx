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
          {[["#features", "Funzionalità"], ["#how-it-works", "Come funziona"], ["#pricing", "Prezzi"], ["#faq", "FAQ"]].map(([href, label]) => (
            <a key={href} href={href} className="hover:text-white transition-colors">{label}</a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-white/50 hover:text-white transition-colors px-4 py-2">Accedi</Link>
          <PrimaryBtn href="#pricing" className="text-sm px-5 py-2">Inizia ora</PrimaryBtn>
        </div>

        <button className="md:hidden text-white/60 hover:text-white" onClick={() => setOpen(!open)}>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="md:hidden px-6 pb-4 text-sm text-white/70 flex flex-col gap-3 border-t border-white/5">
          {[["#features", "Funzionalità"], ["#how-it-works", "Come funziona"], ["#pricing", "Prezzi"], ["#faq", "FAQ"]].map(([href, label]) => (
            <a key={href} href={href} className="hover:text-white py-1" onClick={() => setOpen(false)}>{label}</a>
          ))}
          <PrimaryBtn href="#pricing" className="text-sm px-5 py-2.5 mt-2 text-center w-full" onClick={() => setOpen(false)}>Inizia ora</PrimaryBtn>
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
            Zero emozioni · Esecuzione istantanea · Sempre attivo
          </Badge>
        </div>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-black leading-tight tracking-tight mb-6 text-white">
          Smetti di perdere trade.<br />
          <GradientText>Inizia a guadagnare in automatico.</GradientText>
        </h1>

        <p className="text-lg sm:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
          Segui le tue sale segnali su Telegram e lascia che la nostra AI esegua ogni trade per te —
          in meno di un secondo, senza esitazioni, senza emozioni,{" "}
          <strong className="text-white/75">24 ore su 24.</strong>
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <PrimaryBtn href="#pricing" className="text-base px-8 py-4 w-full sm:w-auto">Inizia in 3 minuti →</PrimaryBtn>
          <OutlineBtn href="#how-it-works" className="text-base px-8 py-4 w-full sm:w-auto">Come funziona</OutlineBtn>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-14 text-center">
          {[["24/7", "Sempre Attivo"], ["<1s", "Segnale → Ordine"], ["0", "Emozioni"], ["3 min", "Setup Guidato"]].map(([val, label], i) => (
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
    { num: "1", from: "from-emerald-400", to: "to-cyan-400", title: "Collega le tue sale segnali", body: "In pochi minuti colleghi il tuo account Telegram e scegli quali gruppi segnali monitorare. Poi inserisci i dati del tuo conto di trading. Nessuna programmazione, nessuna competenza tecnica richiesta.", tags: [["Telegram","text-emerald-400 bg-emerald-400/10 border-emerald-400/20"],["Conto trading","text-emerald-400 bg-emerald-400/10 border-emerald-400/20"],["Guidato passo per passo","text-emerald-400 bg-emerald-400/10 border-emerald-400/20"]] },
    { num: "2", from: "from-cyan-400", to: "to-violet-500", title: "La AI legge ogni messaggio", body: "Il nostro motore AI analizza ogni messaggio in tempo reale. Riconosce i segnali di trading — anche quelli scritti in modo informale — ed estrae automaticamente direzione, entry, stop loss e take profit.", tags: [["Rilevamento segnali","text-violet-400 bg-violet-400/10 border-violet-400/20"],["Parsing automatico","text-violet-400 bg-violet-400/10 border-violet-400/20"],["Filtro anti-rumore","text-violet-400 bg-violet-400/10 border-violet-400/20"]] },
    { num: "3", from: "from-violet-500", to: "to-red-500", title: "Il trade si apre in automatico", body: "In meno di un secondo il tuo ordine è aperto sul conto, con stop loss e take profit già impostati. Nessuna esitazione, nessuna emozione: solo esecuzione precisa, ogni volta.", tags: [["Esecuzione istantanea","text-red-400 bg-red-400/10 border-red-400/20"],["Zero emozioni","text-red-400 bg-red-400/10 border-red-400/20"],["Attivo 24/7","text-red-400 bg-red-400/10 border-red-400/20"]] },
  ]
  return (
    <section id="how-it-works" className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[500px] h-[500px] rounded-full blur-[120px] top-1/2 -left-48 -translate-y-1/2 bg-violet-600/15 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10">
        <Reveal className="text-center mb-16">
          <Badge>Come funziona</Badge>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-4 text-white">Tre passi. Zero fatica.</h2>
          <p className="text-lg text-white/45 max-w-xl mx-auto">Dal segnale Telegram all&apos;ordine aperto in meno di un secondo — in automatico, sempre attivo.</p>
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
  { path: "M13 10V3L4 14h7v7l9-11h-7z", color: "text-emerald-400 bg-emerald-400/10", title: "Esecuzione istantanea dei segnali", body: "Ogni segnale viene eseguito in meno di un secondo, prima ancora che tu abbia il tempo di leggerlo. Nessuna perdita di entry per distrazione o ritardo." },
  { path: "M12 2a10 10 0 100 20A10 10 0 0012 2zM12 8v4l3 3", color: "text-cyan-400 bg-cyan-400/10", title: "Gestione automatica delle posizioni", body: "Puoi istruire il sistema su come gestire le posizioni aperte: spostare lo stop loss in pareggio, ridurre il rischio, o chiudere automaticamente al raggiungimento di obiettivi." },
  { path: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", color: "text-violet-400 bg-violet-400/10", title: "Statistiche complete sulle performance", body: "Win rate, profitto netto, profit factor, drawdown massimo, curve di equity — per ogni sala segnali che segui. Sai esattamente chi porta risultati e chi no." },
  { path: "M4 6h16M4 12h16M4 18h7", color: "text-amber-400 bg-amber-400/10", title: "Backtest storico dei segnali", body: "Prima di seguire una nuova sala segnali, metti alla prova i suoi segnali passati sui dati storici del mercato. Scopri se avrebbe guadagnato o perso soldi — senza rischiare nulla." },
  { path: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75", color: "text-red-400 bg-red-400/10", title: "Segui più sale segnali contemporaneamente", body: "Monitora quanti gruppi Telegram vuoi allo stesso tempo. Ogni sala ha le sue impostazioni indipendenti: diversa gestione del rischio, diversa dimensione delle posizioni." },
  { path: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", color: "text-green-400 bg-green-400/10", title: "I tuoi dati sono al sicuro", body: "Le credenziali del tuo conto trading non escono mai dai tuoi sistemi. L'accesso al tuo Telegram è in sola lettura: non può inviare messaggi né modificare nulla." },
  { path: "M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z", color: "text-emerald-400 bg-emerald-400/10", title: "Protezione automatica dal rischio", body: "Se un analista cancella un segnale, il sistema reagisce in automatico: chiude la posizione, sposta lo stop, o riduce il volume — in base alle tue preferenze." },
  { path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", color: "text-cyan-400 bg-cyan-400/10", title: "Storico completo di ogni trade", body: "Ogni segnale ricevuto, ogni ordine aperto, ogni risultato: tutto registrato con data, ora e dettagli completi. Sai sempre cosa è successo e perché." },
  { path: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z", color: "text-violet-400 bg-violet-400/10", title: "Testa qualsiasi segnale senza rischi", body: "Incolla un messaggio di segnale e guarda come il sistema lo interpreterebbe, prima ancora di attivarlo sul tuo conto. Perfetto per valutare nuovi analisti." },
]

function Features() {
  return (
    <section id="features" className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[600px] h-[600px] rounded-full blur-[120px] -top-24 -right-48 bg-emerald-500/12 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10">
        <Reveal className="text-center mb-16">
          <Badge>Funzionalità</Badge>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-4 text-white">
            Tutto quello che ti serve.<br />
            <GradientText>Niente di superfluo.</GradientText>
          </h2>
          <p className="text-lg text-white/45 max-w-xl mx-auto">Ogni funzione è pensata per un trader che vuole smettere di perdere tempo e opportunità.</p>
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
    { letter: "1", gradient: "from-emerald-400 to-cyan-400", textBlack: true, title: "Rilevamento del segnale", body: "Il sistema legge ogni messaggio in tempo reale e riconosce immediatamente se è un segnale di trading — anche scritto in modo informale o in lingue diverse.", tag: <><span className="px-2 py-0.5 rounded text-xs bg-emerald-400/10 text-emerald-400">Segnale ✓</span><span className="px-2 py-0.5 rounded text-xs bg-white/5 text-white/40">Rumore ✗</span></> },
    { letter: "2", gradient: "from-violet-700 to-violet-500", textBlack: false, title: "Parsing automatico", body: "Il motore AI estrae da ogni segnale la direzione, il prezzo di entrata, lo stop loss e il take profit — in qualsiasi formato, anche non strutturato.", tag: <span className="font-mono px-2 py-0.5 rounded text-xs bg-white/5 text-emerald-400">{"BUY XAUUSD @ 2342 · SL 2330 · TP 2360"}</span> },
    { letter: "3", gradient: "from-amber-500 to-red-500", textBlack: false, title: "Filtro personalizzato", model: "Solo Elite", elite: true, body: "Puoi definire le tue regole di trading in linguaggio naturale. Il sistema le applica ad ogni segnale: approva, ignora o modifica prima di aprire l'ordine." },
    { letter: "✓", gradient: "from-green-500 to-green-700", textBlack: true, title: "Ordine aperto in automatico", body: "L'ordine viene aperto sul tuo conto in meno di un secondo, con stop loss e take profit già impostati. La posizione viene monitorata finché non si chiude." },
  ]
  const dividerGrads = ["from-emerald-400/40 to-violet-500/40","from-violet-500/40 to-red-500/40","from-red-500/40 to-green-500/40"]

  return (
    <section className="relative py-28 px-6 overflow-hidden bg-[#07090f]">
      <div className="absolute w-[500px] h-[500px] rounded-full blur-[120px] -bottom-24 left-1/2 -translate-x-1/2 bg-blue-500/10 pointer-events-none" />
      <div className="max-w-6xl mx-auto relative z-10 grid lg:grid-cols-2 gap-16 items-center">
        {/* Pipeline visual */}
        <Reveal>
          <GlassCard className="p-6 border-violet-500/20">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/35 mb-6">Come lavora il motore AI</p>
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
          <Badge>Motore AI proprietario</Badge>
          <h2 className="text-4xl font-black mt-6 mb-6 text-white">Legge qualsiasi segnale.<br />Esegue in millisecondi.</h2>
          <p className="text-white/50 leading-relaxed mb-6">Il nostro motore AI è addestrato per capire i segnali di trading in qualsiasi formato — non solo quelli strutturati. Funziona anche con analisti che scrivono in modo informale, cambiano formato o usano abbreviazioni.</p>
          <ul className="space-y-4">
            {[
              "Capisce segnali scritti in qualsiasi lingua o stile",
              "Zero configurazione: nessun codice, nessuna formula",
              "Puoi impostare regole di rischio in linguaggio naturale",
              "Ogni decisione è tracciata e consultabile nella dashboard",
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
    name: "Core", price: "€79", tagline: "Ideale per chi inizia a seguire le sale segnali e vuole automatizzare subito.",
    ctaLabel: "Inizia ora",
    features: [
      { label: "1 sala segnali Telegram" },
      { label: "Rilevamento automatico dei segnali" },
      { label: "Esecuzione istantanea degli ordini" },
      { label: "Stop loss e take profit automatici" },
      { label: "Dashboard con statistiche base" },
      { label: "Storico completo dei segnali" },
      { label: "Storico dei trade recenti" },
      { label: "Test segnali senza rischio" },
      { label: "Setup guidato passo per passo" },
      { label: "Credenziali protette e crittografate" },
    ],
    notIncluded: ["Analisi avanzata dei segnali", "Statistiche avanzate e backtest", "Regole di trading personalizzate"],
  },
  {
    name: "Pro", price: "€149", tagline: "Per i trader attivi che vogliono dati, statistiche e seguire più analisti contemporaneamente.",
    popular: true, ctaLabel: "Inizia ora →", prevPlan: "Core",
    features: [
      { label: "Fino a 5 sale segnali Telegram", bold: true },
      { label: "Analisi avanzata dei segnali (zero falsi positivi)" },
      { label: "Configurazione separata per ogni sala" },
      { label: "Ordini a range con entrata ottimizzata" },
      { label: "Statistiche complete e grafici" },
      { label: "Backtest storico dei segnali" },
      { label: "Dashboard performance (win rate, drawdown, P&L)" },
      { label: "Metriche avanzate (profit factor, Sharpe ratio)" },
      { label: "Copia impostazioni tra sale diverse" },
    ],
    notIncluded: ["Regole di trading personalizzate", "Gestione automatica delle posizioni", "Copy trading su più conti"],
  },
  {
    name: "Elite", price: "€299", tagline: "Per trader professionisti e chi gestisce più conti. Il controllo totale.",
    elite: true, ctaLabel: "Contatta il team", prevPlan: "Pro",
    features: [
      { label: "Sale segnali illimitate", bold: true },
      { label: "Regole di trading personalizzate (approva / ignora / modifica)", bold: true },
      { label: "Gestione automatica delle posizioni aperte", bold: true },
      { label: "Chiusura automatica quando un segnale viene cancellato", bold: true },
      { label: "Copy trading su più conti", bold: true },
      { label: "Supporto prioritario con onboarding dedicato", bold: true },
      { label: "Sessione di configurazione strategia personalizzata", bold: true },
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
          <Badge>Piani e prezzi</Badge>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-4 text-white">
            Scegli il tuo piano.<br /><GradientText>Inizia ad automatizzare.</GradientText>
          </h2>
          <p className="text-lg text-white/45 max-w-xl mx-auto">Tutti i piani includono il motore di automazione, la dashboard e il setup guidato. Nessun contratto. Disdici quando vuoi.</p>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6 items-stretch">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 100}>
              <PricingCard plan={plan} />
            </Reveal>
          ))}
        </div>
        <p className="text-center text-xs mt-8 text-white/28">Prezzi IVA esclusa. L&apos;abbonamento include tutta l&apos;infrastruttura necessaria. Nessun contratto — disdici in qualsiasi momento.</p>
      </div>
    </section>
  )
}

// ─── Comparison Table ──────────────────────────────────────────────────────
const TABLE: { label: string; core: boolean | string; pro: boolean | string; elite: boolean | string }[] = [
  { label: "Sale segnali monitorate",              core: "1",    pro: "5",         elite: "Illimitate" },
  { label: "Rilevamento automatico dei segnali",   core: true,   pro: true,        elite: true },
  { label: "Analisi avanzata dei segnali",         core: false,  pro: true,        elite: true },
  { label: "Esecuzione ordini automatica",         core: true,   pro: true,        elite: true },
  { label: "Ordini a range con entrata ottimale",  core: false,  pro: true,        elite: true },
  { label: "Statistiche e grafici avanzati",       core: false,  pro: true,        elite: true },
  { label: "Backtest storico dei segnali",         core: false,  pro: true,        elite: true },
  { label: "Regole di trading personalizzate",     core: false,  pro: false,       elite: true },
  { label: "Gestione automatica delle posizioni",  core: false,  pro: false,       elite: true },
  { label: "Auto-chiusura su segnale cancellato",  core: false,  pro: false,       elite: true },
  { label: "Copy trading su più conti",            core: false,  pro: false,       elite: true },
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
        <h3 className="text-2xl font-black text-center mb-10 text-white">Confronto completo tra i piani</h3>
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
  { q: "Devo essere davanti al computer per eseguire i segnali?", a: "No. SignalFlow AI lavora in automatico, 24 ore su 24. Appena arriva un segnale dalla tua sala Telegram, il sistema lo riconosce e apre l'ordine sul tuo conto — anche mentre dormi, lavori o sei in vacanza. Non devi fare nulla." },
  { q: "Cosa succede se un segnale arriva di notte?", a: "Il sistema è sempre attivo. Non ci sono orari di pausa. Ogni segnale che arriva — di giorno o di notte, nei weekend o durante le festività — viene elaborato e il trade viene aperto in automatico in meno di un secondo." },
  { q: "Con quali broker funziona?", a: "SignalFlow AI funziona con qualsiasi broker che offre un conto MetaTrader 5: IC Markets, Pepperstone, Exness, XM, Tickmill, FP Markets e centinaia di altri. Durante il setup inserisci semplicemente i dati del tuo conto — il sistema verifica tutto automaticamente." },
  { q: "Il mio account Telegram è al sicuro?", a: "Sì. Il sistema legge i messaggi delle sale segnali solo in lettura — non invia mai messaggi, non modifica il tuo account e non accede alle tue chat private. Vede solo i gruppi che scegli tu. I tuoi dati di accesso non escono mai dai tuoi sistemi." },
  { q: "Cos'è il backtest dei segnali?", a: "Il backtest ti permette di testare i segnali passati di un analista sui dati storici del mercato, senza rischiare soldi veri. Puoi vedere quanti trade avrebbe vinto, il profitto totale, il massimo drawdown e la curva di equity. Ottimo per valutare un nuovo analista prima di seguirlo." },
  { q: "Come funzionano le regole di trading personalizzate? (Solo Elite)", a: "Puoi scrivere le tue regole in linguaggio semplice — ad esempio \"entra solo su BUY sull'oro\" o \"non aprire nuovi trade il venerdì sera\". Il sistema applica queste regole ad ogni segnale prima di eseguirlo. Nessun codice richiesto." },
  { q: "Il piano include tutto o ci sono costi nascosti?", a: "L'abbonamento include tutto: il motore di automazione, la dashboard, le statistiche e l'infrastruttura necessaria per far funzionare il sistema. Non ci sono costi aggiuntivi a sorpresa. Il prezzo che vedi è quello che paghi ogni mese." },
  { q: "Posso usare SignalFlow AI senza esperienza tecnica?", a: "Assolutamente sì. È pensato proprio per chi non ha competenze tecniche. Il setup è guidato passo per passo e richiede meno di 3 minuti. Non devi installare nulla, non devi scrivere codice e non devi capire come funziona la tecnologia dietro. Ti connetti e funziona." },
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
          <Badge>Domande frequenti</Badge>
          <h2 className="text-4xl font-black mt-4 text-white">Hai domande? Abbiamo le risposte.</h2>
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
        <Badge>Pronto ad automatizzare?</Badge>
        <h2 className="text-4xl md:text-5xl font-black mt-6 mb-6 text-white">
          Smetti di perdere trade.<br /><GradientText>Inizia in 3 minuti.</GradientText>
        </h2>
        <p className="text-lg text-white/48 mb-10 max-w-xl mx-auto">Connetti le tue sale segnali Telegram e lascia che il sistema esegua ogni trade per te — senza emozioni, senza ritardi, 24 ore su 24.</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <PrimaryBtn href="#pricing" className="text-base px-10 py-4 w-full sm:w-auto">Scegli il tuo piano →</PrimaryBtn>
          <OutlineBtn href="#faq" className="text-base px-8 py-4 w-full sm:w-auto">Leggi le FAQ</OutlineBtn>
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
            <p className="text-sm text-white/40 max-w-xs leading-relaxed">Automazione del trading per chi segue sale segnali su Telegram. I tuoi trade, eseguiti in automatico.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/28 mb-4">Product</p>
            <ul className="space-y-2.5 text-sm text-white/50">
              {[["#features","Funzionalità"],["#pricing","Prezzi"],["#how-it-works","Come funziona"],["#faq","FAQ"]].map(([href,label]) => (
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
