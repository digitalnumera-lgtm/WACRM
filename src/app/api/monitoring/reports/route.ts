import { requireRole } from '@/lib/auth/account'
import { checkedId, MonitoringInputError, monitoringError, privateJson } from '@/lib/monitoring/http'
import { activityReport, type ActivityRow } from '@/lib/monitoring/activity-report'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const params = new URL(request.url).searchParams
    const days = Number(params.get('days') ?? 30)
    if (![7, 30, 90].includes(days)) throw new MonitoringInputError('Choose 7, 30 or 90 days')
    const channel = params.get('channel') ? checkedId(params.get('channel')!) : null
    const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1)
    const start = new Date(end.getTime() - days * 86400000).toISOString()
    const rows: ActivityRow[] = []
    let total = 0
    // Bound memory and requests. A large report is explicitly labelled partial.
    for (let offset = 0; offset < 10000; offset += 1000) {
      let query = supabase.from('monitoring_messages').select('channel_id,direction,sent_at,kind', { count: 'exact' }).eq('account_id', accountId).gte('sent_at', start).lt('sent_at', end.toISOString())
      if (channel) query = query.eq('channel_id', channel)
      const result = await query.order('sent_at', { ascending: false }).order('id').range(offset, offset + 999)
      if (result.error) throw result.error
      total = result.count ?? 0
      rows.push(...(result.data ?? []))
      if ((result.data?.length ?? 0) < 1000 || rows.length >= total) break
    }
    return privateJson({ ...activityReport(rows, start, days), total, included: rows.length, truncated: total > rows.length, from: start, until: end.toISOString(), timezone: 'UTC' })
  } catch (error) { return monitoringError(error) }
}
