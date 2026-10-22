import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account'
import { GET as messages } from './messages/route'
import { GET as reports } from './reports/route'
afterEach(() => vi.clearAllMocks())

function database(results: Record<string, { data: unknown[]; count?: number; error?: unknown }>) {
  const queries: { table: string; calls: [string, unknown[]][] }[] = []
  const from = vi.fn((table: string) => {
    const calls: [string, unknown[]][] = []; queries.push({ table, calls })
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'lt', 'in', 'not', 'ilike', 'order', 'range', 'limit']) query[method] = (...args: unknown[]) => { calls.push([method, args]); return query }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(results[table] ?? { data: [] }).then(resolve)
    return query
  })
  mocks.role.mockResolvedValue({ role: 'admin',  supabase: { from }, accountId: 'own-company' })
  return { queries, from }
}

it('denies anonymous users and agents before querying messages or reports', async () => {
  for (const error of [new UnauthorizedError(), new ForbiddenError()]) {
    mocks.role.mockRejectedValue(error)
    for (const handler of [messages, reports]) expect((await handler(new Request('https://crm.test/api/monitoring'))).status).toBe(error instanceof UnauthorizedError ? 401 : 403)
  }
})
it('scopes messages and customer lookups to the same company and constrains media filtering', async () => {
  const { queries } = database({ monitoring_messages: { data: [{ id: 'm', thread_id: 't', channel_id: 'c', kind: 'image' }], count: 1 }, monitoring_threads: { data: [{ id: 't', customer: '15550100000', customer_name: 'Preview' }] } })
  const response = await messages(new Request('https://crm.test/api/monitoring/messages?media=true&direction=inbound&page=2&q=50%25'))
  expect(response.status).toBe(200)
  for (const q of queries) expect(q.calls).toContainEqual(['eq', ['account_id', 'own-company']])
  const list = queries.find(q => q.table === 'monitoring_messages')!
  expect(list.calls).toContainEqual(['range', [100, 149]])
  expect(list.calls).toContainEqual(['not', ['media_id', 'is', null]])
  expect(list.calls).toContainEqual(['ilike', ['content', '%50\\%%']])
  expect((await response.json()).messages[0].customer_name).toBe('Preview')
})
it('returns database errors rather than displaying an empty successful report', async () => {
  database({ monitoring_messages: { data: [], error: { message: 'private details' } } })
  const response = await reports(new Request('https://crm.test/api/monitoring/reports'))
  expect(response.status).toBe(503)
  expect(JSON.stringify(await response.json())).not.toContain('private details')
})
it('labels bounded reports as partial and paginates past the database row limit', async () => {
  const today = new Date().toISOString()
  const { queries } = database({ monitoring_messages: { data: Array.from({ length: 1000 }, () => ({ channel_id: 'a', direction: 'inbound', sent_at: today, kind: 'text' })), count: 10001 } })
  const response = await reports(new Request('https://crm.test/api/monitoring/reports?days=7'))
  const result = await response.json()
  expect(result).toMatchObject({ included: 10000, total: 10001, truncated: true, inbound: 10000 })
  const messageQueries = queries.filter(q => q.table === 'monitoring_messages')
  expect(messageQueries).toHaveLength(10)
  expect(messageQueries[9].calls).toContainEqual(['range', [9000, 9999]])
  for (const q of queries) expect(q.calls).toContainEqual(['eq', ['account_id', 'own-company']])
})
