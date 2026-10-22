import { redirect } from 'next/navigation'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { monitoringMe } from '@/lib/monitoring/team-access'
import type { MonitoringMe } from '@/lib/monitoring/permissions'
import { MonitoringWorkspace, MonitoringSignOut } from '@/components/monitoring/workspace'
import { getCurrentAccount } from '@/lib/auth/account'

export const dynamic = 'force-dynamic'

function NoAccess() {
  return <main className="mx-auto max-w-lg p-10"><h1 className="text-2xl font-semibold">No CRM access yet</h1><p className="my-4 text-muted-foreground">Your login works, but your company owner has not given you a role in the CRM yet. Ask them to assign you a role in Settings → Team &amp; roles, then sign in again.</p><MonitoringSignOut /></main>
}

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  let me: MonitoringMe | null
  let name: string
  try {
    me = await monitoringMe()
    name = (await getCurrentAccount()).account.name
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect('/login')
    if (error instanceof ForbiddenError) return <NoAccess />
    throw error
  }
  if (!me) return <NoAccess />
  const { view } = await searchParams
  return <MonitoringWorkspace accountName={name} me={me} initialView={view === 'settings' ? 'Settings' : 'Inbox'} />
}
