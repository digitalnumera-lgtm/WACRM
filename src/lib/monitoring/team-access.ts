// Server-side access check for every /api/monitoring route.
//
// Owners and admins keep full access through their normal (RLS) session.
// Other team members need a custom role (monitoring_member_access) that allows
// the requested permission; their data is read with the service role, always
// filtered by company and by the business numbers assigned to them.
import type { SupabaseClient } from '@supabase/supabase-js'
import { ForbiddenError, requireRole, type AccountContext } from '@/lib/auth/account'
import { monitoringAdmin } from './admin'
import { isPermission, PERMISSIONS, type MonitoringMe, type Permission } from './permissions'

export interface MonitoringAccess extends AccountContext {
  /** Owner or admin. */
  full: boolean
  roleName: string
  permissions: Set<Permission>
  /** null = every business number; otherwise only these channels. */
  channelIds: string[] | null
  /** Client for CRM reads: the RLS session for owners/admins, the service role (with explicit filters) for members. */
  db: SupabaseClient
  /** Paused or removed numbers: their chats and stats stay out of CRM views. */
  hiddenIds: string[]
}

const NO_CHANNEL = '00000000-0000-0000-0000-000000000000'
const CACHE_MS = process.env.NODE_ENV === 'production' ? 30_000 : 0
type MemberGrant = { roleName: string; permissions: Permission[]; channelIds: string[] | null }
const grants = new Map<string, { expires: number; grant: MemberGrant | null }>()
const hiddenNumbers = new Map<string, { expires: number; ids: string[] }>()

/** Call after a number is paused, removed or restored. */
export function forgetHiddenNumbers(accountId: string) { hiddenNumbers.delete(accountId) }

async function hiddenChannelIds(db: SupabaseClient, accountId: string): Promise<string[]> {
  const cached = CACHE_MS ? hiddenNumbers.get(accountId) : undefined
  if (cached && cached.expires > Date.now()) return cached.ids
  let ids: string[] = []
  try {
    const result = await db.from('monitoring_channels').select('id,active').eq('account_id', accountId)
    if (!result.error && Array.isArray(result.data)) ids = (result.data as { id?: unknown; active?: unknown }[]).filter(r => r.active === false && typeof r.id === 'string').map(r => r.id as string)
  } catch { ids = [] }
  if (CACHE_MS) {
    if (hiddenNumbers.size > 500) hiddenNumbers.clear()
    hiddenNumbers.set(accountId, { expires: Date.now() + CACHE_MS, ids })
  }
  return ids
}

/** Drop cached access after a team change so it applies immediately on this server. */
export function forgetMemberAccess(accountId: string, userId?: string) {
  if (!userId) { for (const key of grants.keys()) if (key.startsWith(`${accountId}:`)) grants.delete(key); return }
  grants.delete(`${accountId}:${userId}`)
}

async function memberGrant(accountId: string, userId: string): Promise<MemberGrant | null> {
  const key = `${accountId}:${userId}`
  const cached = CACHE_MS ? grants.get(key) : undefined
  if (cached && cached.expires > Date.now()) return cached.grant
  const result = await monitoringAdmin().from('monitoring_member_access')
    .select('channel_ids, monitoring_roles(name, permissions)')
    .eq('account_id', accountId).eq('user_id', userId).maybeSingle()
  // Missing table (update not installed yet) or no row: no CRM access.
  const row = result.error ? null : result.data as { channel_ids: string[] | null; monitoring_roles: { name: string; permissions: string[] } | { name: string; permissions: string[] }[] | null } | null
  const role = Array.isArray(row?.monitoring_roles) ? row?.monitoring_roles[0] : row?.monitoring_roles
  const grant = row && role ? { roleName: role.name, permissions: (role.permissions ?? []).filter(isPermission), channelIds: row.channel_ids ?? null } : null
  if (CACHE_MS) {
    if (grants.size > 500) grants.clear()
    grants.set(key, { expires: Date.now() + CACHE_MS, grant })
  }
  return grant
}

