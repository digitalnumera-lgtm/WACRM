import { describe, expect, it } from 'vitest'
import { normalizeMonitoringEvents } from './events'

function envelope(field: string, value: Record<string, unknown>, number = 'number-1') {
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes: [{ field, value: { metadata: { phone_number_id: number }, ...value } }] }] }
}
describe('monitoring event normalization', () => {
  it('separates the same customer across business numbers', () => {
    const message = { id: 'message-1', from: '923001234567', text: { body: 'Hello' }, timestamp: '1700000000' }
    const first = normalizeMonitoringEvents(envelope('messages', { messages: [message] }))[0]
    const second = normalizeMonitoringEvents(envelope('messages', { messages: [message] }, 'number-2'))[0]
    expect(first.kind).toBe('incoming')
    expect(first.text).toBe('Hello')
    expect(first.threadKey).not.toBe(second.threadKey)
    expect(first.key).not.toBe(second.key)
  })
  it('maps phone-app echoes to the recipient customer in the same thread', () => {
    const inbound = normalizeMonitoringEvents(envelope('messages', { messages: [{ id: 'in', from: 'customer' }] }))[0]
    const echo = normalizeMonitoringEvents(envelope('smb_message_echoes', { message_echoes: [{ id: 'out', from: 'business', to: 'customer', text: { body: 'Reply' } }] }))[0]
    expect(echo.kind).toBe('phone_app_reply')
    expect(echo.threadKey).toBe(inbound.threadKey)
    expect(echo.text).toBe('Reply')
  })
  it('deduplicates deliveries independently of object property ordering', () => {
    const a = normalizeMonitoringEvents(envelope('messages', { messages: [{ id: 'same', from: 'customer', timestamp: '1' }] }))[0]
    const b = normalizeMonitoringEvents(envelope('messages', { messages: [{ timestamp: '1', from: 'customer', id: 'same' }] }))[0]
    expect(a.key).toBe(b.key)
  })
  it('retains distinct message status transitions', () => {
    const events = normalizeMonitoringEvents(envelope('messages', { statuses: [{ id: 'm', status: 'delivered', timestamp: '1' }, { id: 'm', status: 'read', timestamp: '2' }] }))
    expect(events).toHaveLength(2)
    expect(events[0].key).not.toBe(events[1].key)
  })
  it('retains history and unsupported changes without claiming imported chats', () => {
    const input = envelope('history', { history: [{ arbitrary: 'data' }] })
    const event = normalizeMonitoringEvents(input)[0]
    expect(event.kind).toBe('unsupported')
    expect(event.raw).toEqual(input.entry[0].changes[0])
    expect(event.threadKey).toBeNull()
  })
  it('rejects malformed envelopes', () => {
    for (const payload of [null, {}, { object: 'whatsapp_business_account', entry: [{}] }]) {
      expect(() => normalizeMonitoringEvents(payload)).toThrow()
    }
  })
})
