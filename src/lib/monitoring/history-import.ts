import { createHash } from 'node:crypto'
import type { StoredMessage } from './ingest'

// Deliberately explicit export contract: ambiguous dates/directions are rejected.
export function historyMessages(input: unknown): StoredMessage[] {
  if (!Array.isArray(input) || !input.length || input.length > 200) throw new Error('Choose 1–200 messages per import.')
  return input.map((row, index) => {
    const r = row as Record<string, unknown>
    if (!r || typeof r !== 'object') throw new Error(`Invalid row ${index + 1}`)
    const customer = String(r.customer ?? '').replace(/[+\s()-]/g, '')
    if (!/^\d{6,20}$/.test(customer)) throw new Error(`Row ${index + 1}: customer must be an international phone number.`)
    if (!['inbound', 'outbound'].includes(String(r.direction))) throw new Error(`Row ${index + 1}: direction must be inbound or outbound.`)
    if (typeof r.timestamp !== 'string' || !/T.*(Z|[+-]\d\d:\d\d)$/.test(r.timestamp) || !Number.isFinite(Date.parse(r.timestamp))) throw new Error(`Row ${index + 1}: use an ISO timestamp with timezone.`)
    const kind = String(r.kind ?? 'text')
    if (!/^[a-z_]{1,40}$/.test(kind)) throw new Error(`Row ${index + 1}: invalid message kind.`)
    const text = r.text == null ? null : String(r.text)
    if (text && text.length > 20000) throw new Error(`Row ${index + 1}: message is too long.`)
    const name = r.name == null ? null : String(r.name).slice(0, 200)
    const timestamp = new Date(r.timestamp).toISOString()
    const media = r.media_id == null || r.media_id === '' ? null : String(r.media_id)
    if (media && !/^\d+$/.test(media)) throw new Error(`Row ${index + 1}: media_id must be a Meta media ID.`)
    const id = typeof r.id === 'string' && r.id ? r.id : `import:${createHash('sha256').update(JSON.stringify([customer, r.direction, timestamp, kind, text, media])).digest('hex')}`
    return { id, customer, name, timestamp, kind, text, media_id: media, direction: r.direction as 'inbound' | 'outbound' }
  })
}
