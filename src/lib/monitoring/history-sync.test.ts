import { describe, expect, it, vi } from 'vitest'
import { HISTORY_DECLINED, parseContactSync, parseHistory } from './history-sync'
import { monitoringBatches, persistMonitoringBatches } from './ingest'
import { applyHistoryReview, savePhoneContacts } from './history-store'
import { canRequestSync, historyProgress, SYNC_WINDOW_MS, type ConnectionRecord } from './connect'

const customer = '923001234567'
const business = '923374066150'
const history = (messages: unknown[], meta = { phase: 0, chunk_order: 1, progress: 40 }) => ({
  messaging_product: 'whatsapp', metadata: { display_phone_number: business, phone_number_id: '1286834291186944' },
  history: [{ metadata: meta, threads: [{ id: customer, messages }] }],
})
const msg = (id: string, from: string, extra: Record<string, unknown> = { type: 'text', text: { body: 'Salam' } }) => ({ id, from, timestamp: '1760000000', history_context: { status: 'READ' }, ...extra })

describe('Meta history sync parsing', () => {
  it('files customer messages as inbound and business-app messages as outbound with original dates', () => {
    const { messages, summary } = parseHistory(history([msg('a', customer), msg('b', business, { to: customer, type: 'text', text: { body: 'Walaikum salam' } })]))
    expect(messages).toEqual([
      { id: 'a', customer, name: null, direction: 'inbound', timestamp: new Date(1760000000 * 1000).toISOString(), kind: 'text', text: 'Salam', media_id: null },
      { id: 'b', customer, name: null, direction: 'outbound', timestamp: new Date(1760000000 * 1000).toISOString(), kind: 'text', text: 'Walaikum salam', media_id: null },
    ])
    expect(summary).toMatchObject({ messages: 2, skipped: 0, declined: false, chunks: [{ phase: 0, chunk_order: 1, progress: 40, threads: 1, messages: 2 }] })
  })
  it('keeps media IDs and placeholders, and skips malformed messages and threads', () => {
    const value = history([msg('img', customer, { type: 'image', image: { id: '998877', caption: 'Logo' } }), msg('ph', customer, { type: 'media_placeholder' }), { id: 'bad', from: customer, timestamp: 'soon', type: 'text' }])
    ;(value.history[0].threads as unknown[]).push({ id: 'not-a-number', messages: [msg('x', customer)] })
    const { messages, summary } = parseHistory(value)
    expect(messages.map(m => [m.id, m.kind, m.media_id, m.text])).toEqual([['img', 'image', '998877', 'Logo'], ['ph', 'media_placeholder', null, null]])
    expect(summary.skipped).toBe(2)
  })
  it('detects that the business declined history sharing on the phone', () => {
    const { messages, summary } = parseHistory({ history: [{ errors: [{ code: HISTORY_DECLINED, title: 'History sync is turned off' }] }] })
    expect(messages).toEqual([]); expect(summary.declined).toBe(true); expect(summary.error_codes).toEqual([HISTORY_DECLINED])
  })
  it('parses phone contacts, ignoring invalid numbers', () => {
    expect(parseContactSync({ state_sync: [
      { type: 'contact', contact: { full_name: 'Hamza Khan', first_name: 'Hamza', phone_number: '+92 300 1234567' }, action: 'add' },
      { type: 'contact', contact: { phone_number: '923009999999' }, action: 'remove' },
      { type: 'contact', contact: { full_name: 'Bad', phone_number: 'abc' }, action: 'add' },
      { type: 'other' },
    ] })).toEqual([{ phone: '923001234567', name: 'Hamza Khan', action: 'add' }, { phone: '923009999999', name: null, action: 'remove' }])
  })
})

describe('history ingest batches', () => {
  const envelope = (field: string, value: unknown) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field, value }] }] })
  it('stores history messages with a compact, content-free ledger summary', () => {
    const [batch] = monitoringBatches(envelope('history', history([msg('a', customer)])))
    expect(batch).toMatchObject({ field: 'history', phone: '1286834291186944', review: false, historical: true })
    expect(batch.messages).toHaveLength(1)
    expect(JSON.stringify(batch.payload)).not.toContain('Salam')
    expect(batch.payload).toMatchObject({ field: 'history', value: { source: 'meta_history', messages: 1 } })
  })
  it('carries contacts without storing their names in the ledger', () => {
    const [batch] = monitoringBatches(envelope('smb_app_state_sync', { metadata: { phone_number_id: '1' }, state_sync: [{ type: 'contact', contact: { full_name: 'Hamza', phone_number: customer }, action: 'add' }] }))
    expect(batch.contacts).toEqual([{ phone: customer, name: 'Hamza', action: 'add' }])
    expect(JSON.stringify(batch.payload)).not.toContain('Hamza')
  })
  it('does not reopen or mark unread conversations because of shared history', async () => {
    let count = 10
    const upserts: unknown[] = []
    const db = {
      from: (table: string) => {
        const q: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit']) q[m] = () => q
        q.update = () => q
        q.upsert = (rows: unknown) => { upserts.push({ table, rows }); return Promise.resolve({ error: null }) }
        q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(
          table === 'monitoring_channels' ? { data: [{ id: 'ch', account_id: 'acc', active: true }], error: null }
            : table === 'monitoring_threads' ? { data: [{ id: 't1', customer, message_count: count }], error: null }
              : table === 'monitoring_thread_meta' ? { data: [{ thread_id: 't1', status: 'resolved', status_at_count: 10, seen_count: 10 }], error: null }
                : { data: [], error: null }).then(resolve)
        return q
      },
      rpc: vi.fn(async () => { count = 12; return { error: null } }),
    }
    await persistMonitoringBatches(db as never, monitoringBatches(envelope('history', history([msg('a', customer), msg('b', customer)]))))
    expect(upserts).toEqual([{ table: 'monitoring_thread_meta', rows: [{ thread_id: 't1', account_id: 'acc', seen_count: 12, status_at_count: 12 }] }])
  })
})

