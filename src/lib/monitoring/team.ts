// Team & roles: validation shared by the /api/monitoring/team routes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkedId, MonitoringInputError } from './http'
import { isPermission, type Permission } from './permissions'

/** Invitations bind to a specific email, not to the company's email domain. */
export function teamEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) throw new MonitoringInputError('Enter a valid email address.')
  return email
}

export function roleInput(body: Record<string, unknown>, partial = false) {
  const out: { name?: string; description?: string | null; permissions?: Permission[] } = {}
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 60) throw new MonitoringInputError('Give the role a name of up to 60 characters.')
    out.name = name
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') throw new MonitoringInputError('Invalid description.')
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (description.length > 200) throw new MonitoringInputError('Keep the description under 200 characters.')
    out.description = description || null
  }
  if (!partial || body.permissions !== undefined) {
    if (!Array.isArray(body.permissions) || body.permissions.some(p => !isPermission(p))) throw new MonitoringInputError('Choose what this role may do.')
    // Every role can open the CRM and see conversations on its numbers.
    out.permissions = [...new Set(['view_inbox', ...(body.permissions as Permission[])])] as Permission[]
  }
  return out
}

/** `'admin'` for full access, or a custom role ID. */
export function accessInput(value: unknown): 'admin' | string {
  if (value === 'admin') return 'admin'
  return checkedId(String(value ?? ''))
}

/** null = every number; otherwise 1–100 of this company's channel IDs. */
export async function channelInput(db: SupabaseClient, accountId: string, value: unknown): Promise<string[] | null> {
  if (value === null || value === undefined || value === 'all') return null
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(id => typeof id !== 'string')) throw new MonitoringInputError('Choose at least one business number, or all numbers.')
  const ids = [...new Set((value as string[]).map(checkedId))]
  const result = await db.from('monitoring_channels').select('id').eq('account_id', accountId).in('id', ids)
  if (result.error) throw result.error
  if ((result.data ?? []).length !== ids.length) throw new MonitoringInputError('One or more business numbers are unavailable.')
  return ids
}

export async function ownRole(db: SupabaseClient, accountId: string, roleId: string) {
  const result = await db.from('monitoring_roles').select('id,name').eq('account_id', accountId).eq('id', roleId).maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new MonitoringInputError('That role no longer exists. Refresh and try again.')
  return result.data as { id: string; name: string }
}
