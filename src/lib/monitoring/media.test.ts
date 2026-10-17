import { afterEach, expect, it, vi } from 'vitest'
import { fetchMonitoringMedia, mediaResponse, trustedMediaUrl } from './media'
afterEach(() => vi.unstubAllGlobals())
it('rejects untrusted hosts, credentials and insecure URLs', () => {
  for (const url of ['http://lookaside.fbsbx.com/a', 'https://evil.test/a', 'https://lookaside.fbsbx.com.evil.test/a', 'https://user:pass@lookaside.fbsbx.com/a', 'https://localhost/a']) expect(() => trustedMediaUrl(url)).toThrow()
  expect(trustedMediaUrl('https://lookaside.fbsbx.com/a').hostname).toBe('lookaside.fbsbx.com')
})
it('supports browser seeking and rejects invalid ranges', async () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4])
  const response = mediaResponse(bytes, 'audio/ogg', 'bytes=1-3')
  expect(response.status).toBe(206)
  expect(response.headers.get('content-range')).toBe('bytes 1-3/5')
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])
  expect(mediaResponse(bytes, 'video/mp4', 'bytes=9-').status).toBe(416)
  expect(mediaResponse(bytes, 'video/mp4', 'bytes=-0').status).toBe(416)
  expect(mediaResponse(bytes, 'video/mp4', null).headers.get('cache-control')).toBe('private, no-store')
})
it('retrieves fresh Meta URLs with server-only bearer auth and no redirects', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ url: 'https://lookaside.fbsbx.com/media', mime_type: 'audio/ogg', file_size: 3 })).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
  vi.stubGlobal('fetch', fetcher)
  const media = await fetchMonitoringMedia('123', 'test-token')
  expect(media.type).toBe('audio/ogg')
  expect(media.bytes.length).toBe(3)
  expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer test-token' } })
})
it('does not fetch oversized or active-content media', async () => {
  for (const metadata of [{ mime_type: 'text/html', file_size: 3 }, { mime_type: 'video/mp4', file_size: 40 * 1024 * 1024 }]) {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...metadata, url: 'https://lookaside.fbsbx.com/media' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchMonitoringMedia('123', 'token')).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  }
})
