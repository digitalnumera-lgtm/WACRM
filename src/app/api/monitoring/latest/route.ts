import { MonitoringInputError, monitoringError, privateJson } from '@/lib/monitoring/http'
import { requireMonitoring, scopeChannels } from '@/lib/monitoring/team-access'

/** Activity since `since`: new customer messages (for sound and notifications) and whether anything changed. */
export async function GET(request: Request) {
  try {
    const access = await requireMonitoring('view_inbox')
    // Taken before the query, so nothing that arrives meanwhile is skipped.
    const now = new Date().toISOString()
    const since = new URL(request.url).searchParams.get('since')
    if (!since) return privateJson({ threads: [], now })
    if (!Number.isFinite(Date.parse(since))) throw new MonitoringInputError('Invalid time')
    const result = await scopeChannels(access, access.db.from('monitoring_threads')
      .select('id,channel_id,customer,customer_name,last_message_at,last_preview,last_direction')
      .eq('account_id', access.accountId).gt('last_message_at', new Date(since).toISOString()))
      .order('last_message_at', { ascending: false }).limit(20)
    if (result.error) throw result.error
    const rows = result.data ?? []
    // threads: new customer messages (sound/alerts); changed: any activity, including agent replies.
    return privateJson({ threads: rows.filter(t => t.last_direction === 'inbound').slice(0, 10), changed: rows.length > 0, now })
  } catch (error) { return monitoringError(error) }
}
