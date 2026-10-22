import type { SupabaseClient } from '@supabase/supabase-js'

// Like WhatsApp: the counter shows customer messages the agent has not replied
// to yet, and clears as soon as the agent replies.
const LOOKBACK = 100
const ignored = new Set(['reaction', 'revoke'])

/** Customer messages after the agent's last reply (newest first input). */
export function unanswered(messages: { direction: string; kind?: string | null }[] | null | undefined) {
  let count = 0
  for (const message of messages ?? []) {
    if (message.direction === 'outbound') break
    if (message.direction === 'inbound' && !ignored.has(message.kind ?? '')) count++
  }
  return count
}

/** Unanswered counts for these conversations, or null if they could not be read. */
export async function waitingCounts(db: SupabaseClient, accountId: string, ids: string[]): Promise<Record<string, number> | null> {
  if (!ids.length) return {}
  try {
    const result = await db.from('monitoring_threads').select('id,monitoring_messages(direction,kind)').eq('account_id', accountId).in('id', ids)
      .order('sent_at', { referencedTable: 'monitoring_messages', ascending: false })
      .limit(LOOKBACK, { referencedTable: 'monitoring_messages' })
    if (result.error || !Array.isArray(result.data)) return null
    return Object.fromEntries((result.data as { id: string; monitoring_messages?: { direction: string; kind?: string | null }[] }[]).map(row => [row.id, unanswered(row.monitoring_messages)]))
  } catch { return null }
}

/** Adds waiting_count to rows where the customer spoke last. */
export async function withWaitingCounts<T extends { id: string; last_direction: string; state?: string }>(db: SupabaseClient, accountId: string, rows: T[]): Promise<(T & { waiting_count?: number })[]> {
  const ids = rows.filter(r => r.last_direction === 'inbound' && r.state !== 'resolved').map(r => r.id)
  const counts = await waitingCounts(db, accountId, ids)
  if (!counts) return rows
  return rows.map(r => r.id in counts ? { ...r, waiting_count: counts[r.id] } : r)
}
