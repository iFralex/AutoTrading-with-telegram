import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Signal Rooms",
}

export default function RoomsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
