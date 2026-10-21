import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
import { ForbiddenError } from '@/lib/auth/account'
import { GET as listLabels, POST as createLabel } from './labels/route'
import { DELETE as deleteLabel, PATCH as editLabel } from './labels/[id]/route'
import { PUT as setLabels } from './threads/[id]/labels/route'
import { GET as profile, PUT as saveProfile } from './contacts/profile/route'
import { GET as counts } from './counts/route'

const company = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
const thread = '33333333-3333-4333-8333-333333333333'
const foreignThread = '44444444-4444-4444-8444-444444444444'
const label = '55555555-5555-4555-8555-555555555555'
const foreignLabel = '66666666-6666-4666-8666-666666666666'
type Row = Record<string, unknown>
let rows: Record<string, Row[]>
let writes: { table: string; op: string; value?: unknown; filters: [string, string, unknown][] }[]
let missing: Set<string>

function database() {
  return {
    from(table: string) {
      const filters: [string, string, unknown][] = []
      let op = 'select', value: unknown, head = false
      const matches = (row: Row) => filters.every(([kind, key, v]) => kind === 'eq' ? row[key] === v : kind === 'in' ? (v as unknown[]).includes(row[key]) : kind === 'neq' ? row[key] !== v : true)
      const run = () => {
        if (missing.has(table)) return { data: null, error: { code: 'PGRST205', message: 'missing' }, count: null }
        if (op !== 'select') writes.push({ table, op, value, filters: [...filters] })
        if (op === 'insert' || op === 'upsert') { const list = Array.isArray(value) ? value : [value]; return { data: list.map(v => ({ id: label, ...(v as Row) })), error: null, count: null } }
        const data = (rows[table] ?? []).filter(matches)
        return { data: head ? null : data, error: null, count: data.length }
      }
      const query = {
        select(_c?: string, options?: { head?: boolean }) { head = !!options?.head; return query },
        insert(v: unknown) { op = 'insert'; value = v; return query }, upsert(v: unknown) { op = 'upsert'; value = v; return query },
        update(v: unknown) { op = 'update'; value = v; return query }, delete() { op = 'delete'; return query },
        eq(k: string, v: unknown) { filters.push(['eq', k, v]); return query }, neq(k: string, v: unknown) { filters.push(['neq', k, v]); return query },
        in(k: string, v: unknown) { filters.push(['in', k, v]); return query }, not(k: string, _o: string, v: unknown) { filters.push(['not', k, v]); return query },
        contains(k: string, v: unknown) { filters.push(['contains', k, v]); return query }, or() { return query },
        order() { return query }, limit() { return query },
        single() { const r = run(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }) },
        maybeSingle() { const r = run(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }) },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve(run()).then(resolve) },
      }
      return query
    },
  }
}
beforeEach(() => {
  writes = []; missing = new Set()
  rows = {
    monitoring_threads: [{ id: thread, account_id: company, customer: '923001234567' }, { id: foreignThread, account_id: foreign, customer: '923001234567' }],
    monitoring_labels: [{ id: label, account_id: company, name: 'Hot lead' }, { id: foreignLabel, account_id: foreign, name: 'Other' }],
    monitoring_channels: [{ id: 'c1', account_id: company, label: 'Tahir' }],
    monitoring_inbox: [{ id: thread, account_id: company, state: 'open', is_unread: true, last_direction: 'inbound' }, { id: foreignThread, account_id: foreign, state: 'open', is_unread: true, last_direction: 'inbound' }],
    monitoring_contact_profiles: [],
  }
  mocks.role.mockResolvedValue({ supabase: database(), accountId: company, userId: 'manager' })
  mocks.admin.mockReturnValue(database())
})
afterEach(() => vi.clearAllMocks())
const json = (body: unknown, method = 'POST') => new Request('https://crm.test/api/monitoring/x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('labels', () => {
  it('lists only the company labels and reports a missing schema without failing', async () => {
    expect((await (await listLabels()).json()).labels).toEqual([{ id: label, account_id: company, name: 'Hot lead' }])
    missing.add('monitoring_labels')
    expect(await (await listLabels()).json()).toEqual({ labels: [], workflowReady: false })
  })
  it('validates and creates labels scoped to the company, ignoring a supplied account', async () => {
    expect((await createLabel(json({ name: '' }))).status).toBe(400)
    expect((await createLabel(json({ name: 'VIP', color: 'red' }))).status).toBe(400)
    const response = await createLabel(json({ name: ' VIP ', color: '#FF0000', account_id: foreign }))
    expect(response.status).toBe(201)
    expect(writes.at(-1)).toMatchObject({ table: 'monitoring_labels', op: 'insert', value: { name: 'VIP', color: '#ff0000', account_id: company, created_by: 'manager' } })
  })
  it('explains the database update when the schema is missing', async () => {
    missing.add('monitoring_labels')
    const response = await createLabel(json({ name: 'VIP' }))
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('workflow_schema_missing')
  })
  it('edits and deletes only company labels', async () => {
    expect((await editLabel(json({ name: 'Warm' }, 'PATCH'), ctx(foreignLabel))).status).toBe(404)
    expect((await deleteLabel(new Request('https://crm.test/x', { method: 'DELETE' }), ctx(label))).status).toBe(200)
    expect(writes.at(-1)?.filters).toContainEqual(['eq', 'account_id', company])
    expect((await deleteLabel(new Request('https://crm.test/x', { method: 'DELETE', headers: { origin: 'https://evil.test' } }), ctx(label))).status).toBe(403)
  })
  it('sets conversation labels only on company threads with company labels', async () => {
    expect((await setLabels(json({ label_ids: [label] }, 'PUT'), ctx(foreignThread))).status).toBe(404)
    expect((await setLabels(json({ label_ids: [foreignLabel] }, 'PUT'), ctx(thread))).status).toBe(400)
    expect((await setLabels(json({ label_ids: ['nope'] }, 'PUT'), ctx(thread))).status).toBe(400)
    const ok = await setLabels(json({ label_ids: [label, label] }, 'PUT'), ctx(thread))
    expect(await ok.json()).toEqual({ label_ids: [label] })
    expect(writes.find(w => w.op === 'upsert')?.value).toEqual([{ thread_id: thread, label_id: label, account_id: company, added_by: 'manager' }])
  })
})

