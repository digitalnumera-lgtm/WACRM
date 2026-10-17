import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson } from '@/lib/monitoring/http'
import { fetchMonitoringMedia, mediaResponse } from '@/lib/monitoring/media'
import { decrypt } from '@/lib/whatsapp/encryption'

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
    const credentials = await monitoringAdmin().from('monitoring_credentials').select('encrypted_token').eq('channel_id', channel.data.id).maybeSingle()
    if (credentials.error || !credentials.data) throw new Error('Credentials unavailable')
    try {
      const { bytes, type } = await fetchMonitoringMedia(message.data.media_id, decrypt(credentials.data.encrypted_token))
      return mediaResponse(bytes, type, request.headers.get('range'))
    } catch {
      return privateJson({ error: 'Media unavailable. It may have expired, exceed 32 MB, or require renewed channel access.' }, 502)
    }
  } catch (error) { return monitoringError(error) }
}
