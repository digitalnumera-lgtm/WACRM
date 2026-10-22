import { canSeeChannel, requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, MonitoringInputError, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { canRequestSync, readConnection, requestSync, SYNC_TYPES, writeConnection, type SyncType } from '@/lib/monitoring/connect'
import { decrypt } from '@/lib/whatsapp/encryption'

export const runtime = 'nodejs'

/** Retries a failed contacts/history sync request, only inside Meta's 24-hour window. */
export async function POST(request: Request) {
  try {
    const access = await requireMonitoring('manage_numbers')
    const { db: supabase, accountId } = access
    const body = await readJson(request)
    const channelId = checkedId(String(body.channel_id ?? ''))
    const type = String(body.sync_type) as SyncType
    if (!SYNC_TYPES.includes(type)) throw new MonitoringInputError('Choose contacts or history.')
    const channel = await supabase.from('monitoring_channels').select('id,phone_number_id').eq('account_id', accountId).eq('id', channelId).maybeSingle()
    if (channel.error) throw channel.error
    if (!channel.data || !canSeeChannel(access, channel.data.id)) return privateJson({ error: 'Number not found.' }, 404)
    const db = monitoringAdmin()
    const record = await readConnection(db, accountId, channelId)
    if (!record) return privateJson({ error: 'This number was not connected through Connect number, so Meta history sharing is not available for it.' }, 409)
    if (record.syncs[type]?.ok) return privateJson({ error: 'This sync was already requested successfully. Meta allows it only once.' }, 409)
    if (!canRequestSync(record, type)) return privateJson({ error: 'Meta’s 24-hour window has closed. Reconnect the number to share history again.' }, 409)
    const credential = await db.from('monitoring_credentials').select('encrypted_token').eq('channel_id', channelId).maybeSingle()
    if (credential.error || !credential.data) return privateJson({ error: 'No saved Meta access for this number.' }, 409)
    let token: string
    try { token = decrypt(credential.data.encrypted_token) } catch { return privateJson({ error: 'The saved Meta access could not be read. Renew it in Settings.' }, 409) }
    record.syncs[type] = await requestSync(channel.data.phone_number_id, token, type)
    await writeConnection(db, accountId, channelId, record)
    return privateJson({ syncs: record.syncs })
  } catch (error) { return monitoringError(error) }
}
