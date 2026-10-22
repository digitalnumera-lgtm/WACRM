import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), target: vi.fn(), send: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
vi.mock('@/lib/monitoring/management-reply', () => ({ managementReplyTarget: mocks.target, sendManagementReply: mocks.send, managementReplyWindow: vi.fn(), readReplyAttempt: vi.fn(), replyAttemptResult: vi.fn() }))
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account'
import { GET, POST } from './route'
afterEach(() => vi.clearAllMocks())
const context = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }
function request(origin?: string) { return new Request('https://crm.test/api/monitoring/threads/1/reply', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify({ request_id: '22222222-2222-4222-8222-222222222222', text: 'Hello' }) }) }
it('denies anonymous, viewer and agent access before any transport or service lookup', async () => {
  for (const error of [new UnauthorizedError(), new ForbiddenError()]) {
    mocks.role.mockRejectedValue(error)
    for (const handler of [GET, POST]) expect((await handler(request(), context)).status).toBe(error instanceof UnauthorizedError ? 401 : 403)
  }
  expect(mocks.role).toHaveBeenCalledWith('viewer')
  expect(mocks.target).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled()
})
it('never sends to a thread outside the authenticated company', async () => {
  mocks.role.mockResolvedValue({ role: 'admin',  supabase: {}, accountId: 'own-company', userId: 'manager' }); mocks.target.mockResolvedValue(null)
  expect((await POST(request(), context)).status).toBe(404)
  expect(mocks.target).toHaveBeenCalledWith({}, 'own-company', '11111111-1111-4111-8111-111111111111')
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled()
})
it('rejects cross-origin reply requests before target lookup', async () => {
  mocks.role.mockResolvedValue({ role: 'admin',  supabase: {}, accountId: 'own-company', userId: 'manager' })
  expect((await POST(request('https://unrelated.test'), context)).status).toBe(403)
  expect(mocks.target).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled()
})
