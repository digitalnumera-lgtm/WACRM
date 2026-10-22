import { createHash } from 'node:crypto'
import { canSeeChannel, requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { historyMessages } from '@/lib/monitoring/history-import'

export async function POST(request: Request) {
  try {
    const access = await requireMonitoring('manage_numbers')
    const { db: supabase, accountId } = access
    const body = await readJson(request, 2 * 1024 * 1024)
    const channelId = checkedId(String(body.channel_id ?? ''))
    const channel = await supabase.from('monitoring_channels').select('id').eq('account_id', accountId).eq('id', channelId).maybeSingle()
    if (channel.error) throw channel.error
    if (!channel.data || !canSeeChannel(access, channel.data.id)) return privateJson({ error: 'Number not found.' }, 404)
    let messages
    try { messages = historyMessages(body.messages) } catch (error) { return privateJson({ error: (error as Error).message }, 400) }
    if (body.preview === true) return privateJson({ count: messages.length, first: messages[0].timestamp, last: messages.at(-1)?.timestamp })
    const hash = createHash('sha256').update(JSON.stringify(['history-import-v1', channelId, messages])).digest('hex')
    const result = await monitoringAdmin().rpc('ingest_monitoring_event', { p_channel: channelId, p_hash: hash, p_field: 'manual_history_import', p_payload: { source: 'manager-upload', count: messages.length }, p_messages: messages, p_review: false })
    if (result.error) throw result.error
    return privateJson({ processed: messages.length, note: 'Duplicate message IDs are ignored.' })
  } catch (error) { return monitoringError(error) }
}
