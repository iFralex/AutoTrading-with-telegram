import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Log In",
  description: "Sign in to your METIS account to manage your automated trading signals.",
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
