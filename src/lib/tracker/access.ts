// Server-side access check for every /api/tracker route. Separate from the
// WhatsApp CRM's roles: the company owner always has full access; anyone else
// needs a tracker_access row, read fresh on every request so a change or
// removal applies on their next click.
import { ForbiddenError, requireRole, type AccountContext } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { atLeast, type TrackerLevel } from './model'

export interface TrackerAccess extends AccountContext { level: TrackerLevel }

const LEVELS = ['view', 'amounts', 'full'] as const
export const isGrantLevel = (value: unknown): value is Exclude<TrackerLevel, 'owner'> => (LEVELS as readonly unknown[]).includes(value)

/** The caller's tracker level, or null without access (or before the tracker update is installed). */
export async function trackerLevel(ctx: Pick<AccountContext, 'accountId' | 'userId' | 'role'>): Promise<TrackerLevel | null> {
  if (ctx.role === 'owner') return 'owner'
  const row = await monitoringAdmin().from('tracker_access').select('level').eq('account_id', ctx.accountId).eq('user_id', ctx.userId).maybeSingle()
  if (row.error || !row.data) return null
  return isGrantLevel(row.data.level) ? row.data.level : null
}

export async function requireTracker(min: TrackerLevel): Promise<TrackerAccess> {
  const ctx = await requireRole('viewer')
  const level = await trackerLevel(ctx)
  if (!level || !atLeast(level, min)) throw new ForbiddenError()
  return { ...ctx, level }
}
