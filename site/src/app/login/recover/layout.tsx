import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Recover Password",
  description: "Reset your METIS account password.",
}

export default function RecoverLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
