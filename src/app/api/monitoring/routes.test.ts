import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), verify: vi.fn(), numbers: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ verifyPhoneNumber: mocks.verify, listWabaPhoneNumbers: mocks.numbers }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { GET as list } from './route'
import { GET as detail, PATCH as update } from './threads/[id]/route'
import { POST as channel } from './channels/route'
import { GET as events } from './events/route'
import { GET as eventDetail } from './events/[id]/route'

const company = '11111111-1111-1111-1111-111111111111'
const foreign = '22222222-2222-2222-2222-222222222222'
const thread = '33333333-3333-3333-3333-333333333333'
const foreignThread = '44444444-4444-4444-4444-444444444444'
type Row = Record<string, unknown>
let rows: Record<string, Row[]>
let calls: { table: string; method: string; args: unknown[] }[]
let rpc: ReturnType<typeof vi.fn>
let failure: { code: string; message: string } | null

function database() {
  return {
    from(table: string) {
      const filters: [string, unknown][] = []
      let range = [0, 999]
      const result = () => {
        const data = (rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value))
        return { data: data.slice(range[0], range[1] + 1), error: failure, count: data.length }
      }
      const query = {
        select(...args: unknown[]) { calls.push({ table, method: 'select', args }); return query },
        eq(key: string, value: unknown) { calls.push({ table, method: 'eq', args: [key, value] }); filters.push([key, value]); return query },
        in(...args: unknown[]) { calls.push({ table, method: 'in', args }); return query },
        or(...args: unknown[]) { calls.push({ table, method: 'or', args }); return query },
        order(...args: unknown[]) { calls.push({ table, method: 'order', args }); return query },
        range(start: number, end: number) { calls.push({ table, method: 'range', args: [start, end] }); range = [start, end]; return query },
        maybeSingle() { const value = result(); return Promise.resolve({ ...value, data: value.data[0] ?? null }) },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve) },
      }
      return query
    }, rpc,
  }
}
beforeEach(() => {
  calls = []; failure = null
  rpc = vi.fn(async () => ({ error: null, data: null }))
  mocks.admin.mockReturnValue(database())
  rows = {
    monitoring_channels: [{ id: 'channel', account_id: company, label: 'Agent A', phone_number_id: '123' }, { id: 'other-channel', account_id: foreign, label: 'Other company' }],
    monitoring_threads: [{ id: thread, account_id: company, customer: 'customer' }, { id: foreignThread, account_id: foreign, customer: 'private' }],
    monitoring_messages: [{ id: 'message', account_id: company, thread_id: thread }],
    monitoring_lead_audit: [{ id: 'audit', account_id: company, thread_id: thread }],
    monitoring_events: [],
  }
  mocks.role.mockResolvedValue({ supabase: database(), accountId: company, userId: 'manager', role: 'admin' })
  mocks.verify.mockResolvedValue({ display_phone_number: '+123' })
  mocks.numbers.mockResolvedValue([{ id: '123' }])
})
afterEach(() => vi.clearAllMocks())
const context = (id = thread) => ({ params: Promise.resolve({ id }) })
const get = (path = '') => new Request(`https://crm.test/api/monitoring${path}`)
const post = (body: unknown, method = 'POST', origin?: string) => new Request('https://crm.test/api/monitoring', { method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) })