describe('contact profiles', () => {
  it('returns only this company conversations for a customer', async () => {
    const body = await (await profile(new Request('https://crm.test/x?customer=%2B92%20300%201234567'))).json()
    expect(body.conversations).toEqual([{ id: thread, account_id: company, customer: '923001234567' }])
    expect((await profile(new Request('https://crm.test/x?customer=abc'))).status).toBe(400)
  })
  it('saves details only for known customers and validates email', async () => {
    expect((await saveProfile(json({ customer: '15550001111', name: 'X' }, 'PUT'))).status).toBe(404)
    expect((await saveProfile(json({ customer: '923001234567', email: 'not-an-email' }, 'PUT'))).status).toBe(400)
    expect((await saveProfile(json({ customer: '923001234567', name: ' Hamza ', company: '' }, 'PUT'))).status).toBe(200)
    expect(writes.at(-1)).toMatchObject({ table: 'monitoring_contact_profiles', op: 'upsert', value: { account_id: company, customer: '923001234567', name: 'Hamza', company: null } })
  })
})

describe('inbox counts', () => {
  it('counts every tab within the company and degrades before the schema exists', async () => {
    const body = await (await counts(new Request('https://crm.test/x'))).json()
    expect(body.counts).toEqual({ open: 1, waiting: 1, unread: 1, snoozed: 0, resolved: 0, all: 1 })
    missing.add('monitoring_inbox')
    expect(await (await counts(new Request('https://crm.test/x'))).json()).toEqual({ counts: null, workflowReady: false })
  })
  it('requires owner/admin access', async () => {
    mocks.role.mockRejectedValue(new ForbiddenError())
    for (const response of [await counts(new Request('https://crm.test/x')), await listLabels(), await profile(new Request('https://crm.test/x?customer=923001234567'))]) expect(response.status).toBe(403)
  })
})
