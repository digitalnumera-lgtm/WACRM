import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ claims: vi.fn(), listFactors: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getClaims: mocks.claims } }) }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: () => ({ auth: { admin: { mfa: { listFactors: mocks.listFactors }, updateUserById: mocks.update } } }) }))
import { POST } from './route'
afterEach(() => vi.clearAllMocks())
const post = (origin = 'https://crm.test') => new Request('https://crm.test/api/monitoring/security', { method: 'POST', headers: { origin, host: 'crm.test' } })

it('records the flag from Supabase’s own factor list, even mid sign-in', async () => {
  mocks.claims.mockResolvedValue({ data: { claims: { sub: 'user-1', aal: 'aal1', app_metadata: { mfa_enabled: true } } }, error: null })
  mocks.listFactors.mockResolvedValue({ data: { factors: [{ id: 'f', status: 'verified' }] }, error: null })
  mocks.update.mockResolvedValue({ data: {}, error: null })
  const response = await POST(post())
  expect(await response.json()).toEqual({ enabled: true })
  expect(mocks.update).toHaveBeenCalledWith('user-1', { app_metadata: { mfa_enabled: true } })
})

it('turns the flag off when no verified factor is left', async () => {
  mocks.claims.mockResolvedValue({ data: { claims: { sub: 'user-1', aal: 'aal2' } }, error: null })
  mocks.listFactors.mockResolvedValue({ data: { factors: [{ id: 'f', status: 'unverified' }] }, error: null })
  mocks.update.mockResolvedValue({ data: {}, error: null })
  expect(await (await POST(post())).json()).toEqual({ enabled: false })
})

it('rejects anonymous and cross-site calls', async () => {
  mocks.claims.mockResolvedValue({ data: null, error: new Error('no session') })
  expect((await POST(post())).status).toBe(401)
  expect((await POST(post('https://evil.example'))).status).toBe(403)
  expect(mocks.update).not.toHaveBeenCalled()
})