/**
 * Signed-in member allowed to perform `permission`, or 'full' for owner/admin-only
 * actions (team management, management replies). Throws Unauthorized/Forbidden.
 */
export async function requireMonitoring(permission: Permission | 'full'): Promise<MonitoringAccess> {
  const ctx = await requireRole('viewer')
  if (ctx.role === 'owner' || ctx.role === 'admin') {
    return { ...ctx, full: true, roleName: ctx.role === 'owner' ? 'Owner' : 'Admin', permissions: new Set(PERMISSIONS), channelIds: null, db: ctx.supabase, hiddenIds: await hiddenChannelIds(ctx.supabase, ctx.accountId) }
  }
  if (permission === 'full') throw new ForbiddenError()
  const grant = await memberGrant(ctx.accountId, ctx.userId)
  if (!grant || !grant.permissions.includes(permission)) throw new ForbiddenError()
  const db = monitoringAdmin()
  return { ...ctx, full: false, roleName: grant.roleName, permissions: new Set(grant.permissions), channelIds: grant.channelIds, db, hiddenIds: await hiddenChannelIds(db, ctx.accountId) }
}

/** Current user's CRM access for the UI, or null when they have none. */
export async function monitoringMe(): Promise<MonitoringMe | null> {
  const ctx = await requireRole('viewer')
  if (ctx.role === 'owner' || ctx.role === 'admin') return { full: true, role: ctx.role === 'owner' ? 'Owner' : 'Admin', permissions: [...PERMISSIONS], channelIds: null }
  const grant = await memberGrant(ctx.accountId, ctx.userId)
  return grant ? { full: false, role: grant.roleName, permissions: grant.permissions, channelIds: grant.channelIds } : null
}

type Scope = Pick<MonitoringAccess, 'channelIds'> & { hiddenIds?: string[] }
type Options = { includeHidden?: boolean }

/** Member scope, and (unless includeHidden) not a paused or removed number. */
export function canSeeChannel(access: Scope, channelId: string | null | undefined, { includeHidden = false }: Options = {}): boolean {
  if (!includeHidden && channelId && access.hiddenIds?.includes(channelId)) return false
  return access.channelIds === null || (!!channelId && access.channelIds.includes(channelId))
}

/** Leaves out paused or removed numbers. */
export function hideNumbers<Q>(access: Pick<Scope, 'hiddenIds'>, query: Q, column = 'channel_id'): Q {
  if (!access.hiddenIds?.length) return query
  return (query as unknown as { not: (column: string, operator: string, value: string) => Q }).not(column, 'in', `(${access.hiddenIds.join(',')})`)
}

/** Limits a query to the member's numbers and, unless includeHidden, to numbers still monitored. */
export function scopeChannels<Q>(access: Scope, query: Q, column = 'channel_id', { includeHidden = false }: Options = {}): Q {
  let scoped = query
  if (access.channelIds !== null) {
    const ids = access.channelIds.length ? access.channelIds : [NO_CHANNEL]
    scoped = (scoped as unknown as { in: (column: string, values: string[]) => Q }).in(column, ids)
  }
  return includeHidden ? scoped : hideNumbers(access, scoped, column)
}

/**
 * Combines optional channel filters (number / agent label) with the member's
 * scope. Returns null for "no restriction", or the allowed channel IDs.
 * Paused or removed numbers are dropped from a list; for null, apply hideNumbers.
 */
export function allowedChannels(access: Scope, requested: string[] | null): string[] | null {
  const visible = (ids: string[]) => access.hiddenIds?.length ? ids.filter(id => !access.hiddenIds!.includes(id)) : ids
  if (access.channelIds === null) return requested && visible(requested)
  if (requested === null) return visible(access.channelIds)
  return visible(requested.filter(id => access.channelIds!.includes(id)))
}

/** Adding or listing numbers is only for members who may see every number. */
export function assertAllNumbers(access: Pick<MonitoringAccess, 'channelIds'>) {
  if (access.channelIds !== null) throw new ForbiddenError()
}
