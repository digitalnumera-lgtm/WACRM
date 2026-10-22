import type { SupabaseClient } from '@supabase/supabase-js'
import { monitoringBatches, persistMonitoringBatches } from './ingest'
import type { ArchiveJob } from './media-archive'

/**
 * History deliveries that arrived before the CRM understood their format were
 * kept in full for review. Run them through the current parser and store any
 * that are now recognised. Safe to repeat: messages deduplicate by Meta ID.
 */
export async function reprocessStoredHistory(db: SupabaseClient, limit = 40): Promise<ArchiveJob[]> {
  const rows = await db.from('monitoring_events').select('id,channel_id,payload').eq('field', 'history').eq('needs_review', true).order('received_at').limit(limit)
  if (rows.error || !rows.data?.length) return []
  const channelIds = [...new Set(rows.data.map(r => r.channel_id).filter(Boolean))]
  const channels = await db.from('monitoring_channels').select('id,waba_id').in('id', channelIds)
  if (channels.error) return []
  const waba = new Map((channels.data ?? []).map(c => [c.id as string, c.waba_id as string]))
  const archive: ArchiveJob[] = []
  for (const row of rows.data as { id: string; channel_id: string; payload: unknown }[]) {
    const wabaId = waba.get(row.channel_id)
    if (!wabaId) continue
    let batches
    try { batches = monitoringBatches({ object: 'whatsapp_business_account', entry: [{ id: wabaId, changes: [row.payload] }] }) } catch { continue }
    if (!batches.length || batches.some(b => b.review && !b.messages.length)) continue // Still not recognised.
    archive.push(...await persistMonitoringBatches(db, batches.map(b => ({ ...b, hash: `reprocess:${b.hash}` }))))
    const done = await db.from('monitoring_events').update({ needs_review: false }).eq('id', row.id)
    if (done.error) break
  }
  return archive
}
