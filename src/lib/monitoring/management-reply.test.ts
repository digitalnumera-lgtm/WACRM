import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('./management-transport', () => ({ submitManagementText: mocks.send }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'private-token' }))
import { sendManagementReply } from './management-reply'
import { replyWindow } from './reply-window'
afterEach(() => vi.clearAllMocks())

const target = { thread: { id: 'thread', channel_id: 'channel', customer: '15550100001', customer_name: 'Preview' }, channel: { id: 'channel', active: true, phone_number_id: '12345' } }
function database(options: { expired?: boolean; rpcError?: boolean; reserveError?: boolean } = {}) {
  const ledger = new Map<string, Record<string, unknown>>()
  const calls: { table: string; filters: [string, unknown][] }[] = []
  const db = {
    rpc: vi.fn(async () => ({ error: options.rpcError ? { message: 'unavailable' } : null })),
    from(table: string) {
      const filters: [string, unknown][] = []; calls.push({ table, filters })
      let operation = 'read', values: Record<string, unknown> = {}
      const query: Record<string, unknown> = {}
      query.eq = (key: string, value: unknown) => { filters.push([key, value]); return query }
      for (const method of ['select', 'in', 'order', 'limit', 'maybeSingle', 'single']) query[method] = () => query
      query.insert = (data: Record<string, unknown>) => { operation = 'insert'; values = data; return query }
      query.update = (data: Record<string, unknown>) => { operation = 'update'; values = data; return query }
      query.then = (resolve: (value: unknown) => unknown) => {
        let result: unknown = { data: null, error: null }
        if (table === 'monitoring_messages') result = { data: { sent_at: new Date(Date.now() - (options.expired ? 48 : 1) * 3600000).toISOString() } }
        if (table === 'monitoring_credentials') result = { data: { encrypted_token: 'ciphertext' } }
        if (table === 'monitoring_events') {
          if (operation === 'insert') {
            if (options.reserveError) result = { error: { code: 'unavailable' } }
            else if (ledger.has(String(values.id))) result = { error: { code: '23505' } }
            else ledger.set(String(values.id), structuredClone(values))
          } else {
            const entry = [...ledger.values()].find(row => filters.every(([k, v]) => row[k] === v))
            if (entry && operation === 'update') Object.assign(entry, structuredClone(values))
            result = { data: entry ? structuredClone(entry) : null, error: null }
          }
        }
        return Promise.resolve(result).then(resolve)
      }
      return query
    },
  }
  return { db: db as unknown as SupabaseClient, ledger, calls, rpc: db.rpc }
}
describe('durable management reply reservation', () => {
  it('sends once across concurrent requests and accepted retries', async () => {
    mocks.send.mockResolvedValue({ state: 'accepted', meta_id: 'wamid.test' })
    const { db, ledger, rpc } = database()
    await Promise.all([sendManagementReply(db, 'company', 'admin', target, 'request', 'Hello'), sendManagementReply(db, 'company', 'admin', target, 'request', 'Hello')])
    const retry = await sendManagementReply(db, 'company', 'admin', target, 'request', 'Hello')
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(retry).toMatchObject({ status: 200, body: { state: 'accepted', saved: true } })
    expect(ledger.get('request')).toMatchObject({ needs_review: false, payload: { actor_id: 'admin', meta_id: 'wamid.test' } })
  })
  it('keeps uncertain attempts reserved instead of sending again', async () => {
    mocks.send.mockResolvedValue({ state: 'uncertain' })
    const { db, ledger } = database()
    const first = await sendManagementReply(db, 'company', 'admin', target, 'request', 'Hello')
    expect(first.status).toBe(202)
    await sendManagementReply(db, 'company', 'admin', target, 'request', 'Hello')
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(ledger.get('request')).toMatchObject({ needs_review: true })
  })
  it('does not resend when Meta accepted but inbox persistence failed', async () => {
    mocks.send.mockResolvedValue({ state: 'accepted', meta_id: 'wamid.test' })
    const { db } = database({ rpcError: true })
    await sendManagementReply(db, 'company', 'admin', target, 'request', 'Hello')
    const retry = await sendManagementReply(db, 'company', 'admin', target, 'request', 'Hello')
    expect(retry.body).toMatchObject({ state: 'accepted', saved: false })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('blocks reused IDs with different text or company ownership', async () => {
    mocks.send.mockResolvedValue({ state: 'accepted', meta_id: 'wamid.test' })
    const { db } = database()
    await sendManagementReply(db, 'company', 'admin', target, 'request', 'Hello')
    expect((await sendManagementReply(db, 'company', 'admin', target, 'request', 'Different')).status).toBe(409)
    expect((await sendManagementReply(db, 'other-company', 'admin', target, 'request', 'Hello')).status).toBe(409)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('never sends without a durable reservation, active channel and open window', async () => {
    await expect(sendManagementReply(database({ reserveError: true }).db, 'company', 'admin', target, 'request', 'Hello')).rejects.toThrow()
    expect((await sendManagementReply(database({ expired: true }).db, 'company', 'admin', target, 'request', 'Hello')).status).toBe(409)
    expect((await sendManagementReply(database().db, 'company', 'admin', { ...target, channel: { ...target.channel, active: false } }, 'request', 'Hello')).status).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('does not treat missing, future or exactly 24-hour-old messages as an open window', () => {
    const now = Date.parse('2026-10-19T12:00:00Z')
    for (const date of [null, 'invalid', '2026-10-19T12:00:01Z', '2026-10-18T12:00:00Z']) expect(replyWindow(date, now).open).toBe(false)
    expect(replyWindow('2026-10-18T12:00:01Z', now).open).toBe(true)
  })
})
