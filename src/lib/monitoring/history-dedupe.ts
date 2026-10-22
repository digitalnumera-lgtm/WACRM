import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoredMessage } from './ingest'

// Messages copied in earlier from another tool (e.g. a WabaCRM export) have
// their own IDs, so Meta's shared history would store them a second time.
// A history message is the same message when it is in the same chat, the
// same direction, within this window, and has the same text (or both have none).
const WINDOW_MS = 90_000
type Existing = { thread_id: string; direction: string; sent_at: string; content: string | null }

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** History messages that are not already stored under an imported copy. */
export function withoutImportedCopies(messages: StoredMessage[], threads: Map<string, { id: string }>, existing: Existing[]): StoredMessage[] {
  const pool = new Map<string, { at: number; text: string; used: boolean }[]>()
  for (const row of existing) {
    const key = `${row.thread_id}|${row.direction}`
    ;(pool.get(key) ?? pool.set(key, []).get(key)!).push({ at: Date.parse(row.sent_at), text: norm(row.content), used: false })
  }
  return messages.filter(message => {
    const thread = threads.get(message.customer)
    const candidates = thread && pool.get(`${thread.id}|${message.direction}`)
    if (!candidates) return true
    const at = Date.parse(message.timestamp), text = norm(message.text)
    let best: (typeof candidates)[number] | null = null
    for (const c of candidates) {
      if (c.used || c.text !== text || Math.abs(c.at - at) > WINDOW_MS) continue
      if (!best || Math.abs(c.at - at) < Math.abs(best.at - at)) best = c
    }
    if (!best) return true
    best.used = true
    return false
  })
}

/** Loads imported (non-Meta) messages near these history messages and drops the copies. */
export async function dropImportedCopies(db: SupabaseClient, threads: Map<string, { id: string }>, messages: StoredMessage[]): Promise<StoredMessage[]> {
  const ids = [...new Set(messages.map(m => threads.get(m.customer)?.id).filter((id): id is string => !!id))]
  if (!ids.length) return messages
  const times = messages.map(m => Date.parse(m.timestamp)).filter(Number.isFinite)
  const from = new Date(Math.min(...times) - WINDOW_MS).toISOString(), until = new Date(Math.max(...times) + WINDOW_MS).toISOString()
  const existing: Existing[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await db.from('monitoring_messages').select('thread_id,direction,sent_at,content')
      .in('thread_id', ids.slice(i, i + 100)).gte('sent_at', from).lte('sent_at', until).not('meta_id', 'like', 'wamid.%').limit(10000)
    if (rows.error) throw new Error('History duplicate check failed')
    existing.push(...((rows.data ?? []) as Existing[]))
  }
  return existing.length ? withoutImportedCopies(messages, threads, existing) : messages
}
