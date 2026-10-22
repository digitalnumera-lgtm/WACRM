import { canSeeChannel, requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson } from '@/lib/monitoring/http'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireMonitoring('manage_numbers')
    const { accountId } = access
    const id = checkedId((await context.params).id)
    const result = await monitoringAdmin().from('monitoring_events')
      .select('id,channel_id,field,payload,needs_review,received_at')
      .eq('account_id', accountId).eq('id', id).maybeSingle()
    if (result.error) throw result.error
    if (!result.data || !canSeeChannel(access, result.data.channel_id)) return privateJson({ error: 'Event not found.' }, 404)
    return privateJson({ event: result.data })
  } catch (error) { return monitoringError(error) }
}
