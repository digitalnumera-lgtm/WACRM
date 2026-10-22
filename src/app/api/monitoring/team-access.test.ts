import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: () => { throw new Error('no request scope') } }))
import { GET as list } from './route'
import { GET as thread, PATCH as setLead } from './threads/[id]/route'
import { PATCH as workflow } from './threads/[id]/workflow/route'
import { GET as media } from './messages/[id]/media/route'
import { GET as messages } from './messages/route'
import { GET as me } from './me/route'
import { GET as team } from './team/route'
import { POST as invite } from './team/invites/route'
import { POST as createRole } from './team/roles/route'
import { runStorageCleanup } from '@/lib/monitoring/storage'
import { allowedChannels, scopeChannels } from '@/lib/monitoring/team-access'

const company = '11111111-1111-4111-8111-111111111111'
const chanA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const chanB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const threadA = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const threadB = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1'
const msgB = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
const auditor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const member = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
type Row = Record<string, unknown>
let rows: Record<string, Row[]>
let writes: { table: string; op: string; value?: unknown }[]
let rpcs: { name: string; args: Row }[]
let removed: string[]

function database() {
  return {
    rpc(name: string, args: Row) {
      rpcs.push({ name, args })
      if (name === 'monitoring_claim_cleanup') return Promise.resolve({ data: rows.claim?.[0]?.ok ?? true, error: null })
      if (name === 'monitoring_media_cleanup_candidates') { const data = rows.candidates ?? []; rows.candidates = []; return Promise.resolve({ data, error: null }) }
      return Promise.resolve({ data: null, error: null })
    },
    storage: { from: () => ({
      remove: (names: string[]) => { removed.push(...names); return Promise.resolve({ data: names.map(name => ({ name })), error: null }) },
      createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
      download: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
    }) },
    from(table: string) {
      const filters: [string, string, unknown][] = []
      let op = 'select', value: unknown, head = false
      const matches = (row: Row) => filters.every(([kind, key, v]) => kind === 'eq' ? row[key] === v : kind === 'in' ? (v as unknown[]).includes(row[key]) : kind === 'is' ? row[key] === v || (v === null && row[key] === undefined) : kind === 'ilike' ? String(row[key] ?? '').toLowerCase() === String(v).replace(/\\(.)/g, '$1').toLowerCase() : true)
      const run = () => {
        if (op !== 'select') writes.push({ table, op, value })
        if (op === 'insert' || op === 'upsert') { const list = Array.isArray(value) ? value : [value]; return { data: list.map(v => ({ id: `${table}-new`, expires_at: '2026-10-29T00:00:00Z', ...(v as Row) })), error: null, count: null } }
        const data = (rows[table] ?? []).filter(matches)
        return { data: head ? null : data, error: null, count: data.length }
      }
      const query: Record<string, unknown> = {
        select(_c?: string, options?: { head?: boolean }) { head = !!options?.head; return query },
        insert(v: unknown) { op = 'insert'; value = v; return query }, upsert(v: unknown) { op = 'upsert'; value = v; return query },
        update(v: unknown) { op = 'update'; value = v; return query }, delete() { op = 'delete'; return query },
        eq(k: string, v: unknown) { filters.push(['eq', k, v]); return query }, in(k: string, v: unknown) { filters.push(['in', k, v]); return query },
        is(k: string, v: unknown) { filters.push(['is', k, v]); return query },
        ilike(k: string, v: unknown) { filters.push(['ilike', k, v]); return query },
        not() { return query }, or() { return query }, gte() { return query }, lt() { return query }, contains() { return query },
        order() { return query }, limit() { return query }, range() { return query },
        single() { const r = run(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }) },
        maybeSingle() { const r = run(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }) },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve(run()).then(resolve) },
      }
      return query
    },
  }
}
const db = database()
const asMember = () => mocks.role.mockResolvedValue({ role: 'viewer', accountId: company, userId: member, supabase: db, account: { id: company, name: 'Numera' } })
const asOwner = () => mocks.role.mockResolvedValue({ role: 'owner', accountId: company, userId: 'owner', supabase: db, account: { id: company, name: 'Numera' } })
const get = (path: string) => new Request(`https://crm.test${path}`)
const send = (path: string, method: string, body: unknown) => new Request(`https://crm.test${path}`, { method, headers: { 'Content-Type': 'application/json', origin: 'https://crm.test', host: 'crm.test' }, body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  writes = []; rpcs = []; removed = []
  mocks.admin.mockReturnValue(db)
  rows = {
    monitoring_member_access: [{ account_id: company, user_id: member, role_id: auditor, channel_ids: [chanA], monitoring_roles: { name: 'Auditor', permissions: ['view_inbox', 'view_media', 'view_contacts'] } }],
    monitoring_channels: [{ id: chanA, account_id: company, label: 'Ahmad' }, { id: chanB, account_id: company, label: 'Somia' }],
    monitoring_inbox: [{ id: threadA, account_id: company, channel_id: chanA }, { id: threadB, account_id: company, channel_id: chanB }],
    monitoring_threads: [{ id: threadA, account_id: company, channel_id: chanA, message_count: 1 }, { id: threadB, account_id: company, channel_id: chanB, message_count: 1 }],
    monitoring_messages: [{ id: msgB, account_id: company, channel_id: chanB, thread_id: threadB, media_id: 'meta-media' }],
    monitoring_roles: [{ id: auditor, account_id: company, name: 'Auditor', permissions: ['view_inbox'] }],
    profiles: [{ user_id: 'owner', account_id: company, account_role: 'owner', email: 'numeradigital@gmail.com' }],
  }
})
afterEach(() => vi.clearAllMocks())

