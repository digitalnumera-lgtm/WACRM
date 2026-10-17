import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account'
import { POST as history } from './import/route'
import { GET as contacts, POST as importContacts } from './contacts/route'
import { POST as portfolio } from './portfolio/route'
import { GET as summary } from './summary/route'
afterEach(() => vi.clearAllMocks())
it('all new endpoints require management authentication before data access', async () => {
  for (const error of [new UnauthorizedError(), new ForbiddenError()]) {
    mocks.role.mockRejectedValue(error)
    for (const handler of [history, contacts, importContacts, portfolio, summary]) {
      const response = await handler(new Request('https://crm.test/api/monitoring'))
      expect(response.status).toBe(error instanceof UnauthorizedError ? 401 : 403)
    }
  }
  expect(mocks.admin).not.toHaveBeenCalled()
})
it('history cannot import into another company channel', async () => {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) }
  mocks.role.mockResolvedValue({ accountId: 'own-company', supabase: { from: () => query } })
  const response = await history(new Request('https://crm.test/api/monitoring/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel_id: '11111111-1111-4111-8111-111111111111', messages: [] }) }))
  expect(response.status).toBe(404)
  expect(query.eq).toHaveBeenCalledWith('account_id', 'own-company')
  expect(mocks.admin).not.toHaveBeenCalled()
})
it('history preview validates rows but performs no writes', async () => {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'channel' } }) }
  mocks.role.mockResolvedValue({ accountId: 'own-company', supabase: { from: () => query } })
  const response = await history(new Request('https://crm.test/api/monitoring/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel_id: '11111111-1111-4111-8111-111111111111', preview: true, messages: [{ customer: '15550100001', direction: 'inbound', timestamp: '2026-10-01T10:00:00Z', text: 'Hello' }] }) }))
  expect(response.status).toBe(200)
  expect((await response.json()).count).toBe(1)
  expect(mocks.admin).not.toHaveBeenCalled()
})