describe('history review and contacts storage', () => {
  it('only advances markers by messages actually added', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    const db = { from: () => { const q: Record<string, unknown> = { select: () => q, eq: () => q, in: () => q, upsert, then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) }; return q } }
    await applyHistoryReview(db as never, 'acc', new Map([[customer, { id: 't1', count: 5 }]]), new Map([[customer, { id: 't1', count: 5 }], ['923000000000', { id: 't2', count: 3 }]]))
    expect(upsert).toHaveBeenCalledExactlyOnceWith([{ thread_id: 't2', account_id: 'acc', seen_count: 3 }], { onConflict: 'thread_id' })
  })
  it('files quiet history-only chats as Done but keeps recent ones open', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    const now = Date.parse('2026-10-22T09:00:00Z')
    const db = { from: (table: string) => { const q: Record<string, unknown> = { select: () => q, eq: () => q, in: () => q, upsert, then: (r: (v: unknown) => unknown) => Promise.resolve(
      table === 'monitoring_threads' ? { data: [{ id: 'old', last_message_at: '2026-07-01T10:00:00Z' }, { id: 'recent', last_message_at: '2026-10-21T20:00:00Z' }], error: null } : { data: [], error: null }).then(r) }; return q } }
    await applyHistoryReview(db as never, 'acc', new Map(), new Map([['923000000001', { id: 'old', count: 7 }], ['923000000002', { id: 'recent', count: 4 }]]), now)
    expect(upsert).toHaveBeenCalledWith([{ thread_id: 'old', account_id: 'acc', seen_count: 7, status: 'resolved', status_at_count: 7 }], { onConflict: 'thread_id' })
    expect(upsert).toHaveBeenCalledWith([{ thread_id: 'recent', account_id: 'acc', seen_count: 4 }], { onConflict: 'thread_id' })
  })
  it('ignores a missing workflow schema', async () => {
    const db = { from: () => { const q: Record<string, unknown> = { select: () => q, eq: () => q, in: () => q, then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: 'PGRST205' } }).then(r) }; return q } }
    await expect(applyHistoryReview(db as never, 'acc', new Map(), new Map([[customer, { id: 't', count: 1 }]]))).resolves.toBeUndefined()
  })
  it('adds only new phone contacts under the account owner and names unnamed chats', async () => {
    const inserts: unknown[] = [], updates: unknown[] = []
    const db = { from: (table: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'is', 'limit']) q[m] = () => q
      q.insert = (rows: unknown) => { inserts.push(rows); return Promise.resolve({ error: null }) }
      q.update = (v: unknown) => { updates.push(v); return q }
      q.then = (r: (v: unknown) => unknown) => Promise.resolve(
        table === 'profiles' ? { data: [{ user_id: 'owner' }], error: null }
          : table === 'contacts' ? { data: [{ phone_normalized: '923009999999' }], error: null }
            : table === 'monitoring_threads' ? { data: [{ id: 't1', customer }], error: null } : { data: [], error: null }).then(r)
      return q
    } }
    await savePhoneContacts(db as never, 'acc', [{ phone: customer, name: 'Hamza', action: 'add' }, { phone: '923009999999', name: 'Known', action: 'add' }, { phone: '923000000001', name: null, action: 'remove' }])
    expect(inserts).toEqual([[{ account_id: 'acc', user_id: 'owner', phone: customer, name: 'Hamza' }]])
    expect(updates).toEqual([{ customer_name: 'Hamza' }])
  })
})

describe('connection rules and progress', () => {
  const record = (syncs: ConnectionRecord['syncs'], at = new Date().toISOString()): ConnectionRecord => ({ connected_at: at, connected_by: 'u', waba_id: '1', phone_number_id: '2', display_number: null, token_source: 'embedded_signup', syncs })
  it('allows a sync retry only within 24 hours and only until it succeeds', () => {
    expect(canRequestSync(null, 'history')).toBe(false)
    expect(canRequestSync(record({ history: { ok: false, at: '' } }), 'history')).toBe(true)
    expect(canRequestSync(record({ history: { ok: true, at: '' } }), 'history')).toBe(false)
    expect(canRequestSync(record({}, new Date(Date.now() - SYNC_WINDOW_MS - 1000).toISOString()), 'history')).toBe(false)
  })
  it('aggregates progress from stored summaries', () => {
    const p = historyProgress([
      { field: 'history', received_at: '2026-10-21T10:00:00Z', payload: { value: { messages: 300, chunks: [{ phase: 0, progress: 20 }, { phase: 1, progress: 55 }] } } },
      { field: 'history', received_at: '2026-10-21T11:00:00Z', payload: { value: { messages: 10, declined: false, chunks: [{ phase: 2, progress: 100 }] } } },
      { field: 'smb_app_state_sync', received_at: '2026-10-21T09:00:00Z', payload: { value: { received: 344 } } },
    ])
    expect(p).toEqual({ chunks: 3, messages: 310, progress: 100, phases: [0, 1, 2], declined: false, contacts: 344, last_received_at: '2026-10-21T11:00:00Z' })
  })
})