describe('team member access', () => {
  it('reports the role, permissions and numbers to the UI', async () => {
    asMember()
    const body = await (await me()).json()
    expect(body.me).toEqual({ full: false, role: 'Auditor', permissions: ['view_inbox', 'view_media', 'view_contacts'], channelIds: [chanA] })
  })

  it('denies people without a CRM role', async () => {
    asMember(); rows.monitoring_member_access = []
    expect((await me()).status).toBe(403)
    expect((await list(get('/api/monitoring'))).status).toBe(403)
  })

  it('lists only the assigned numbers and their conversations', async () => {
    asMember()
    const body = await (await list(get('/api/monitoring?tab=all'))).json()
    expect(body.channels.map((c: Row) => c.id)).toEqual([chanA])
    expect(body.threads.map((t: Row) => t.id)).toEqual([threadA])
  })

  it('hides conversations and media from other numbers', async () => {
    asMember()
    expect((await thread(get(`/api/monitoring/threads/${threadB}?scroll=1`), ctx(threadB))).status).toBe(404)
    expect((await thread(get(`/api/monitoring/threads/${threadA}?scroll=1`), ctx(threadA))).status).toBe(200)
    expect((await media(get(`/api/monitoring/messages/${msgB}/media`), ctx(msgB))).status).toBe(404)
  })

  it('blocks actions the role does not allow', async () => {
    asMember()
    expect((await workflow(send(`/api/monitoring/threads/${threadA}/workflow`, 'PATCH', { action: 'read' }), ctx(threadA))).status).toBe(403)
    expect((await setLead(send(`/api/monitoring/threads/${threadA}`, 'PATCH', { lead_status: 'won' }), ctx(threadA))).status).toBe(403)
    expect((await team()).status).toBe(403)
    expect(writes).toEqual([])
  })

  it('changes lead stage through the server-side function when allowed', async () => {
    asMember()
    ;(rows.monitoring_member_access[0].monitoring_roles as Row).permissions = ['view_inbox', 'edit_lead_stage']
    expect((await setLead(send(`/api/monitoring/threads/${threadA}`, 'PATCH', { lead_status: 'won' }), ctx(threadA))).status).toBe(200)
    expect(rpcs).toEqual([{ name: 'monitoring_set_lead_status_as', args: { p_account: company, p_thread: threadA, p_status: 'won', p_actor: member } }])
  })

  it('needs media permission for the Media library', async () => {
    asMember()
    ;(rows.monitoring_member_access[0].monitoring_roles as Row).permissions = ['view_inbox']
    expect((await messages(get('/api/monitoring/messages?kinds=image,video'))).status).toBe(403)
    expect((await messages(get('/api/monitoring/messages'))).status).toBe(200)
  })
})

describe('team management', () => {
  it('only invites the company email domain and binds the link to that email', async () => {
    asOwner()
    expect((await invite(send('/api/monitoring/team/invites', 'POST', { email: 'someone@gmail.com', access: auditor, channel_ids: null }))).status).toBe(400)
    const response = await invite(send('/api/monitoring/team/invites', 'POST', { email: 'Sara@DigitalNumera.com', access: auditor, channel_ids: [chanA] }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.url).toMatch(/^https:\/\/crm\.test\/join\/[A-Za-z0-9_-]+$/)
    expect(writes.find(w => w.table === 'account_invitations')?.value).toMatchObject({ account_id: company, role: 'viewer' })
    expect(writes.find(w => w.table === 'monitoring_invites')?.value).toMatchObject({ email: 'sara@digitalnumera.com', role_id: auditor, channel_ids: [chanA] })
  })

  it('rejects numbers from outside the company', async () => {
    asOwner()
    const other = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    expect((await invite(send('/api/monitoring/team/invites', 'POST', { email: 'ali@digitalnumera.com', access: auditor, channel_ids: [other] }))).status).toBe(400)
  })

  it('always gives roles conversation access and rejects unknown permissions', async () => {
    asOwner()
    expect((await createRole(send('/api/monitoring/team/roles', 'POST', { name: 'Root', permissions: ['delete_everything'] }))).status).toBe(400)
    expect((await createRole(send('/api/monitoring/team/roles', 'POST', { name: 'Reports', permissions: ['view_reports'] }))).status).toBe(201)
    expect(writes.at(-1)?.value).toMatchObject({ name: 'Reports', permissions: ['view_inbox', 'view_reports'], account_id: company })
  })
})

describe('scope helpers', () => {
  it('intersects filters with assigned numbers', () => {
    expect(allowedChannels({ channelIds: null }, null)).toBeNull()
    expect(allowedChannels({ channelIds: [chanA] }, null)).toEqual([chanA])
    expect(allowedChannels({ channelIds: [chanA] }, [chanB])).toEqual([])
    const query = { in: vi.fn().mockReturnThis() }
    scopeChannels({ channelIds: [] }, query)
    expect(query.in).toHaveBeenCalledWith('channel_id', ['00000000-0000-0000-0000-000000000000'])
  })
})

describe('storage cleanup', () => {
  it('removes only this company’s files and records the result', async () => {
    rows.candidates = [{ name: `${company}/m1`, bytes: 100, reason: 'cap' }, { name: 'other-company/m2', bytes: 50, reason: 'idle' }]
    const result = await runStorageCleanup(db as never, company)
    expect(removed).toEqual([`${company}/m1`])
    expect(result).toMatchObject({ ran: true, removed: 1, bytes: 100, cap: 1 })
  })

  it('does nothing when another run happened recently', async () => {
    rows.claim = [{ ok: false }]
    rows.candidates = [{ name: `${company}/m1`, bytes: 100, reason: 'cap' }]
    expect((await runStorageCleanup(db as never, company)).ran).toBe(false)
    expect(removed).toEqual([])
  })
})
