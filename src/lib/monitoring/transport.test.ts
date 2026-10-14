import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendTextMessage, subscribeWabaToApp, registerPhoneNumber } from '@/lib/whatsapp/meta-api'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('monitoring transport guard', () => {
  it('blocks sends, registration and subscriptions before any network call', async () => {
    vi.stubEnv('NUMERA_MONITORING_ONLY', 'true')
    const network = vi.fn()
    vi.stubGlobal('fetch', network)
    await expect(sendTextMessage({ phoneNumberId: '123', accessToken: 'test', to: '456', text: 'blocked' })).rejects.toThrow('Disabled')
    await expect(registerPhoneNumber({ phoneNumberId: '123', accessToken: 'test', pin: '123456' })).rejects.toThrow('Disabled')
    await expect(subscribeWabaToApp({ wabaId: '123', accessToken: 'test' })).rejects.toThrow('Disabled')
    expect(network).not.toHaveBeenCalled()
  })
})
