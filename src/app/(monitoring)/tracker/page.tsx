import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ForbiddenError, getCurrentAccount, MfaRequiredError, UnauthorizedError } from '@/lib/auth/account'
import { monitoringMe } from '@/lib/monitoring/team-access'
import { sanitizePreferences } from '@/lib/monitoring/preferences'
import { trackerLevel } from '@/lib/tracker/access'
import type { TrackerLevel } from '@/lib/tracker/model'
import { MonitoringSignOut } from '@/components/monitoring/workspace'
import { TrackerWorkspace } from '@/components/tracker/tracker-workspace'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clients · Numera CRM' }

export default async function TrackerPage() {
  let level: TrackerLevel | null
  let crm = false
  let name: string
  let metadataPrefs: Record<string, unknown> | undefined
  try {
    const account = await getCurrentAccount()
    name = account.account.name
    // Independent lookups run together (each one is a trip to the database).
    const [found, chats, claims] = await Promise.all([trackerLevel(account), monitoringMe().catch(() => null), account.supabase.auth.getClaims().catch(() => null)])
    level = found
    crm = !!chats
    metadataPrefs = claims?.data?.claims?.user_metadata as Record<string, unknown> | undefined
  } catch (error) {
    if (error instanceof MfaRequiredError) redirect('/login?step=code')
    if (error instanceof UnauthorizedError) redirect('/login')
    if (error instanceof ForbiddenError) level = null
    else throw error
    name = ''
  }
  if (!level) return <main className="mx-auto max-w-lg p-10">
    <h1 className="text-2xl font-semibold">No access to Clients</h1>
    <p className="my-4 text-muted-foreground">Ask the company owner to give you access in Clients → Settings.</p>
    <div className="flex gap-3">{crm && <Link className="underline" href="/monitoring">Open Chats</Link>}<MonitoringSignOut /></div>
  </main>
  return <TrackerWorkspace accountName={name} level={level} crm={crm} preferences={sanitizePreferences(metadataPrefs?.crm_preferences)} />
}
