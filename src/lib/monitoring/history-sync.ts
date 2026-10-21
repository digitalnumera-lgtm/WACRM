// Meta WhatsApp Business app "coexistence" sync webhooks:
//  - history: past individual chats shared from the phone (up to 180 days),
//    delivered once in chunks across three phases after onboarding.
//  - smb_app_state_sync: the phone's address-book contacts.
// Only parsing lives here; persistence reuses the atomic ingest RPC.
import { messageText } from './rich-message'
import type { StoredMessage } from './ingest'

type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const digits = (value: unknown) => typeof value === 'string' && /^\d{6,20}$/.test(value.replace(/^\+/, '')) ? value.replace(/^\+/, '') : null

/** WhatsApp error code sent when the business declines history sharing on the phone. */
export const HISTORY_DECLINED = 2593109

export interface HistorySummary {
  source: 'meta_history'
  chunks: { phase: number | null; chunk_order: number | null; progress: number | null; threads: number; messages: number }[]
  messages: number
  skipped: number
  declined: boolean
  error_codes: number[]
}

/** Converts one `history` change value into stored messages plus a compact,
 * content-free summary for the event ledger (progress tracking). */
export function parseHistory(value: Json): { messages: StoredMessage[]; summary: HistorySummary } {
  const messages: StoredMessage[] = []
  const summary: HistorySummary = { source: 'meta_history', chunks: [], messages: 0, skipped: 0, declined: false, error_codes: [] }
  for (const item of list(value.history)) {
    const history = object(item)
    for (const raw of list(history.errors)) {
      const code = Number(object(raw).code)
      if (Number.isFinite(code)) summary.error_codes.push(code)
      if (code === HISTORY_DECLINED) summary.declined = true
    }
    const meta = object(history.metadata)
    const number = (v: unknown) => Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null
    const chunk = { phase: number(meta.phase), chunk_order: number(meta.chunk_order), progress: number(meta.progress), threads: 0, messages: 0 }
    for (const rawThread of list(history.threads)) {
      const thread = object(rawThread)
      const customer = digits(thread.id)
      if (!customer) { summary.skipped += list(thread.messages).length; continue }
      chunk.threads++
      for (const rawMessage of list(thread.messages)) {
        const message = object(rawMessage)
        const stored = historyMessage(message, customer)
        if (stored) { messages.push(stored); chunk.messages++ } else summary.skipped++
      }
    }
    summary.chunks.push(chunk)
  }
  summary.messages = messages.length
  return { messages, summary }
}

export function historyMessage(message: Json, customer: string): StoredMessage | null {
  const id = typeof message.id === 'string' && message.id ? message.id : null
  const seconds = Number(message.timestamp)
  if (!id || typeof message.timestamp !== 'string' || !/^\d+$/.test(message.timestamp) || seconds < 0 || seconds > 253402300799) return null
  const from = digits(message.from)
  // Messages from the customer are inbound; the business app's own messages
  // (echoes, which also carry `to`) are outbound.
  const direction = from === customer ? 'inbound' : 'outbound'
  const kind = typeof message.type === 'string' && message.type ? message.type : 'unknown'
  const media = object(message[kind])
  return {
    id, customer, name: null, direction, timestamp: new Date(seconds * 1000).toISOString(), kind,
    text: messageText(message),
    media_id: typeof media.id === 'string' && /^\d+$/.test(media.id) ? media.id : null,
  }
}

export interface PhoneContact { phone: string; name: string | null; action: 'add' | 'remove' }

/** Parses `smb_app_state_sync` contact entries from the phone's address book. */
export function parseContactSync(value: Json): PhoneContact[] {
  const contacts: PhoneContact[] = []
  for (const raw of list(value.state_sync)) {
    const item = object(raw)
    if (item.type !== 'contact') continue
    const contact = object(item.contact)
    const phone = digits(String(contact.phone_number ?? '').replace(/[\s()-]/g, ''))
    if (!phone) continue
    const name = [contact.full_name, contact.first_name].find(v => typeof v === 'string' && v.trim()) as string | undefined
    contacts.push({ phone, name: name ? name.trim().slice(0, 200) : null, action: item.action === 'remove' ? 'remove' : 'add' })
  }
  return contacts
}
