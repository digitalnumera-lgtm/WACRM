import { MonitoringInputError, monitoringError, privateJson } from '@/lib/monitoring/http'
import { requireMonitoring, scopeChannels } from '@/lib/monitoring/team-access'

/** Conversations with a new customer message since `since` (for sound and notifications). */
export async function GET(request: Request) {
  try {
    const access = await requireMonitoring('view_inbox')
    // Taken before the query, so nothing that arrives meanwhile is skipped.
    const now = new Date().toISOString()
    const since = new URL(request.url).searchParams.get('since')
    if (!since) return privateJson({ threads: [], now })
    if (!Number.isFinite(Date.parse(since))) throw new MonitoringInputError('Invalid time')
    const result = await scopeChannels(access, access.db.from('monitoring_threads')
      .select('id,channel_id,customer,customer_name,last_message_at,last_preview')
      .eq('account_id', access.accountId).eq('last_direction', 'inbound').gt('last_message_at', new Date(since).toISOString()))
      .order('last_message_at', { ascending: false }).limit(10)
    if (result.error) throw result.error
    return privateJson({ threads: result.data ?? [], now })
  } catch (error) { return monitoringError(error) }
}
