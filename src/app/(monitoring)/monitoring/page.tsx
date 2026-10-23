import { redirect } from 'next/navigation'
import { ForbiddenError, getCurrentAccount, MfaRequiredError, UnauthorizedError } from '@/lib/auth/account'
import { monitoringMe } from '@/lib/monitoring/team-access'
import { sanitizePreferences } from '@/lib/monitoring/preferences'
import type { MonitoringMe } from '@/lib/monitoring/permissions'
import { trackerLevel } from '@/lib/tracker/access'
import { MonitoringWorkspace, MonitoringSignOut, type SettingsSection } from '@/components/monitoring/workspace'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Chats · Numera CRM' }

function NoAccess({ tracker = false }: { tracker?: boolean }) {
  return <main className="mx-auto max-w-lg p-10"><h1 className="text-2xl font-semibold">No access to Chats yet</h1><p className="my-4 text-muted-foreground">Ask your company owner to give you a role in Settings → Team &amp; roles, then sign in again.</p><div className="flex gap-3">{tracker && <a className="underline" href="/tracker">Open the Client Tracker</a>}<MonitoringSignOut /></div></main>
}

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ view?: string; section?: string }> }) {
  let me: MonitoringMe | null
  let name: string
  let metadata: Record<string, unknown> | undefined
  let tracker = false
  try {
    const account = await getCurrentAccount()
    name = account.account.name
    // Independent lookups run together (each one is a trip to the database).
    // Preferences travel in the (locally verified) session token.
    const [access, level, claims] = await Promise.all([monitoringMe(), trackerLevel(account).catch(() => null), account.supabase.auth.getClaims().catch(() => null)])
    me = access
    tracker = !!level
    metadata = claims?.data?.claims?.user_metadata as Record<string, unknown> | undefined
  } catch (error) {
    if (error instanceof MfaRequiredError) redirect('/login?step=code')
    if (error instanceof UnauthorizedError) redirect('/login')
    if (error instanceof ForbiddenError) return <NoAccess />
    throw error
  }
  if (!me) return <NoAccess tracker={tracker} />
  const { view, section } = await searchParams
  return <MonitoringWorkspace accountName={name} me={me} preferences={sanitizePreferences(metadata?.crm_preferences)}
    initialView={view === 'settings' ? 'Settings' : undefined} initialSection={section as SettingsSection | undefined} tracker={tracker} />
}
