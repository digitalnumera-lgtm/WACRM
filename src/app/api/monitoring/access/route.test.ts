import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn(), verify: vi.fn(), encrypt: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
vi.mock('@/lib/monitoring/renew-access', () => ({ verifyRenewedAccess: mocks.verify }))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: mocks.encrypt }))
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { MediaFailure } from '@/lib/monitoring/media-errors'
import { POST } from './route'
const id = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const numbers = [{ id, phone_number_id: '111', waba_id: '10' }, { id: second, phone_number_id: '222', waba_id: '20' }]
const request = (ids = [id, second], origin = 'https://crm.test') => new Request('https://crm.test/api/monitoring/access', { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify({ channel_ids: ids, access_token: 'new-private-token', account_id: 'injected-company' }) })
afterEach(() => vi.resetAllMocks())
function setup(rows = numbers) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: rows }) }
  mocks.role.mockResolvedValue({ role: 'admin',  accountId: 'own-company', supabase: { from: () => query } })
  const upsert = vi.fn().mockResolvedValue({ error: null })
  mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValue({ upsert }) }); mocks.encrypt.mockReturnValue('encrypted-new-token')
  mocks.verify.mockResolvedValue(undefined)
  return { query, upsert }
}
it('denies non-management callers and cross-origin requests before token use', async () => {
  for (const error of [new UnauthorizedError(), new ForbiddenError()]) { mocks.role.mockRejectedValue(error); expect((await POST(request())).status).toBe(error.status) }
  setup(); expect((await POST(request([id], 'https://other.test'))).status).toBe(403)
  expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled()
})
it('requires every selected channel to belong to the authenticated company', async () => {
  const { query, upsert } = setup([numbers[0]])
  expect((await POST(request())).status).toBe(404)
  expect(query.eq).toHaveBeenCalledWith('account_id', 'own-company')
  expect(upsert).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled()
})
it('keeps all existing credentials intact when any number fails verification', async () => {
  const { upsert } = setup(); mocks.verify.mockRejectedValue(new MediaFailure('meta_access_invalid'))
  const response = await POST(request()); expect(response.status).toBe(400)
  expect((await response.json()).error).toContain('No saved access was changed')
  expect(upsert).not.toHaveBeenCalled(); expect(mocks.encrypt).not.toHaveBeenCalled()
})
it('encrypts and replaces only the verified credentials in one statement', async () => {
  const { upsert } = setup()
  const response = await POST(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ updated: 2 })
  expect(mocks.verify).toHaveBeenCalledWith(numbers, 'new-private-token')
  expect(upsert).toHaveBeenCalledOnce()
  expect(upsert).toHaveBeenCalledWith([{ channel_id: id, encrypted_token: 'encrypted-new-token' }, { channel_id: second, encrypted_token: 'encrypted-new-token' }], { onConflict: 'channel_id' })
})
