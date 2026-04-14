import { Dashboard } from "@/components/dashboard/Dashboard"

interface Props {
  searchParams: Promise<{ phone?: string }>
}

export default async function DashboardPage({ searchParams }: Props) {
  const { phone } = await searchParams
  return (
    <main className="min-h-screen p-6 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-600/6 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-violet-600/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.018] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto">
        <Dashboard initialPhone={phone} />
      </div>
    </main>
  )
}
