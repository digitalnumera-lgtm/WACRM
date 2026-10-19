import { afterEach, expect, it, vi } from 'vitest'
import { submitManagementText } from './management-transport'
afterEach(() => vi.unstubAllGlobals())
it('uses the fixed Meta endpoint and sends only the explicit text payload', async () => {
  const network = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: 'wamid.test' }] }))
  vi.stubGlobal('fetch', network)
  expect(await submitManagementText('123', 'secret', '15550100001', 'Hello')).toEqual({ state: 'accepted', meta_id: 'wamid.test' })
  const [url, options] = network.mock.calls[0]
  expect(url).toBe('https://graph.facebook.com/v26.0/123/messages')
  expect(options.redirect).toBe('error')
  expect(JSON.parse(options.body)).toMatchObject({ to: '15550100001', type: 'text', text: { body: 'Hello', preview_url: false } })
})
it('distinguishes explicit rejection from uncertain delivery without retrying', async () => {
  const network = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 190, message: 'sensitive' } }, { status: 401 })).mockResolvedValueOnce(Response.json({ error: { code: 2 } }, { status: 500 })).mockRejectedValueOnce(new Error('timeout'))
  vi.stubGlobal('fetch', network)
  expect(await submitManagementText('123', 'secret', '15550100001', 'Hello')).toEqual({ state: 'rejected', code: 190 })
  expect(await submitManagementText('123', 'secret', '15550100001', 'Hello')).toEqual({ state: 'uncertain' })
  expect(await submitManagementText('123', 'secret', '15550100001', 'Hello')).toEqual({ state: 'uncertain' })
  expect(network).toHaveBeenCalledTimes(3)
})
