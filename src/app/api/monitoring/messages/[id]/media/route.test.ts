import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn(), fetch: vi.fn(), decrypt: vi.fn() }))
vi.mock('@/lib/auth/account', async original => ({ ...await original<typeof import('@/lib/auth/account')>(), requireRole: mocks.role }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
vi.mock('@/lib/monitoring/media', async original => ({ ...await original<typeof import('@/lib/monitoring/media')>(), fetchMonitoringMedia: mocks.fetch }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }))
import { MediaFailure } from '@/lib/monitoring/media-errors'
import { GET } from './route'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
const context = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }
afterEach(() => vi.resetAllMocks())
it('rejects anonymous users and unauthorized agents before accessing credentials', async () => {
  for (const [error, status] of [[new UnauthorizedError(), 401], [new ForbiddenError(), 403]] as const) {
    mocks.role.mockRejectedValueOnce(error)
    expect((await GET(new Request('https://crm.test/media'), context)).status).toBe(status)
  }
  expect(mocks.admin).not.toHaveBeenCalled()
})
function ownedMedia() {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValueOnce({ data: { channel_id: 'channel', media_id: '123' } }).mockResolvedValueOnce({ data: { id: 'channel' } }) }
  mocks.role.mockResolvedValue({ accountId: 'company', supabase: { from: () => query } })
  const credential = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { encrypted_token: 'ciphertext' } }) }
  mocks.admin.mockReturnValue({ from: () => credential }); mocks.decrypt.mockReturnValue('secret-token')
}
it('returns a safe, specific token-renewal error without exposing provider details', async () => {
  ownedMedia(); mocks.fetch.mockRejectedValue(new MediaFailure('meta_access_invalid'))
  const response = await GET(new Request('https://crm.test/media?diagnose=1'), context)
  expect(response.status).toBe(424)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const body = await response.json(); expect(body.code).toBe('meta_access_invalid'); expect(body.error).toContain('Renew Meta access')
  expect(JSON.stringify(body)).not.toMatch(/secret-token|ciphertext/)
})
it('diagnoses successful retrieval without sending media bytes or external URLs to the client', async () => {
  ownedMedia(); mocks.fetch.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), type: 'audio/ogg' })
  expect(await (await GET(new Request('https://crm.test/media?diagnose=1'), context)).json()).toEqual({ available: true, type: 'audio/ogg' })
})
it('distinguishes inaccessible stored credentials from expired media', async () => {
  ownedMedia(); mocks.decrypt.mockImplementation(() => { throw new Error('private encryption detail') })
  const response = await GET(new Request('https://crm.test/media'), context)
  expect(response.status).toBe(503); expect((await response.json()).code).toBe('credential_unavailable')
  expect(mocks.fetch).not.toHaveBeenCalled()
})
it('scopes the message lookup to the manager company and hides missing/foreign media', async () => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
  mocks.role.mockResolvedValue({ accountId: 'company', supabase: { from: () => query } })
  expect((await GET(new Request('https://crm.test/media'), context)).status).toBe(404)
  expect(query.eq).toHaveBeenCalledWith('account_id', 'company')
  expect(mocks.admin).not.toHaveBeenCalled()
})

it('sends the browser to the permanent stored copy without using Meta', async () => {
  ownedMedia()
  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/monitoring-media/company/x?token=t' }, error: null })
  const storageFrom = vi.fn(() => ({ createSignedUrl, download: vi.fn(), upload: vi.fn() }))
  const credential = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { encrypted_token: 'ciphertext' } }) }
  mocks.admin.mockReturnValue({ from: () => credential, storage: { from: storageFrom } })
  const response = await GET(new Request('https://crm.test/media'), context)
  expect(response.status).toBe(302)
  expect(response.headers.get('location')).toContain('/storage/v1/object/sign/')
  expect(response.headers.get('cache-control')).toMatch(/^private, max-age=/)
  expect(storageFrom).toHaveBeenCalledWith('monitoring-media'); expect(createSignedUrl).toHaveBeenCalledWith('company/11111111-1111-4111-8111-111111111111', 3600)
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled()
})
it('serves a stored copy itself when Meta access is unavailable', async () => {
  ownedMedia()
  const credential = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) }
  mocks.admin.mockReturnValue({ from: () => credential, storage: { from: () => ({ createSignedUrl: vi.fn().mockResolvedValue({ data: null, error: { message: 'signing failed' } }), download: vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array([7, 8, 9])], { type: 'image/jpeg' }), error: null }) }) } })
  const response = await GET(new Request('https://crm.test/media'), context)
  expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]))
})
it('archives media fetched from Meta for later viewing', async () => {
  ownedMedia()
  const upload = vi.fn().mockResolvedValue({ error: null })
  const credential = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { encrypted_token: 'ciphertext' } }) }
  mocks.admin.mockReturnValue({ from: () => credential, storage: { from: () => ({ createSignedUrl: vi.fn().mockResolvedValue({ data: null, error: { message: 'Object not found' } }), upload }) } })
  mocks.fetch.mockResolvedValue({ bytes: new Uint8Array([1, 2]), type: 'audio/ogg' })
  const response = await GET(new Request('https://crm.test/media'), context)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
  expect(upload).toHaveBeenCalledWith('company/11111111-1111-4111-8111-111111111111', new Uint8Array([1, 2]), expect.objectContaining({ contentType: 'audio/ogg', upsert: true }))
})
