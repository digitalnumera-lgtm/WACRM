import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson } from '@/lib/monitoring/http'
import { fetchMonitoringMedia, mediaResponse } from '@/lib/monitoring/media'
import { decrypt } from '@/lib/whatsapp/encryption'
import { MediaFailure, mediaFailure } from '@/lib/monitoring/media-errors'
import { archiveMedia, readArchivedMedia } from '@/lib/monitoring/media-archive'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    const message = await supabase.from('monitoring_messages').select('channel_id,media_id').eq('account_id', accountId).eq('id', id).maybeSingle()
    if (message.error) throw message.error
    if (!message.data?.media_id) return privateJson({ error: 'Media not found.' }, 404)
    const channel = await supabase.from('monitoring_channels').select('id').eq('account_id', accountId).eq('id', message.data.channel_id).maybeSingle()
    if (channel.error) throw channel.error
    if (!channel.data) return privateJson({ error: 'Media not found.' }, 404)
    const db = monitoringAdmin()
    const diagnose = new URL(request.url).searchParams.get('diagnose') === '1'
    // A permanent copy is served first; it survives Meta's media expiry.
    const archived = await readArchivedMedia(db, accountId, id)
    if (archived) return diagnose ? privateJson({ available: true, type: archived.type, archived: true }) : mediaResponse(archived.bytes, archived.type, request.headers.get('range'))
    const credentials = await db.from('monitoring_credentials').select('encrypted_token').eq('channel_id', channel.data.id).maybeSingle()
    try {
      if (credentials.error || !credentials.data) throw new MediaFailure('credential_unavailable')
      let token: string
      try { token = decrypt(credentials.data.encrypted_token) } catch { throw new MediaFailure('credential_unavailable') }
      const { bytes, type } = await fetchMonitoringMedia(message.data.media_id, token)
      await archiveMedia(db, accountId, id, bytes, type)
      // Native media elements hide error bodies. This authenticated check lets
      // the UI distinguish an access failure from a browser decoding failure.
      if (diagnose) return privateJson({ available: true, type })
      return mediaResponse(bytes, type, request.headers.get('range'))
    } catch (error) {
      const failure = mediaFailure(error)
      return privateJson({ error: failure.message, code: failure.code }, failure.status)
    }
  } catch (error) { return monitoringError(error) }
}
