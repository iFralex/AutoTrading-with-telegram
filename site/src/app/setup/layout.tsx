import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Get Started",
  description: "Set up your METIS account and connect your MT5 trading account in minutes.",
}

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
