import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeMonitoringEvents } from './events'
import { messageText } from './rich-message'
import { parseContactSync, parseHistory, type PhoneContact } from './history-sync'
import { applyHistoryReview, savePhoneContacts, upgradeMediaPlaceholders } from './history-store'
import type { ArchiveJob } from './media-archive'

type Json = Record<string, unknown>
export interface StoredMessage {
  // RPC argument keys differ from the resulting table column names.
  id: string
  customer: string
  name: string | null
  direction: 'inbound' | 'outbound'
  timestamp: string
  kind: string
  text: string | null
  media_id: string | null
}
export interface ChangeBatch {
  waba: string
  phone: string | null
  field: string
  hash: string
  payload: Json
  messages: StoredMessage[]
  review: boolean
  /** Shared chat history: filed under original dates, never shown as new/unread. */
  historical?: boolean
  /** Phone address-book contacts from smb_app_state_sync. */
  contacts?: PhoneContact[]
}

function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Json)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function monitoringBatches(payload: unknown): ChangeBatch[] {
  // Validate the complete envelope before doing any database work.
  normalizeMonitoringEvents(payload)
  const batches: ChangeBatch[] = []
  for (const entry of (payload as { entry: { id: string; changes: Json[] }[] }).entry) {
    for (const change of entry.changes) {
      const value = object(change.value)
      const field = typeof change.field === 'string' ? change.field : 'unknown'
      const phone = object(value.metadata).phone_number_id
      const hash = createHash('sha256').update(canonical([entry.id, change])).digest('hex')
      const phoneId = typeof phone === 'string' ? phone : null
      // Coexistence sync deliveries can be large; the ledger keeps a compact,
      // content-free summary while messages/contacts are stored normally.
      if (field === 'history') {
        const { messages, summary } = parseHistory(value)
        // A delivery with no chats, no errors and no progress metadata is not a
        // recognisable history chunk: keep it in full for review instead.
        const malformed = !messages.length && !summary.error_codes.length && summary.chunks.every(c => c.progress === null)
        batches.push({ waba: entry.id, phone: phoneId, field, hash, payload: malformed ? change : { field, value: summary }, messages, review: malformed, historical: true })
        continue
      }
      if (field === 'smb_app_state_sync') {
        const contacts = parseContactSync(value)
        batches.push({ waba: entry.id, phone: phoneId, field, hash, payload: { field, value: { source: 'meta_contacts', received: contacts.length, removed: contacts.filter(c => c.action === 'remove').length } }, messages: [], review: false, contacts })
        continue
      }
      const events = normalizeMonitoringEvents({ object: 'whatsapp_business_account', entry: [{ id: entry.id, changes: [change] }] })
      const messages: StoredMessage[] = []
      let review = false
      for (const event of events) {
        if (event.kind === 'unsupported') { review = true; continue }
        if (event.kind === 'status') continue // Preserve status payload in the event ledger.
        const timestamp = Number(event.timestamp)
        if (!event.messageId || !event.customer || !event.phoneNumberId || !event.timestamp || !/^\d+$/.test(event.timestamp) || !Number.isFinite(timestamp) || timestamp < 0 || timestamp > 253402300799) {
          review = true
          continue
        }
        const contact = Array.isArray(value.contacts) ? value.contacts.map(object).find(c => c.wa_id === event.customer) : undefined
        const name = object(contact?.profile).name
        const kind = typeof event.raw.type === 'string' ? event.raw.type : 'unknown'
        const media = object(event.raw[kind])
        messages.push({
          id: event.messageId, customer: event.customer,
          name: typeof name === 'string' ? name : null,
          direction: event.kind === 'incoming' ? 'inbound' : 'outbound',
          timestamp: new Date(timestamp * 1000).toISOString(), kind,
          text: messageText(event.raw),
          media_id: typeof media.id === 'string' ? media.id : null,
        })
        // Interactive, contact/location, edits and other non-text payloads are
        // retained in full for review until their complete rendering is supported.
        if (!['text', 'image', 'video', 'audio', 'document', 'sticker'].includes(kind)) review = true
      }
      batches.push({ waba: entry.id, phone: phoneId, field, hash, payload: change, messages, review })
    }
  }
  return batches
}

/** Existing Postgres RPC atomically stores each event, messages and thread updates.
 * A failed batch is not acknowledged. Successful batches deduplicate on retries.
 */
export type IngestDiagnostic = 'channel_lookup_failed' | 'channel_not_found' | 'ambiguous_routing' | 'channel_paused' | 'transaction_failed' | 'transaction_completed'

async function threadCounts(db: SupabaseClient, channelId: string, messages: StoredMessage[]) {
  const customers = [...new Set(messages.map(m => m.customer))]
  const counts = new Map<string, { id: string; count: number }>()
  for (let i = 0; i < customers.length; i += 200) {
    const rows = await db.from('monitoring_threads').select('id,customer,message_count').eq('channel_id', channelId).in('customer', customers.slice(i, i + 200))
    if (rows.error) throw new Error('Thread lookup failed')
    for (const row of rows.data ?? []) counts.set(row.customer, { id: row.id, count: row.message_count })
  }
  return counts
}

/** Stores every batch and returns the media to copy into permanent storage. */
export async function persistMonitoringBatches(db: SupabaseClient, batches: ChangeBatch[], diagnose: (event: IngestDiagnostic) => void = () => {}): Promise<ArchiveJob[]> {
  const archive: ArchiveJob[] = []
  for (const batch of batches) {
    let lookup = db.from('monitoring_channels').select('id,account_id,active').eq('waba_id', batch.waba)
    if (batch.phone) lookup = lookup.eq('phone_number_id', batch.phone)
    // Without a phone ID, keep the opaque event for each configured channel
    // under this WABA; never guess which conversation it belongs to.
    const channels = await lookup
    if (channels.error) { diagnose('channel_lookup_failed'); throw new Error('Channel routing unavailable') }
    if (!channels.data?.length) { diagnose('channel_not_found'); throw new Error('Channel routing unavailable') }
    if ((batch.phone && channels.data.length !== 1) || new Set(channels.data.map(c => c.account_id)).size > 1) {
      diagnose('ambiguous_routing')
      throw new Error('Ambiguous company routing')
    }
    for (const channel of channels.data) {
      if (!channel.active) { diagnose('channel_paused'); continue } // Deliberately paused numbers stay paused.
      const messages = batch.phone ? batch.messages : []
      const before = batch.historical && messages.length ? await threadCounts(db, channel.id, messages) : null
      const result = await db.rpc('ingest_monitoring_event', {
        p_channel: channel.id, p_hash: batch.hash, p_field: batch.field,
        p_payload: batch.payload, p_messages: batch.phone ? batch.messages : [],
        p_review: batch.review || !batch.phone,
      })
      if (result.error) { diagnose('transaction_failed'); throw new Error('Monitoring transaction failed') }
      diagnose('transaction_completed')
      // Follow-up steps are idempotent, so a Meta retry after a failure here
      // safely repeats them (the event itself is deduplicated by its hash).
      if (messages.some(m => m.media_id)) await upgradeMediaPlaceholders(db, channel.id, messages)
      if (before) await applyHistoryReview(db, channel.account_id, before, await threadCounts(db, channel.id, messages))
      if (batch.contacts?.length) await savePhoneContacts(db, channel.account_id, batch.contacts)
      const media = messages.filter(m => m.media_id).map(m => m.id)
      if (media.length) archive.push({ channelId: channel.id, accountId: channel.account_id, metaIds: media })
    }
  }
  return archive
}
