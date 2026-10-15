import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), persist: vi.fn() }))
vi.mock('@/lib/monitoring/admin', () => ({ monitoringAdmin: mocks.admin }))
vi.mock('@/lib/monitoring/ingest', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/monitoring/ingest')>(), persistMonitoringBatches: mocks.persist }))
import { GET, POST } from './route'

beforeEach(() => { mocks.admin.mockReturnValue({}); mocks.persist.mockResolvedValue(undefined); vi.stubEnv('META_APP_SECRET', 'test-app-secret'); vi.stubEnv('META_MONITORING_VERIFY_TOKEN', 'test-verification-token') })
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs() })
function request(body: string, signature?: string) {
  return new Request('https://crm.test/api/monitoring/webhook', { method: 'POST', headers: signature ? { 'x-hub-signature-256': signature } : {}, body })
}
const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '123' }, messages: [{ id: 'm', from: 'customer', timestamp: '1700000000', type: 'text', text: { body: 'Hi' } }] } }] }] })
const sign = (body: string) => `sha256=${createHmac('sha256', 'test-app-secret').update(body).digest('hex')}`
describe('monitoring webhook', () => {
  it('returns the exact challenge only for the configured token', async () => {
    const good = await GET(new Request('https://crm.test/api/monitoring/webhook?hub.mode=subscribe&hub.verify_token=test-verification-token&hub.challenge=12345'))
    expect(good.status).toBe(200); expect(await good.text()).toBe('12345')
    const bad = await GET(new Request('https://crm.test/api/monitoring/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345'))
    expect(bad.status).toBe(403)
  })
  it('fails closed when secrets are missing', async () => {
    vi.stubEnv('META_MONITORING_VERIFY_TOKEN', '')
    expect((await GET(new Request('https://crm.test/api/monitoring/webhook'))).status).toBe(503)
    vi.stubEnv('META_APP_SECRET', '')
    expect((await POST(request(payload, sign(payload)))).status).toBe(503)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('rejects absent, invalid and tampered signatures before database access', async () => {
    for (const req of [request(payload), request(payload, 'sha256=bad'), request(payload + ' ', sign(payload))]) expect((await POST(req)).status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('acknowledges only after successful persistence', async () => {
    expect((await POST(request(payload, sign(payload)))).status).toBe(200)
    expect(mocks.persist).toHaveBeenCalledOnce()
    mocks.persist.mockRejectedValueOnce(new Error('database failure'))
    expect((await POST(request(payload, sign(payload)))).status).toBe(503)
  })
  it('rejects malformed signed payloads', async () => {
    for (const body of ['not-json', '{}']) expect((await POST(request(body, sign(body)))).status).toBe(400)
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('bounds request size', async () => {
    const body = 'x'.repeat(1024 * 1024 + 1)
    expect((await POST(request(body, sign(body)))).status).toBe(413)
    expect(mocks.persist).not.toHaveBeenCalled()
  })
})
