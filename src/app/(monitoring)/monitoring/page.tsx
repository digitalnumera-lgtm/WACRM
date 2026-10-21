import { redirect } from 'next/navigation'
import { ForbiddenError, requireRole, UnauthorizedError } from '@/lib/auth/account'
import { MonitoringWorkspace, MonitoringSignOut } from '@/components/monitoring/workspace'

export const dynamic = 'force-dynamic'

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  let name: string
  try {
    const context = await requireRole('admin')
    name = context.account.name
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect('/login')
    if (error instanceof ForbiddenError) {
      return <main className="mx-auto max-w-lg p-10"><h1 className="text-2xl font-semibold">Management access required</h1><p className="my-4 text-muted-foreground">This inbox is available to your company’s owners and admins. Contact your company owner if you need access.</p><MonitoringSignOut /></main>
    }
    throw error
  }
  const { view } = await searchParams
  return <MonitoringWorkspace accountName={name} initialView={view === 'settings' ? 'Settings' : 'Inbox'} />
}
