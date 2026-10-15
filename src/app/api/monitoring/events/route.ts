import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, pageNumber, privateJson } from '@/lib/monitoring/http'

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const params = new URL(request.url).searchParams
    const page = pageNumber(params.get('page'))
    // The event ledger is server-only in the existing schema. Keep both the
    // manager check and explicit company scope when reading it for the UI.
    let query = monitoringAdmin().from('monitoring_events').select('id,channel_id,field,needs_review,received_at', { count: 'exact' }).eq('account_id', accountId).eq('needs_review', true)
    if (params.get('channel')) query = query.eq('channel_id', checkedId(params.get('channel')!))
    const result = await query.order('received_at', { ascending: false }).order('id').range(page * 25, page * 25 + 24)
    if (result.error) throw result.error
    return privateJson({ events: result.data, total: result.count, page })
  } catch (error) { return monitoringError(error) }
}
