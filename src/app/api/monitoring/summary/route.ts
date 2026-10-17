import { requireRole } from '@/lib/auth/account'
import { monitoringError, privateJson } from '@/lib/monitoring/http'
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const [threads, incoming, outgoing, channels] = await Promise.all([
      supabase.from('monitoring_threads').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('monitoring_messages').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('direction', 'inbound'),
      supabase.from('monitoring_messages').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('direction', 'outbound'),
      supabase.from('monitoring_channels').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    ])
    if ([threads, incoming, outgoing, channels].some(r => r.error)) throw new Error('Counts unavailable')
    return privateJson({ conversations: threads.count, inbound: incoming.count, outbound: outgoing.count, numbers: channels.count })
  } catch (error) { return monitoringError(error) }
}
