import { after } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson } from '@/lib/monitoring/http'
import { fetchMonitoringMedia, mediaResponse } from '@/lib/monitoring/media'
import { decrypt } from '@/lib/whatsapp/encryption'
import { MediaFailure, mediaFailure } from '@/lib/monitoring/media-errors'
import { archiveMedia, readArchivedMedia, signedArchiveUrl } from '@/lib/monitoring/media-archive'

export const runtime = 'nodejs'

// A message's media never changes, so a successful response can be cached
// privately by the manager's browser: replaying audio or reopening a chat
// does not download the file again.
const SIGNED_URL_SECONDS = 3600

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    // Company scoping: the message row must belong to the caller's account.
    // Its channel is guaranteed to be the same account by foreign keys.
    const message = await supabase.from('monitoring_messages').select('channel_id,media_id').eq('account_id', accountId).eq('id', id).maybeSingle()
    if (message.error) throw message.error
    if (!message.data?.media_id) return privateJson({ error: 'Media not found.' }, 404)
    const db = monitoringAdmin()
    const diagnose = new URL(request.url).searchParams.get('diagnose') === '1'
    // Look up a permanent copy and the Meta credential at the same time.
    const [signed, credentials] = await Promise.all([
      signedArchiveUrl(db, accountId, id, SIGNED_URL_SECONDS),
      db.from('monitoring_credentials').select('encrypted_token').eq('channel_id', message.data.channel_id).maybeSingle(),
    ])
    if (signed) {
      if (diagnose) return privateJson({ available: true, archived: true })
      // The browser loads the stored copy directly (with native range
      // support for audio/video) through a short-lived signed URL.
      return new Response(null, { status: 302, headers: { Location: signed, 'Cache-Control': `private, max-age=${SIGNED_URL_SECONDS - 300}`, 'Referrer-Policy': 'no-referrer' } })
    }
    try {
      if (credentials.error || !credentials.data) {
        // No Meta access: a stored copy may still be readable directly.
        const archived = await readArchivedMedia(db, accountId, id)
        if (archived) return diagnose ? privateJson({ available: true, type: archived.type, archived: true }) : mediaResponse(archived.bytes, archived.type, request.headers.get('range'))
        throw new MediaFailure('credential_unavailable')
      }
      let token: string
      try { token = decrypt(credentials.data.encrypted_token) } catch { throw new MediaFailure('credential_unavailable') }
      const { bytes, type } = await fetchMonitoringMedia(message.data.media_id, token)
      // Keep a permanent copy without delaying this response.
      try { after(() => archiveMedia(db, accountId, id, bytes, type)) } catch { void archiveMedia(db, accountId, id, bytes, type) }
      // Native media elements hide error bodies. This authenticated check lets
      // the UI distinguish an access failure from a browser decoding failure.
      if (diagnose) return privateJson({ available: true, type })
      return mediaResponse(bytes, type, request.headers.get('range'), true)
    } catch (error) {
      const failure = mediaFailure(error)
      return privateJson({ error: failure.message, code: failure.code }, failure.status)
    }
  } catch (error) { return monitoringError(error) }
}
