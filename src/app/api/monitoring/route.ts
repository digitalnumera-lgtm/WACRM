import { cursorFilter, makeCursor } from '@/lib/monitoring/scroll'
import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { channelColumns, monitoringError, pageNumber, privateJson, threadColumns } from '@/lib/monitoring/http'
import { applyInboxCursor, applyInboxFilters, applyInboxTab, inboxColumns, missingWorkflowSchema, pageSize, readInboxFilters, searchLiteral } from '@/lib/monitoring/inbox'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const params = new URL(request.url).searchParams
    const page = pageNumber(params.get('page'))
    const scroll = params.get('scroll') === '1'
    const filters = readInboxFilters(params)
    const channels = await supabase.from('monitoring_channels').select(channelColumns).eq('account_id', accountId).order('label').order('id')
    if (channels.error) throw channels.error
    // Channel and agent filters resolve only against this company's channels.
    let channelIds: string[] | null = null
    if (filters.channel) channelIds = (channels.data ?? []).filter(c => c.id === filters.channel).map(c => c.id)
    // The recovered schema stores the agent's display label on each channel.
    if (filters.agent) channelIds = (channels.data ?? []).filter(c => c.label === filters.agent && (!channelIds || channelIds.includes(c.id))).map(c => c.id)
    if (channelIds && channelIds.length === 0) return privateJson({ channels: channels.data, threads: [], total: 0, page, nextCursor: null, workflowReady: true })

    const ascending = filters.sort === 'oldest'
    // Service role is used only with an explicit company filter, after the
    // owner/admin check above; the view itself is not exposed to browsers.
    let query = monitoringAdmin().from('monitoring_inbox').select(inboxColumns, { count: filters.cursor ? undefined : 'exact' }).eq('account_id', accountId)
    query = applyInboxTab(applyInboxFilters(query, { ...filters, channelIds }), filters.tab)
    query = applyInboxCursor(query, filters)
    const ordered = query.order('last_message_at', { ascending }).order('id', { ascending })
    const result = await (scroll ? ordered.limit(pageSize + 1) : ordered.range(page * pageSize, page * pageSize + pageSize - 1))
    if (result.error && missingWorkflowSchema(result.error)) return legacyList(supabase, accountId, channels.data ?? [], channelIds, filters, page, scroll)
    if (result.error) throw result.error
    const rows = scroll ? result.data.slice(0, pageSize) : result.data
    return privateJson({ channels: channels.data, threads: rows, total: result.count, page, workflowReady: true,
      nextCursor: scroll && result.data.length > pageSize ? makeCursor(rows[rows.length - 1] as { id: string; last_message_at: string }) : null })
  } catch (error) { return monitoringError(error) }
}

// Used until supabase/numera/001_inbox_workflow.sql is installed: the original
// thread list without workflow tabs, labels or priority.
async function legacyList(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'], accountId: string, channels: unknown[],
  channelIds: string[] | null, filters: ReturnType<typeof readInboxFilters>, page: number, scroll: boolean,
) {
  let query = supabase.from('monitoring_threads').select(threadColumns, { count: filters.cursor ? undefined : 'exact' }).eq('account_id', accountId)
  if (channelIds) query = query.in('channel_id', channelIds)
  if (filters.status) query = query.eq('lead_status', filters.status)
  if (filters.search) {
    const literal = searchLiteral(filters.search)
    query = query.or(`customer.ilike."%${literal}%",customer_name.ilike."%${literal}%",last_preview.ilike."%${literal}%"`)
  }
  if (filters.cursor) query = query.or(cursorFilter('last_message_at', filters.cursor))
  const ordered = query.order('last_message_at', { ascending: false }).order('id', { ascending: false })
  const result = await (scroll ? ordered.limit(pageSize + 1) : ordered.range(page * pageSize, page * pageSize + pageSize - 1))
  if (result.error) throw result.error
  const rows = scroll ? result.data.slice(0, pageSize) : result.data
  return privateJson({ channels, threads: rows, total: result.count, page, workflowReady: false,
    nextCursor: scroll && result.data.length > pageSize ? makeCursor(rows[rows.length - 1]) : null })
}
