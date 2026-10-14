import { createHash } from 'node:crypto'

type JsonObject = Record<string, unknown>
export interface MonitoringEvent {
  key: string
  wabaId: string
  phoneNumberId: string | null
  kind: 'incoming' | 'phone_app_reply' | 'status' | 'unsupported'
  messageId: string | null
  customer: string | null
  threadKey: string | null
  text: string | null
  timestamp: string | null
  raw: JsonObject
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}
function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Normalize only; persistence must resolve company/channel ownership first.
 * Unsupported/history changes are retained rather than treated as messages.
 */
export function normalizeMonitoringEvents(payload: unknown): MonitoringEvent[] {
  const envelope = object(payload)
  if (envelope.object !== 'whatsapp_business_account' || !Array.isArray(envelope.entry)) {
    throw new Error('Invalid WhatsApp webhook envelope')
  }
  const result: MonitoringEvent[] = []
  for (const item of envelope.entry) {
    const entry = object(item)
    const wabaId = string(entry.id)
    if (!wabaId || !Array.isArray(entry.changes)) throw new Error('Invalid webhook entry')
    for (const item of entry.changes) {
      const change = object(item)
      const value = object(change.value)
      const phoneNumberId = string(object(value.metadata).phone_number_id)
      const append = (kind: MonitoringEvent['kind'], raw: JsonObject) => {
        const messageId = string(raw.id)
        const customer = kind === 'incoming' ? string(raw.from) : kind === 'phone_app_reply' ? string(raw.to) : null
        // Message delivery retries keep the same key. Status transitions have
        // distinct keys so delivered/read/failed observations are not lost.
        const identity = messageId && kind !== 'unsupported'
          ? [wabaId, phoneNumberId, kind, messageId, kind === 'status' ? [raw.status, raw.timestamp] : null]
          : [wabaId, change]
        result.push({
          key: createHash('sha256').update(stableJson(identity)).digest('hex'),
          wabaId, phoneNumberId, kind, messageId, customer,
          threadKey: phoneNumberId && customer ? JSON.stringify([phoneNumberId, customer]) : null,
          text: string(object(raw.text).body),
          timestamp: string(raw.timestamp), raw,
        })
      }
      let handled = false
      if (change.field === 'messages') {
        if (Array.isArray(value.messages)) {
          for (const message of value.messages) append('incoming', object(message))
          handled = value.messages.length > 0
        }
        if (Array.isArray(value.statuses)) {
          for (const status of value.statuses) append('status', object(status))
          handled ||= value.statuses.length > 0
        }
      } else if (change.field === 'smb_message_echoes' && Array.isArray(value.message_echoes)) {
        for (const message of value.message_echoes) append('phone_app_reply', object(message))
        handled = value.message_echoes.length > 0
      }
      if (!handled) append('unsupported', change)
    }
  }
  return result
}
