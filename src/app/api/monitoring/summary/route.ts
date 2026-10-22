import { requireMonitoring, scopeChannels } from '@/lib/monitoring/team-access'
import { monitoringError, privateJson } from '@/lib/monitoring/http'
export async function GET() {
  try {
    const access = await requireMonitoring('view_reports')
    const { db: supabase, accountId } = access
    const [threads, incoming, outgoing, channels] = await Promise.all([
      scopeChannels(access, supabase.from('monitoring_threads').select('id', { count: 'exact', head: true }).eq('account_id', accountId)),
      scopeChannels(access, supabase.from('monitoring_messages').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('direction', 'inbound')),
      scopeChannels(access, supabase.from('monitoring_messages').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('direction', 'outbound')),
      scopeChannels(access, supabase.from('monitoring_channels').select('id', { count: 'exact', head: true }).eq('account_id', accountId), 'id'),
    ])
    if ([threads, incoming, outgoing, channels].some(r => r.error)) throw new Error('Counts unavailable')
    return privateJson({ conversations: threads.count, inbound: incoming.count, outbound: outgoing.count, numbers: channels.count })
  } catch (error) { return monitoringError(error) }
}
