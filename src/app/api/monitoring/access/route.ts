import { canSeeChannel, requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, MonitoringInputError, monitoringError, privateJson, readJson, requiredText } from '@/lib/monitoring/http'
import { verifyRenewedAccess } from '@/lib/monitoring/renew-access'
import { MediaFailure, mediaFailure } from '@/lib/monitoring/media-errors'
import { encrypt } from '@/lib/whatsapp/encryption'

export async function POST(request: Request) {
  try {
    const access = await requireMonitoring('manage_numbers')
    const { db: supabase, accountId } = access
    const body = await readJson(request, 32768)
    const token = requiredText(body, 'access_token', 8192)
    if (!Array.isArray(body.channel_ids) || !body.channel_ids.length || body.channel_ids.length > 100 || body.channel_ids.some(id => typeof id !== 'string')) throw new MonitoringInputError('Select the business numbers to renew.')
    const ids = [...new Set((body.channel_ids as string[]).map(checkedId))]
    const channels = await supabase.from('monitoring_channels').select('id,phone_number_id,waba_id').eq('account_id', accountId).in('id', ids)
    if (channels.error) throw channels.error
    if (channels.data.length !== ids.length || !ids.every(id => canSeeChannel(access, id, { includeHidden: true }))) return privateJson({ error: 'One or more business numbers are unavailable.' }, 404)
    try { await verifyRenewedAccess(channels.data, token) }
    catch (error) {
      const failure = mediaFailure(error)
      if (failure.code === 'meta_access_invalid') return privateJson({ error: 'Meta rejected this new token. Generate a fresh token for your waCRM app and try again. No saved access was changed.', code: failure.code }, 400)
      if (error instanceof MediaFailure && ['meta_access_denied', 'media_unavailable'].includes(error.code)) return privateJson({ error: 'This token could not verify access to every selected WhatsApp account and number. Check its permissions and assigned assets. No saved access was changed.', code: 'meta_access_denied' }, 400)
      return privateJson({ error: 'Meta access could not be verified right now. Retry shortly. No saved access was changed.', code: failure.code }, 503)
    }
    // One statement updates all verified credentials or none. No channel row,
    // active flag, provider registration, message or history record is changed.
    const result = await monitoringAdmin().from('monitoring_credentials').upsert(channels.data.map(channel => ({ channel_id: channel.id, encrypted_token: encrypt(token) })), { onConflict: 'channel_id' })
    if (result.error) throw result.error
    return privateJson({ updated: channels.data.length })
  } catch (error) { return monitoringError(error) }
}
