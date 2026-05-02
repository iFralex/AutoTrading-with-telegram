import type { Metadata } from "next"
import { DashboardLayoutClient } from "@/src/components/dashboard/DashboardLayoutClient"

export const metadata: Metadata = {
  title: {
    default: "Dashboard | METIS",
    template: "%s | METIS",
  },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>
}
