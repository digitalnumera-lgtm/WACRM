import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
import { GET } from './route'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
const context = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }
it('rejects anonymous users and unauthorized agents before accessing credentials', async () => {
  for (const [error, status] of [[new UnauthorizedError(), 401], [new ForbiddenError(), 403]] as const) {
    mocks.role.mockRejectedValueOnce(error)
    expect((await GET(new Request('https://crm.test/media'), context)).status).toBe(status)
  }
  expect(mocks.admin).not.toHaveBeenCalled()
})
it('scopes the message lookup to the manager company and hides missing/foreign media', async () => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
  mocks.role.mockResolvedValue({ accountId: 'company', supabase: { from: () => query } })
  expect((await GET(new Request('https://crm.test/media'), context)).status).toBe(404)
  expect(query.eq).toHaveBeenCalledWith('account_id', 'company')
  expect(mocks.admin).not.toHaveBeenCalled()
})
