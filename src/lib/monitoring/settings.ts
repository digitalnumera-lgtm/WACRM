import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// A deterministic, company-owned configuration record in the existing private
// ledger avoids requiring a schema migration on the recovered database. Its
// channel FK is anchored to an existing number; soft removal retains that row.
function settingsId(account: string) {
  const h = createHash('sha256').update(`monitoring-settings:v1:${account}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
export async function managementRepliesEnabled(db: SupabaseClient, account: string) {
  const result = await db.from('monitoring_events').select('payload').eq('account_id', account).eq('id', settingsId(account)).eq('field', 'management_settings').maybeSingle()
  if (result.error) throw new Error('Workspace settings unavailable')
  // Preserve existing behavior until management explicitly changes the setting.
  if (!result.data) return true
  if (typeof result.data.payload?.management_replies_enabled !== 'boolean') throw new Error('Invalid workspace settings')
  return result.data.payload.management_replies_enabled as boolean
}
export async function saveManagementReplies(db: SupabaseClient, account: string, actor: string, enabled: boolean) {
  const anchor = await db.from('monitoring_channels').select('id').eq('account_id', account).order('created_at').order('id').limit(1).maybeSingle()
  if (anchor.error) throw new Error('Workspace numbers unavailable')
  if (!anchor.data) return false
  const id = settingsId(account)
  const result = await db.from('monitoring_events').upsert({ id, account_id: account, channel_id: anchor.data.id,
    event_hash: `management-settings:${account}`, field: 'management_settings', needs_review: false,
    payload: { management_replies_enabled: enabled, updated_by: actor, updated_at: new Date().toISOString() },
  }, { onConflict: 'id' })
  if (result.error) throw new Error('Unable to save workspace settings')
  return true
}
