import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn(), list: vi.fn(), subscribe: vi.fn(), verify: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ listWabaPhoneNumbers: mocks.list, subscribeWabaToApp: mocks.subscribe, verifyPhoneNumber: mocks.verify }))
import { POST as connect } from './route'
import { POST as retry } from './sync/route'
import { connectionEventId } from '@/lib/monitoring/connect'
import { encrypt } from '@/lib/whatsapp/encryption'

const company = '11111111-1111-4111-8111-111111111111'
const channel = '33333333-3333-4333-8333-333333333333'
type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let writes: { table: string; op: string; value: unknown }[]
let rpc: ReturnType<typeof vi.fn>
let calls: { url: string; body?: string }[]
let exchange: { ok: boolean; body: unknown }

function database() {
  return {
    rpc,
    from(table: string) {
      const filters: [string, unknown][] = []
      let op = 'select', value: unknown
      const run = () => {
        if (op !== 'select') writes.push({ table, op, value })
        const data = (tables[table] ?? []).filter(row => filters.every(([k, v]) => row[k] === v))
        return { data, error: null }
      }
      const q = {
        select: () => q, update: (v: unknown) => { op = 'update'; value = v; return q }, upsert: (v: unknown) => { op = 'upsert'; value = v; return q },
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q }, in: () => q, order: () => q, limit: () => q,
        maybeSingle: () => { const r = run(); return Promise.resolve({ ...r, data: r.data[0] ?? null }) },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      }
      return q
    },
  }
}
beforeEach(() => {
  vi.stubEnv('META_APP_SECRET', 'app-secret'); vi.stubEnv('ENCRYPTION_KEY', '0'.repeat(64))
  tables = { monitoring_channels: [], monitoring_credentials: [], monitoring_events: [] }
  writes = []; calls = []; exchange = { ok: true, body: { access_token: 'business-token' } }
  rpc = vi.fn(async (_name: string, args: Row) => { tables.monitoring_channels.push({ id: channel, account_id: company, phone_number_id: args.p_phone, active: true }); return { error: null } })
  mocks.role.mockResolvedValue({ supabase: database(), accountId: company, userId: 'manager' })
  mocks.admin.mockImplementation(() => database())
  mocks.list.mockResolvedValue([{ id: '555', display_phone_number: '+92 308 6803745' }])
  mocks.verify.mockResolvedValue({ display_phone_number: '+92 308 6803745' })
  mocks.subscribe.mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input); calls.push({ url, body: init?.body as string | undefined })
    if (url.includes('/oauth/access_token')) return new Response(JSON.stringify(exchange.body), { status: exchange.ok ? 200 : 400 })
    if (url.includes('/smb_app_data')) return new Response(JSON.stringify({ messaging_product: 'whatsapp', request_id: `req-${calls.length}` }), { status: 200 })
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const json = (body: unknown) => new Request('https://crm.test/api/monitoring/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const input = { code: 'one-time-code', waba_id: '1192605976360851', label: 'Ali Anwar' }

describe('Connect number', () => {
  it('connects a number, subscribes webhooks and requests contacts then history, without registering it', async () => {
    const response = await connect(json({ ...input, account_id: 'other-company' }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({ channel_id: channel, display_number: '+92 308 6803745', syncs: { smb_app_state_sync: { ok: true }, history: { ok: true } } })
    const exchangeUrl = new URL(calls[0].url)
    expect(exchangeUrl.searchParams.get('client_id')).toBe('1121820883867005')
    expect(exchangeUrl.searchParams.get('code')).toBe('one-time-code')
    expect(calls.slice(1).map(c => JSON.parse(c.body!).sync_type)).toEqual(['smb_app_state_sync', 'history'])
    expect(calls.some(c => c.url.includes('/register'))).toBe(false)
    expect(mocks.subscribe).toHaveBeenCalledWith({ wabaId: input.waba_id, accessToken: 'business-token' })
    expect(rpc).toHaveBeenCalledWith('create_monitoring_channel', expect.objectContaining({ p_account: company, p_phone: '555', p_label: 'Ali Anwar' }))
    const record = writes.find(w => w.table === 'monitoring_events')!.value as Row
    expect(record).toMatchObject({ id: connectionEventId(company, channel), account_id: company, field: 'management_connection' })
    expect(JSON.stringify(record)).not.toContain('business-token')
  })
  it('saves nothing when Meta rejects the code', async () => {
    exchange = { ok: false, body: { error: { code: 100, message: 'expired' } } }
    const response = await connect(json(input))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/30 seconds/)
    expect(rpc).not.toHaveBeenCalled(); expect(mocks.subscribe).not.toHaveBeenCalled()
  })
  it('refuses a number owned by another workspace and ambiguous multi-number accounts', async () => {
    tables.monitoring_channels.push({ id: 'x', account_id: 'other', phone_number_id: '555' })
    expect((await connect(json(input))).status).toBe(409)
    tables.monitoring_channels = []
    mocks.list.mockResolvedValue([{ id: '555' }, { id: '666' }])
    expect((await connect(json(input))).status).toBe(400)
    expect((await connect(json({ ...input, phone_number_id: '666' }))).status).toBe(201)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('stops before saving when the webhook subscription fails', async () => {
    mocks.subscribe.mockRejectedValue(new Error('denied'))
    expect((await connect(json(input))).status).toBe(502)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('reactivates an existing number and keeps a working saved token', async () => {
    tables.monitoring_channels.push({ id: channel, account_id: company, phone_number_id: '555', active: false })
    tables.monitoring_credentials.push({ channel_id: channel, encrypted_token: encrypt('permanent-token') })
    const body = await (await connect(json(input))).json()
    expect(body.channel_id).toBe(channel)
    expect(rpc).not.toHaveBeenCalled()
    expect(writes.find(w => w.table === 'monitoring_channels')?.value).toMatchObject({ active: true, label: 'Ali Anwar' })
    expect(writes.some(w => w.table === 'monitoring_credentials')).toBe(false)
  })
})

describe('sync retry', () => {
  const record = (syncs: Row, at = new Date().toISOString()) => ({ id: connectionEventId(company, channel), account_id: company, payload: { connected_at: at, connected_by: 'm', waba_id: '1', phone_number_id: '555', display_number: null, token_source: 'embedded_signup', syncs } })
  beforeEach(() => {
    tables.monitoring_channels.push({ id: channel, account_id: company, phone_number_id: '555' })
    tables.monitoring_credentials.push({ channel_id: channel, encrypted_token: encrypt('token') })
  })
  it('retries a failed request inside the window', async () => {
    tables.monitoring_events.push(record({ history: { ok: false, at: '' } }))
    const response = await retry(json({ channel_id: channel, sync_type: 'history' }))
    expect(response.status).toBe(200)
    expect(JSON.parse(calls[0].body!)).toEqual({ messaging_product: 'whatsapp', sync_type: 'history' })
  })
  it('never repeats a successful request or retries after 24 hours', async () => {
    tables.monitoring_events.push(record({ history: { ok: true, at: '' } }))
    expect((await retry(json({ channel_id: channel, sync_type: 'history' }))).status).toBe(409)
    tables.monitoring_events = [record({}, new Date(Date.now() - 25 * 3600000).toISOString())]
    expect((await retry(json({ channel_id: channel, sync_type: 'history' }))).status).toBe(409)
    expect(calls).toEqual([])
  })
  it('rejects unknown sync types and other companies’ numbers', async () => {
    expect((await retry(json({ channel_id: channel, sync_type: 'everything' }))).status).toBe(400)
    tables.monitoring_channels = []
    expect((await retry(json({ channel_id: channel, sync_type: 'history' }))).status).toBe(404)
  })
})
