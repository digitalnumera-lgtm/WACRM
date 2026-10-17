const MAX_BYTES = 32 * 1024 * 1024
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'video/mp4', 'video/3gpp'])

export function trustedMediaUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    !(url.hostname === 'lookaside.fbsbx.com' || url.hostname === 'lookaside.facebook.com' || url.hostname.endsWith('.fbcdn.net'))) throw new Error('Invalid media host')
  return url
}

export async function fetchMonitoringMedia(mediaId: string, token: string) {
  if (!/^\d+$/.test(mediaId)) throw new Error('Invalid media ID')
  const options: RequestInit = { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(25000) }
  const metadata = await fetch(`https://graph.facebook.com/v26.0/${mediaId}`, options)
  if (!metadata.ok) throw new Error('Media metadata unavailable')
  const info = await metadata.json()
  const type = String(info.mime_type ?? '').split(';')[0].toLowerCase()
  if (!TYPES.has(type) || Number(info.file_size) > MAX_BYTES) throw new Error('Unsupported media')
  const upstream = await fetch(trustedMediaUrl(info.url), options)
  if (!upstream.ok || !upstream.body) throw new Error('Media unavailable')
  if (Number(upstream.headers.get('content-length')) > MAX_BYTES) { await upstream.body.cancel(); throw new Error('Media too large') }
  const reader = upstream.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Media too large') }
    chunks.push(value)
  }
  return { bytes: new Uint8Array(Buffer.concat(chunks)), type }
}

export function mediaResponse(bytes: Uint8Array<ArrayBuffer>, type: string, range: string | null) {
  const headers = new Headers({ 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Accept-Ranges': 'bytes', 'Cross-Origin-Resource-Policy': 'same-origin' })
  let start = 0, end = bytes.length - 1
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]))
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
    } else start = -1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
      headers.set('Content-Range', `bytes */${bytes.length}`)
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`)
  }
  const body = bytes.slice(start, end + 1)
  headers.set('Content-Length', String(body.length))
  return new Response(body, { status: range ? 206 : 200, headers })
}
