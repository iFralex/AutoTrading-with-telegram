import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Backtest",
}

export default function BacktestLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
