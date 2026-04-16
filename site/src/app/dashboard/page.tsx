import { DashboardShell } from "@/src/components/dashboard/DashboardShell"

interface Props {
  searchParams: Promise<{ phone?: string }>
}

export default async function DashboardPage({ searchParams }: Props) {
  const { phone } = await searchParams
  return <DashboardShell initialPhone={phone} />
}
