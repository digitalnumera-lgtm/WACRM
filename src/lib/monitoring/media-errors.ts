export const mediaProblems = {
  meta_access_invalid: { status: 424, message: 'Meta rejected the saved access token. Renew Meta access in Settings, then retry this attachment.' },
  meta_access_denied: { status: 424, message: 'The saved Meta token does not have permission to access this attachment. Renew access for this business number in Settings.' },
  media_unavailable: { status: 410, message: 'Meta could not provide this attachment. It may no longer be available or accessible to this business number.' },
  media_too_large: { status: 413, message: 'This attachment exceeds the CRM preview limit of 32 MB.' },
  media_unsupported: { status: 415, message: 'This attachment format is not supported by the CRM.' },
  media_rate_limited: { status: 503, message: 'Meta is limiting media requests. Wait briefly, then retry.' },
  media_timeout: { status: 504, message: 'The media download timed out. Retry when the connection is stable.' },
  media_network: { status: 502, message: 'The CRM could not retrieve this attachment from Meta. Please retry.' },
  credential_unavailable: { status: 503, message: 'Saved access for this number could not be read. Renew Meta access in Settings or check the server configuration.' },
} as const
export type MediaProblemCode = keyof typeof mediaProblems
export class MediaFailure extends Error {
  code: MediaProblemCode
  status: number
  constructor(code: MediaProblemCode) {
    super(mediaProblems[code].message)
    this.code = code
    this.status = mediaProblems[code].status
  }
}
export function mediaFailure(error: unknown): MediaFailure {
  if (error instanceof MediaFailure) return error
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return new MediaFailure('media_timeout')
  return new MediaFailure('media_network')
}
export async function metaResponseFailure(response: Response) {
  // Never expose Meta's raw message: it may contain account or credential data.
  const body = await response.json().catch(() => null)
  const code = Number(body?.error?.code)
  if (response.status === 401 || code === 190) return new MediaFailure('meta_access_invalid')
  if (response.status === 403 || [10, 200].includes(code)) return new MediaFailure('meta_access_denied')
  if (response.status === 429 || [4, 17, 32, 613].includes(code)) return new MediaFailure('media_rate_limited')
  if (response.status === 404 || [100, 131052].includes(code)) return new MediaFailure('media_unavailable')
  return new MediaFailure('media_network')
}
