import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
import { GET as view } from './route'
import { GET as settings, POST as saveSettings } from './settings/route'
import { PUT as setAccess } from './access/route'
import { POST as act } from './actions/route'

const company = '11111111-1111-4111-8111-111111111111'
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const admin = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const agent = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
type Row = Record<string, unknown>
let rows: Record<string, Row[]>
let writes: { table: string; op: string; value?: unknown }[]

function database() {
  return {
    from(table: string) {
      const filters: [string, unknown][] = []
      let op = 'select', value: unknown
      const run = () => {
        if (op !== 'select') writes.push({ table, op, value })
        if (op === 'delete') rows[table] = (rows[table] ?? []).filter(r => !filters.every(([k, v]) => r[k] === v))
        if (op === 'upsert') rows[table] = [...(rows[table] ?? []), value as Row]
        return { data: (rows[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v)), error: null }
      }
      const q = {
        select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        upsert: (v: unknown) => { op = 'upsert'; value = v; return q }, delete: () => { op = 'delete'; return q },
        maybeSingle: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      }
      return q
    },
  }
}
const as = (userId: string, role: string) => mocks.role.mockResolvedValue({ userId, accountId: company, role, supabase: database(), account: { id: company, name: 'Numera' } })
const put = (body: unknown) => new Request('http://crm.test/api/tracker/access', { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'http://crm.test', host: 'crm.test' }, body: JSON.stringify(body) })
const snapshot = { generatedAt: 'x', tabs: { Deals: { headers: ['Deal ID', 'Client', 'Deal Total'], rows: [['D-0001', 'Ali', '30,000']] }, Agents: { headers: ['Pay Month'], rows: [['Oct 2026']] } } }

beforeEach(() => {
  writes = []
  rows = {
    profiles: [{ user_id: owner, account_id: company, account_role: 'owner', full_name: 'Owner' }, { user_id: admin, account_id: company, account_role: 'admin', full_name: 'Admin' }, { user_id: agent, account_id: company, account_role: 'viewer', full_name: 'Agent' }],
    tracker_access: [],
    tracker_snapshot: [{ account_id: company, data: snapshot, fetched_at: new Date().toISOString() }],
  }
  mocks.admin.mockImplementation(database)
})

describe('client tracker access', () => {
  it('lets nobody but the owner in by default, admins included', async () => {
    as(agent, 'viewer'); expect((await view(new Request('http://crm.test/api/tracker'))).status).toBe(403)
    as(admin, 'admin'); expect((await view(new Request('http://crm.test/api/tracker'))).status).toBe(403)
    as(owner, 'owner')
    const body = await (await view(new Request('http://crm.test/api/tracker'))).json()
    expect(body.level).toBe('owner')
    expect(body.commission.agents.rows).toHaveLength(1)
  })

  it('shows an admin with view access no amounts, and removing access locks them out again', async () => {
    rows.tracker_access.push({ account_id: company, user_id: admin, level: 'view' })
    as(admin, 'admin')
    const body = await (await view(new Request('http://crm.test/api/tracker'))).json()
    expect(body.deals[0].money).toBeUndefined()
    expect(body.payments).toBeUndefined()
    expect(body.commission).toBeUndefined()
    as(owner, 'owner')
    expect((await setAccess(put({ user_id: admin, level: null }))).status).toBe(200)
    as(admin, 'admin')
    expect((await view(new Request('http://crm.test/api/tracker'))).status).toBe(403)
  })

  it('lets only the owner manage access and the connection', async () => {
    as(admin, 'admin')
    expect((await setAccess(put({ user_id: admin, level: 'full' }))).status).toBe(403)
    expect((await settings()).status).toBe(403)
    rows.tracker_access.push({ account_id: company, user_id: admin, level: 'full' })
    expect((await setAccess(put({ user_id: agent, level: 'full' }))).status).toBe(403)
    expect((await saveSettings(new Request('http://crm.test/api/tracker/settings', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://crm.test', host: 'crm.test' }, body: JSON.stringify({ action: 'new_key' }) }))).status).toBe(403)
    expect(writes).toEqual([])
  })

  it('validates the level and never changes the owner', async () => {
    as(owner, 'owner')
    expect((await setAccess(put({ user_id: agent, level: 'admin' }))).status).toBe(400)
    expect((await setAccess(put({ user_id: owner, level: 'view' }))).status).toBe(400)
    expect((await setAccess(put({ user_id: agent, level: 'amounts' }))).status).toBe(200)
    expect(rows.tracker_access).toContainEqual(expect.objectContaining({ user_id: agent, level: 'amounts', granted_by: owner }))
  })

  it('rejects a web app link that is not Apps Script', async () => {
    as(owner, 'owner')
    const res = await saveSettings(new Request('http://crm.test/api/tracker/settings', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://crm.test', host: 'crm.test' }, body: JSON.stringify({ url: 'https://evil.example/exec' }) }))
    expect(res.status).toBe(400)
  })

  it('allows changes only at Full level', async () => {
    const req = () => new Request('http://crm.test/api/tracker/actions', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://crm.test', host: 'crm.test' }, body: JSON.stringify({ action: 'approve', input: { dealId: 'D-0001' } }) })
    rows.tracker_access.push({ account_id: company, user_id: admin, level: 'amounts' })
    as(admin, 'admin'); expect((await act(req())).status).toBe(403)
    as(agent, 'viewer'); expect((await act(req())).status).toBe(403)
    as(owner, 'owner'); expect((await act(req())).status).toBe(409) // allowed, but the Sheet is not connected in this test
  })
})
