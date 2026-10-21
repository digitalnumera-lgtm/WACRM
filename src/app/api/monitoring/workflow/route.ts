import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, MonitoringInputError, monitoringError, privateJson } from '@/lib/monitoring/http'
import { readWorkflows } from '@/lib/monitoring/workflow'

// Secondary, batched metadata request: message loading never waits for notes or
// workflow metadata. Only IDs readable in the caller's company are returned.
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const ids = [...new Set((new URL(request.url).searchParams.get('ids') ?? '').split(',').filter(Boolean))]
    if (!ids.length || ids.length > 100) throw new MonitoringInputError('Choose between 1 and 100 conversations.')
    ids.forEach(checkedId)
    const result = await supabase.from('monitoring_threads').select('id,channel_id,message_count').eq('account_id', accountId).in('id', ids)
    if (result.error) throw result.error
    return privateJson({ workflows: await readWorkflows(monitoringAdmin(), accountId, result.data) })
  } catch (error) { return monitoringError(error) }
}
