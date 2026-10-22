import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), read: vi.fn(), save: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
vi.mock('@/lib/monitoring/settings', () => ({ managementRepliesEnabled: mocks.read, saveManagementReplies: mocks.save }))
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { GET, PATCH } from './route'
const request = (body: unknown, origin = 'https://crm.test') => new Request('https://crm.test/api/monitoring/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify(body) })
afterEach(() => vi.resetAllMocks())
it('rejects anonymous and non-management reads and writes', async () => {
  for (const error of [new ForbiddenError(), new UnauthorizedError()]) {
    mocks.role.mockRejectedValue(error)
    expect((await GET()).status).toBe(error.status)
    expect((await PATCH(request({ management_replies_enabled: false }))).status).toBe(error.status)
  }
  expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled()
})
it('persists only a boolean for the authenticated company and actor', async () => {
  const db = {}; mocks.admin.mockReturnValue(db); mocks.role.mockResolvedValue({ role: 'admin',  accountId: 'own-company', userId: 'manager' }); mocks.save.mockResolvedValue(true)
  expect((await PATCH(request({ management_replies_enabled: false, account_id: 'foreign-company' }))).status).toBe(200)
  expect(mocks.save).toHaveBeenCalledWith(db, 'own-company', 'manager', false)
  mocks.save.mockClear()
  expect((await PATCH(request({ management_replies_enabled: 'false' }))).status).toBe(400)
  expect((await PATCH(request({ management_replies_enabled: false }, 'https://other.test'))).status).toBe(403)
  expect(mocks.save).not.toHaveBeenCalled()
})
it('does not report success when storage fails or there is no number to configure', async () => {
  mocks.role.mockResolvedValue({ role: 'admin',  accountId: 'company', userId: 'manager' })
  mocks.save.mockResolvedValue(false)
  expect((await PATCH(request({ management_replies_enabled: false }))).status).toBe(409)
  mocks.save.mockRejectedValue(new Error('private database error'))
  const result = await PATCH(request({ management_replies_enabled: false }))
  expect(result.status).toBe(503); expect(await result.text()).not.toContain('private database error')
})
