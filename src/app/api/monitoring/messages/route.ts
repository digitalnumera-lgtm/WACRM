import { requireMonitoring, scopeChannels } from '@/lib/monitoring/team-access'
import { monitoringError, privateJson } from '@/lib/monitoring/http'
import { mediaKinds, messageFilters } from '@/lib/monitoring/message-query'

export async function GET(request: Request) {
  try {
    const f = messageFilters(new URL(request.url).searchParams)
    // The Media library also needs permission to open media.
    const access = await requireMonitoring(f.mediaOnly ? 'view_media' : 'view_inbox')
    const { db: supabase, accountId } = access
    let query = scopeChannels(access, supabase.from('monitoring_messages').select('id,thread_id,channel_id,meta_id,direction,sent_at,kind,content,media_id', { count: 'exact' }).eq('account_id', accountId))
    if (f.channel) query = query.eq('channel_id', f.channel)
    if (f.thread) query = query.eq('thread_id', f.thread)
    if (f.direction) query = query.eq('direction', f.direction)
    if (f.kind) query = query.eq('kind', f.kind)
    if (f.kinds) query = query.in('kind', f.kinds)
    if (f.from) query = query.gte('sent_at', `${f.from}T00:00:00Z`)
    if (f.until) query = query.lt('sent_at', f.until)
    if (f.mediaOnly) query = query.in('kind', [...mediaKinds]).not('media_id', 'is', null)
    if (f.q) query = query.ilike('content', `%${f.q.replace(/\\/g, '\\\\').replace(/[%_*]/g, '\\$&')}%`)
    const result = await query.order('sent_at', { ascending: false }).order('id').range(f.page * 50, f.page * 50 + 49)
    if (result.error) throw result.error
    const threadIds = [...new Set((result.data ?? []).map(m => m.thread_id))]
    const threads = threadIds.length ? await supabase.from('monitoring_threads').select('id,customer,customer_name').eq('account_id', accountId).in('id', threadIds) : { data: [], error: null }
    if (threads.error) throw threads.error
    const byId = new Map((threads.data ?? []).map(t => [t.id, t]))
    return privateJson({ messages: (result.data ?? []).map(m => ({ ...m, customer: byId.get(m.thread_id)?.customer ?? '', customer_name: byId.get(m.thread_id)?.customer_name ?? null })), total: result.count ?? 0, page: f.page })
  } catch (error) { return monitoringError(error) }
}
