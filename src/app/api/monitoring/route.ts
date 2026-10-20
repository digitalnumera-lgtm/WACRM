import { readCursor, cursorFilter, makeCursor } from '@/lib/monitoring/scroll'
import { requireRole } from '@/lib/auth/account'
import { channelColumns, checkedId, MonitoringInputError, monitoringError, pageNumber, privateJson, threadColumns } from '@/lib/monitoring/http'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const params = new URL(request.url).searchParams
    const page = pageNumber(params.get('page'))
    const scroll = params.get('scroll') === '1'
    const cursor = readCursor(params.get('before'))
    const channelsPromise = Promise.resolve(supabase.from('monitoring_channels').select(channelColumns).eq('account_id', accountId).order('label').order('id'))
    let query = supabase.from('monitoring_threads').select(threadColumns, { count: cursor ? undefined : 'exact' }).eq('account_id', accountId)
    const channel = params.get('channel')
    const agent = params.get('agent')
    if (channel) query = query.eq('channel_id', checkedId(channel))
    // The recovered schema stores the agent's display label on each channel.
    if (agent) {
      const channels = await channelsPromise
      if (channels.error) throw channels.error
      const ids = (channels.data ?? []).filter(c => c.label === agent).map(c => c.id)
      if (ids.length === 0) return privateJson({ channels: channels.data, threads: [], total: 0, page, nextCursor: null })
      query = query.in('channel_id', ids)
    }
    const status = params.get('status')
    if (status) {
      if (!/^[a-z_]{1,40}$/.test(status)) throw new MonitoringInputError('Invalid lead status')
      query = query.eq('lead_status', status)
    }
    const search = params.get('q')?.trim()
    if (search) {
      if (search.length > 120) throw new MonitoringInputError('Search is too long')
      // Quote PostgREST operands and escape ILIKE wildcards; user input cannot
      // inject additional filters or accidentally broaden a company query.
      const literal = search.replace(/\\/g, '\\\\').replace(/[%_*]/g, '\\$&').replace(/"/g, '\\"')
      query = query.or(`customer.ilike."%${literal}%",customer_name.ilike."%${literal}%",last_preview.ilike."%${literal}%"`)
    }
    if (cursor) query = query.or(cursorFilter('last_message_at', cursor))
    const [channels, result] = await Promise.all([
      channelsPromise,
      scroll ? query.order('last_message_at', { ascending: false }).order('id', { ascending: false }).limit(31)
        : query.order('last_message_at', { ascending: false }).order('id').range(page * 30, page * 30 + 29),
    ])
    if (result.error || channels.error) throw result.error ?? channels.error
    const rows = scroll ? result.data.slice(0, 30) : result.data
    return privateJson({ channels: channels.data, threads: rows, total: result.count, page,
      nextCursor: scroll && result.data.length > 30 ? makeCursor(rows[rows.length - 1]) : null })
  } catch (error) { return monitoringError(error) }
}
