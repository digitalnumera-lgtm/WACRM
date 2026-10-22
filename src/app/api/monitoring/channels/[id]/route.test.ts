import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account'
import { PATCH } from './route'
const id = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id }) }
const request = (body: unknown, origin = 'https://crm.test') => new Request('https://crm.test/api/monitoring/channels/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify(body) })
afterEach(() => vi.resetAllMocks())
it('rejects unauthenticated users and non-management roles before service access', async () => {
  for (const error of [new UnauthorizedError(), new ForbiddenError()]) {
    mocks.role.mockRejectedValue(error)
    expect((await PATCH(request({ active: false }), context)).status).toBe(error instanceof UnauthorizedError ? 401 : 403)
  }
  expect(mocks.role).toHaveBeenCalledWith('viewer')
  expect(mocks.admin).not.toHaveBeenCalled()
})
it('rejects invalid values and cross-origin mutations', async () => {
  mocks.role.mockResolvedValue({ role: 'admin',  accountId: 'company' })
  expect((await PATCH(request({ active: 'false' }), context)).status).toBe(400)
  expect((await PATCH(request({ active: false }, 'https://other.test'), context)).status).toBe(403)
  expect(mocks.admin).not.toHaveBeenCalled()
})
it('removes and restores only the authenticated company channel without deleting history', async () => {
  mocks.role.mockResolvedValue({ role: 'admin',  accountId: 'own-company' })
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn() }
  const db = { from: vi.fn().mockReturnValue(query) }; mocks.admin.mockReturnValue(db)
  for (const active of [false, true]) {
    query.maybeSingle.mockResolvedValue({ data: { id, active }, error: null })
    expect((await PATCH(request({ active, account_id: 'other-company' }), context)).status).toBe(200)
    expect(query.update).toHaveBeenLastCalledWith({ active })
    expect(query.eq).toHaveBeenCalledWith('account_id', 'own-company')
    expect(query.eq).toHaveBeenCalledWith('id', id)
  }
  expect(db.from.mock.calls.every(([table]) => table === 'monitoring_channels')).toBe(true)
  query.maybeSingle.mockResolvedValue({ data: null, error: null })
  expect((await PATCH(request({ active: false }), context)).status).toBe(404)
})
