import { requireMonitoring, scopeChannels } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, MonitoringInputError, monitoringError, privateJson } from '@/lib/monitoring/http'
import { canRequestSync, connectionEventId, historyProgress, SYNC_TYPES, type ConnectionRecord } from '@/lib/monitoring/connect'

export const runtime = 'nodejs'

/** Connection and history-sync progress for this company's numbers. */
export async function GET(request: Request) {
  try {
    const access = await requireMonitoring('manage_numbers')
    const { db: supabase, accountId } = access
    const ids = [...new Set((new URL(request.url).searchParams.get('ids') ?? '').split(',').filter(Boolean))]
    if (!ids.length || ids.length > 50) throw new MonitoringInputError('Choose between 1 and 50 numbers.')
    ids.forEach(checkedId)
    const channels = await scopeChannels(access, supabase.from('monitoring_channels').select('id').eq('account_id', accountId).in('id', ids), 'id', { includeHidden: true })
    if (channels.error) throw channels.error
    const owned = (channels.data ?? []).map(c => c.id as string)
    const db = monitoringAdmin()
    const status: Record<string, unknown> = {}
    for (const id of owned) {
      const [connection, rows] = await Promise.all([
        db.from('monitoring_events').select('payload').eq('account_id', accountId).eq('id', connectionEventId(accountId, id)).maybeSingle(),
        db.from('monitoring_events').select('field,payload,received_at').eq('account_id', accountId).eq('channel_id', id).in('field', ['history', 'smb_app_state_sync']).order('received_at', { ascending: false }).limit(2000),
      ])
      if (connection.error || rows.error) throw connection.error ?? rows.error
      const record = (connection.data?.payload as ConnectionRecord | undefined) ?? null
      status[id] = {
        connected: record ? { at: record.connected_at, display_number: record.display_number, token_source: record.token_source } : null,
        syncs: record?.syncs ?? {},
        retry: Object.fromEntries(SYNC_TYPES.map(type => [type, canRequestSync(record, type)])),
        progress: historyProgress(rows.data ?? []),
      }
    }
    return privateJson({ status })
  } catch (error) { return monitoringError(error) }
}
