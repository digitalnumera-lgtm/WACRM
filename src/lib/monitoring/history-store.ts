import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoredMessage } from './ingest'
import type { PhoneContact } from './history-sync'
import { missingWorkflowSchema } from './inbox'

type Counts = Map<string, { id: string; count: number }>

/**
 * Shared chat history must not look like new activity: it would flag every
 * chat unread and reopen resolved/snoozed conversations. Advance each touched
 * thread's review marker (and resolve/snooze point) by the number of messages
 * this delivery actually added. Genuinely new unread messages stay unread.
 *
 * Conversations that exist only because of shared history and have been quiet
 * for two days are filed as Done, so months-old chats where the customer spoke
 * last don't flood Waiting. A new message reopens them; recent ones stay open.
 */
export const HISTORY_QUIET_MS = 48 * 3600000
export async function applyHistoryReview(db: SupabaseClient, accountId: string, before: Counts, after: Counts, now = Date.now()) {
  const deltas = [...after.entries()].map(([customer, row]) => ({ id: row.id, count: row.count, created: !before.has(customer), delta: row.count - (before.get(customer)?.count ?? 0) })).filter(r => r.delta > 0)
  if (!deltas.length) return
  const meta = await db.from('monitoring_thread_meta').select('thread_id,status,status_at_count,seen_count').eq('account_id', accountId).in('thread_id', deltas.map(d => d.id))
  if (meta.error && missingWorkflowSchema(meta.error)) return // Inbox workflow schema not installed yet.
  if (meta.error) throw new Error('History review update failed')
  const existing = new Map((meta.data ?? []).map(row => [row.thread_id, row]))
  const fresh = deltas.filter(d => d.created && !existing.has(d.id)).map(d => d.id)
  const quiet = new Set<string>()
  if (fresh.length) {
    const threads = await db.from('monitoring_threads').select('id,last_message_at').eq('account_id', accountId).in('id', fresh)
    if (threads.error) throw new Error('History review update failed')
    for (const t of (threads.data ?? []) as { id: string; last_message_at: string }[]) if (now - Date.parse(t.last_message_at) > HISTORY_QUIET_MS) quiet.add(t.id)
  }
  const filed: Record<string, unknown>[] = [], moved: Record<string, unknown>[] = [], seen: Record<string, unknown>[] = []
  for (const { id, delta, count } of deltas) {
    const row = existing.get(id)
    if (!row) (quiet.has(id) ? filed : seen).push({ thread_id: id, account_id: accountId, seen_count: delta, ...(quiet.has(id) ? { status: 'resolved', status_at_count: count } : {}) })
    else if (row.status !== 'open') moved.push({ thread_id: id, account_id: accountId, seen_count: row.seen_count + delta, status_at_count: row.status_at_count + delta })
    else seen.push({ thread_id: id, account_id: accountId, seen_count: row.seen_count + delta })
  }
  // Each group has the same columns, so an upsert never resets a column it did not mean to change.
  for (const group of [filed, moved, seen]) {
    if (!group.length) continue
    const result = await db.from('monitoring_thread_meta').upsert(group, { onConflict: 'thread_id' })
    if (result.error) throw new Error('History review update failed')
  }
}

/** A later delivery can carry the real media ID for a message first stored
 * as a placeholder (Meta sends history media assets separately). */
export async function upgradeMediaPlaceholders(db: SupabaseClient, channelId: string, messages: StoredMessage[]) {
  for (const message of messages) {
    if (!message.media_id) continue
    const result = await db.from('monitoring_messages').update({ media_id: message.media_id, kind: message.kind })
      .eq('channel_id', channelId).eq('meta_id', message.id).is('media_id', null)
    if (result.error) throw new Error('Media update failed')
  }
}

/** Adds phone address-book contacts to the CRM directory (never deletes) and
 * names conversations that have no customer name yet. */
export async function savePhoneContacts(db: SupabaseClient, accountId: string, contacts: PhoneContact[]) {
  const added = new Map<string, string | null>()
  for (const c of contacts) if (c.action === 'add') added.set(c.phone, c.name)
  if (!added.size) return
  const owner = await db.from('profiles').select('user_id').eq('account_id', accountId).eq('account_role', 'owner').limit(1)
  if (owner.error || !owner.data?.[0]) throw new Error('Account owner unavailable')
  const phones = [...added.keys()]
  for (let i = 0; i < phones.length; i += 200) {
    const slice = phones.slice(i, i + 200)
    const known = await db.from('contacts').select('phone_normalized').eq('account_id', accountId).in('phone_normalized', slice)
    if (known.error) throw new Error('Contact lookup failed')
    const have = new Set((known.data ?? []).map(r => r.phone_normalized))
    const rows = slice.filter(phone => !have.has(phone)).map(phone => ({ account_id: accountId, user_id: owner.data[0].user_id, phone, name: added.get(phone) || phone }))
    if (rows.length) {
      const result = await db.from('contacts').insert(rows)
      if (result.error?.code === '23505') {
        // A concurrent delivery added some of these; insert the rest one by one.
        for (const row of rows) {
          const single = await db.from('contacts').insert(row)
          if (single.error && single.error.code !== '23505') throw new Error('Contact import failed')
        }
      } else if (result.error) throw new Error('Contact import failed')
    }
    const unnamed = await db.from('monitoring_threads').select('id,customer').eq('account_id', accountId).in('customer', slice).is('customer_name', null)
    if (unnamed.error) throw new Error('Thread lookup failed')
    for (const thread of unnamed.data ?? []) {
      const name = added.get(thread.customer)
      if (!name) continue
      const result = await db.from('monitoring_threads').update({ customer_name: name }).eq('account_id', accountId).eq('id', thread.id).is('customer_name', null)
      if (result.error) throw new Error('Thread naming failed')
    }
  }
}