describe('management monitoring APIs', () => {
  it('scopes every list query to the authenticated company, ignoring supplied account IDs', async () => {
    const response = await list(get(`?account_id=${foreign}`))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.channels).toHaveLength(1); expect(body.threads).toHaveLength(1)
    expect(body.threads[0].customer).toBe('customer')
    expect(mocks.role).toHaveBeenCalledWith('admin')
    expect(calls.filter(c => c.method === 'eq' && c.args[0] === 'account_id')).toEqual([
      { table: 'monitoring_channels', method: 'eq', args: ['account_id', company] },
      { table: 'monitoring_threads', method: 'eq', args: ['account_id', company] },
    ])
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(calls.find(c => c.table === 'monitoring_channels' && c.method === 'select')?.args[0]).not.toMatch(/token|credential/)
  })
  it('denies agents/viewers and anonymous access before querying data', async () => {
    for (const error of [new ForbiddenError(), new UnauthorizedError()]) {
      mocks.role.mockRejectedValue(error)
      for (const invoke of [() => list(get()), () => detail(get(), context()), () => update(post({ lead_status: 'won' }, 'PATCH'), context()), () => channel(post({})), () => events(get()), () => eventDetail(get(), context())]) {
        expect((await invoke()).status).toBe(error.status)
      }
    }
    expect(calls).toEqual([]); expect(rpc).not.toHaveBeenCalled()
  })
  it('prevents cross-company thread reads and status writes', async () => {
    expect((await detail(get(), context(foreignThread))).status).toBe(404)
    expect((await update(post({ lead_status: 'won' }, 'PATCH'), context(foreignThread))).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
    expect(calls.some(c => c.table === 'monitoring_messages')).toBe(false)
  })
  it('scopes messages and audit to company and thread, with bounded pagination', async () => {
    expect((await detail(get('?page=1&auditPage=2'), context())).status).toBe(200)
    for (const table of ['monitoring_messages', 'monitoring_lead_audit']) {
      expect(calls).toContainEqual({ table, method: 'eq', args: ['account_id', company] })
      expect(calls).toContainEqual({ table, method: 'eq', args: ['thread_id', thread] })
    }
    expect(calls).toContainEqual({ table: 'monitoring_messages', method: 'range', args: [50, 99] })
    expect(calls).toContainEqual({ table: 'monitoring_lead_audit', method: 'range', args: [50, 74] })
  })
  it('rejects invalid pagination and identifiers', async () => {
    expect((await list(get('?page=-1'))).status).toBe(400)
    expect((await list(get('?page=1.5'))).status).toBe(400)
    expect((await detail(get(), context('bad-id'))).status).toBe(400)
  })
  it('records lead changes through the existing atomic audit function', async () => {
    expect((await update(post({ lead_status: 'won' }, 'PATCH'), context())).status).toBe(200)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('set_monitoring_lead_status', { p_thread: thread, p_status: 'won' })
  })
  it('rejects cross-origin credential and status changes', async () => {
    expect((await channel(post({}, 'POST', 'https://other.test'))).status).toBe(403)
    expect((await update(post({ lead_status: 'won' }, 'PATCH', 'https://other.test'), context())).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('accepts the browser destination when standalone uses an internal request URL', async () => {
    const request = post({ lead_status: 'won' }, 'PATCH', 'http://127.0.0.1:3000')
    request.headers.set('host', '127.0.0.1:3000')
    expect((await update(request, context())).status).toBe(200)
  })
  it('does not trust a forwarded host supplied with a foreign origin', async () => {
    const request = post({ lead_status: 'won' }, 'PATCH', 'https://other.test')
    request.headers.set('host', 'crm.test')
    request.headers.set('x-forwarded-host', 'other.test')
    expect((await update(request, context())).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('encrypts channel credentials and uses the authenticated company', async () => {
    const response = await channel(post({ phone_number_id: '123', waba_id: '456', label: 'Agent A', access_token: 'test-access-token', account_id: foreign }))
    expect(response.status).toBe(201)
    const [name, args] = rpc.mock.calls[0] as unknown as [string, Record<string, string>]
    expect(name).toBe('create_monitoring_channel')
    expect(args.p_account).toBe(company)
    expect(args.p_token).not.toContain('test-access-token')
    expect(decrypt(args.p_token)).toBe('test-access-token')
    expect(await response.text()).not.toContain('test-access-token')
  })
  it('rejects a phone outside the supplied WABA without storing credentials', async () => {
    mocks.numbers.mockResolvedValue([{ id: '999' }])
    expect((await channel(post({ phone_number_id: '123', waba_id: '456', label: 'Agent A', access_token: 'test-access-token' }))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('does not expose database error contents', async () => {
    failure = { code: 'internal', message: 'sensitive-database-value' }
    const response = await list(get())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('sensitive-database-value')
  })
  it('scopes service-role event reads to the authenticated company', async () => {
    rows.monitoring_events = [{ id: thread, account_id: company, needs_review: true }, { id: foreignThread, account_id: foreign, needs_review: true }]
    const response = await events(get())
    expect((await response.json()).events).toHaveLength(1)
    expect((await eventDetail(get(), context(foreignThread))).status).toBe(404)
    expect(calls.filter(c => c.table === 'monitoring_events' && c.method === 'eq' && c.args[0] === 'account_id')).toHaveLength(2)
  })
})
