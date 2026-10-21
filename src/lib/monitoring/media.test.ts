import { afterEach, expect, it, vi } from 'vitest'
import { fetchMonitoringMedia, mediaResponse, trustedMediaUrl } from './media'
import { mediaFailure } from './media-errors'
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
it('distinguishes invalid Meta sessions from permissions, missing files and transient failures', async () => {
  for (const [status, code, expected] of [[401, 190, 'meta_access_invalid'], [400, 190, 'meta_access_invalid'], [403, 200, 'meta_access_denied'], [400, 100, 'media_unavailable'], [429, 4, 'media_rate_limited'], [503, 2, 'media_network']] as const) {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code, error_subcode: 467, message: 'private upstream detail' } }, { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchMonitoringMedia('123', 'private-token')).rejects.toMatchObject({ code: expected })
    expect(fetcher).toHaveBeenCalledTimes(1)
  }
  expect(mediaFailure(new DOMException('private URL', 'TimeoutError')).code).toBe('media_timeout')
  expect(mediaFailure(new Error('private token')).message).not.toContain('private token')
})
it('classifies CDN access failures without treating them as unsupported browser media', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ url: 'https://lookaside.fbsbx.com/media', mime_type: 'image/jpeg', file_size: 3 }))
    .mockResolvedValueOnce(Response.json({ error: { code: 190 } }, { status: 401 })))
  await expect(fetchMonitoringMedia('123', 'token')).rejects.toMatchObject({ code: 'meta_access_invalid', status: 424 })
})
