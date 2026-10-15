import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { monitoringBatches, persistMonitoringBatches } from './ingest'

function envelope(field: string, values: Record<string, unknown>, phone: string | null = '123') {
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field, value: { ...(phone ? { metadata: { phone_number_id: phone } } : {}), ...values } }] }] }
}
const inbound = { id: 'message-1', from: 'customer', timestamp: '1700000000', type: 'text', text: { body: 'Hello' } }
function database(channels: { id: string; account_id: string; active: boolean }[], fail = false) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: channels, error: null }).then(resolve) }
  const db = { from: vi.fn(() => query), rpc: vi.fn(async () => ({ error: fail ? { message: 'failed' } : null })) }
  return { db, query, client: db as unknown as SupabaseClient }
}
describe('transactional monitoring batches', () => {
  it('maps incoming and echo messages to existing storage fields', () => {
    const incoming = monitoringBatches(envelope('messages', { messages: [inbound], contacts: [{ wa_id: 'customer', profile: { name: 'Customer name' } }] }))[0]
    expect(incoming.messages[0]).toEqual({ id: 'message-1', customer: 'customer', name: 'Customer name', direction: 'inbound', timestamp: '2023-11-14T22:13:20.000Z', kind: 'text', text: 'Hello', media_id: null })
    const echo = monitoringBatches(envelope('smb_message_echoes', { message_echoes: [{ ...inbound, from: 'business', to: 'customer' }] }))[0]
    expect(echo.messages[0]).toMatchObject({ direction: 'outbound', customer: 'customer' })
  })
  it('retains unsupported and malformed events without inventing messages', () => {
    for (const payload of [envelope('history', { history: [{ data: 'retained' }] }), envelope('messages', { messages: [{ ...inbound, timestamp: 'invalid' }] })]) {
      const batch = monitoringBatches(payload)[0]
      expect(batch.review).toBe(true)
      expect(batch.messages).toEqual([])
      expect(batch.payload).toEqual(payload.entry[0].changes[0])
    }
  })
  it('uses stable event hashes for retries and stores the full source change', () => {
    const first = monitoringBatches(envelope('messages', { messages: [inbound] }))[0]
    const reordered = monitoringBatches(envelope('messages', { messages: [{ text: { body: 'Hello' }, type: 'text', timestamp: '1700000000', from: 'customer', id: 'message-1' }] }))[0]
    expect(first.hash).toBe(reordered.hash)
    expect(first.payload).toHaveProperty('value.messages')
  })
  it('uses one atomic RPC per channel/event rather than separate table writes', async () => {
    const { db, client, query } = database([{ id: 'channel', account_id: 'company', active: true }])
    const batches = monitoringBatches(envelope('messages', { messages: [inbound] }))
    await persistMonitoringBatches(client, batches)
    expect(query.eq).toHaveBeenCalledWith('waba_id', 'waba')
    expect(query.eq).toHaveBeenCalledWith('phone_number_id', '123')
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('ingest_monitoring_event', expect.objectContaining({ p_channel: 'channel', p_messages: batches[0].messages, p_hash: batches[0].hash }))
  })
  it('never re-enables paused numbers', async () => {
    const { db, client } = database([{ id: 'channel', account_id: 'company', active: false }])
    await persistMonitoringBatches(client, monitoringBatches(envelope('messages', { messages: [inbound] })))
    expect(db.rpc).not.toHaveBeenCalled()
  })
  it('requires retry on unknown routing or failed transactions', async () => {
    const batches = monitoringBatches(envelope('messages', { messages: [inbound] }))
    await expect(persistMonitoringBatches(database([]).client, batches)).rejects.toThrow()
    await expect(persistMonitoringBatches(database([{ id: 'channel', account_id: 'company', active: true }], true).client, batches)).rejects.toThrow()
  })
  it('does not spread unscoped WABA events across companies', async () => {
    const { db, client } = database([{ id: 'a', account_id: 'company-a', active: true }, { id: 'b', account_id: 'company-b', active: true }])
    await expect(persistMonitoringBatches(client, monitoringBatches(envelope('history', { history: [] }, null)))).rejects.toThrow('Ambiguous')
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
