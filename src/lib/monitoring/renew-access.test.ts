import { afterEach, expect, it, vi } from 'vitest'
import { verifyRenewedAccess } from './renew-access'
afterEach(() => vi.unstubAllGlobals())
it('verifies every selected number under its own WABA without following supplied paging URLs', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: '111' }], paging: { next: 'https://evil.test/steal-token', cursors: { after: 'next-page' } } }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: '222' }] }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: '333' }] }))
  vi.stubGlobal('fetch', fetcher)
  await verifyRenewedAccess([{ waba_id: '10', phone_number_id: '111' }, { waba_id: '10', phone_number_id: '222' }, { waba_id: '20', phone_number_id: '333' }], 'secret-token')
  expect(fetcher).toHaveBeenCalledTimes(3)
  for (const [url, options] of fetcher.mock.calls) {
    expect(url.hostname).toBe('graph.facebook.com'); expect(url.href).not.toContain('secret-token')
    expect(options).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer secret-token' } })
    expect(options.method).toBeUndefined()
  }
  expect(fetcher.mock.calls[1][0].searchParams.get('after')).toBe('next-page')
})
it('rejects missing numbers, wrong accounts and invalid tokens', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'other' }] })))
  await expect(verifyRenewedAccess([{ waba_id: '10', phone_number_id: '111' }], 'token')).rejects.toMatchObject({ code: 'meta_access_denied' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 190 } }, { status: 401 })))
  await expect(verifyRenewedAccess([{ waba_id: '10', phone_number_id: '111' }], 'token')).rejects.toMatchObject({ code: 'meta_access_invalid' })
})
