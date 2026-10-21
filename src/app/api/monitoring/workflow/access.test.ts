import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { GET as workflows } from './route'
import { PATCH as changeWorkflow } from '../threads/[id]/workflow/route'
import { GET as notes, POST as addNote } from '../threads/[id]/notes/route'
import { GET as replies, POST as addReply, PATCH as changeReply } from '../quick-replies/route'

const id = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id }) }
const body = { action: 'status', status: 'resolved', observed_count: 1, title: 'Welcome', body: 'Hello', request_id: id, id, version: id }
function request(origin = 'https://crm.test') {
  return new Request(`https://crm.test/api/monitoring/workflow?ids=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify(body) })
}
afterEach(() => vi.clearAllMocks())
it('blocks anonymous and non-management callers before any private ledger access', async () => {
  for (const error of [new UnauthorizedError(), new ForbiddenError()]) {
    mocks.role.mockRejectedValue(error)
    for (const handler of [workflows, notes, addNote, changeWorkflow, replies, addReply, changeReply]) {
      expect((await handler(request(), context)).status).toBe(error.status)
    }
  }
  expect(mocks.admin).not.toHaveBeenCalled()
  expect(mocks.role).toHaveBeenCalledWith('admin')
})
it('rejects cross-origin mutations before any database writes', async () => {
  mocks.role.mockResolvedValue({ accountId: 'company', userId: 'manager' })
  for (const handler of [addNote, changeWorkflow, addReply, changeReply]) {
    expect((await handler(request('https://other.test'), context)).status).toBe(403)
  }
  expect(mocks.admin).not.toHaveBeenCalled()
})
it('checks thread ownership before notes or workflow service writes', async () => {
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
  const supabase = { from: vi.fn().mockReturnValue(chain) }
  mocks.role.mockResolvedValue({ accountId: 'own-company', userId: 'manager', supabase })
  for (const handler of [notes, addNote, changeWorkflow]) expect((await handler(request(), context)).status).toBe(404)
  expect(chain.eq).toHaveBeenCalledWith('account_id', 'own-company')
  expect(chain.eq).toHaveBeenCalledWith('id', id)
  expect(mocks.admin).not.toHaveBeenCalled()
})
it('rejects oversized metadata batches and malformed IDs before querying', async () => {
  mocks.role.mockResolvedValue({ accountId: 'company' })
  expect((await workflows(new Request('https://crm.test/api/monitoring/workflow?ids=invalid'))).status).toBe(400)
  expect((await workflows(new Request('https://crm.test/api/monitoring/workflow'))).status).toBe(400)
  expect(mocks.admin).not.toHaveBeenCalled()
})
