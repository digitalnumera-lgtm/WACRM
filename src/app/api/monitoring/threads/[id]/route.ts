import { readCursor, cursorFilter, makeCursor } from '@/lib/monitoring/scroll'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { messageText } from '@/lib/monitoring/rich-message'
import { after as afterResponse } from 'next/server'
import { canSeeChannel, requireMonitoring } from '@/lib/monitoring/team-access'
import { touchThread } from '@/lib/monitoring/storage'
import { checkedId, monitoringError, pageNumber, privateJson, readJson, requiredText, threadColumns } from '@/lib/monitoring/http'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const access = await requireMonitoring('view_inbox')
    const { db: supabase, accountId } = access
    const id = checkedId((await context.params).id)
    const params = new URL(request.url).searchParams
    const page = pageNumber(params.get('page'))
    const auditPage = pageNumber(params.get('auditPage'))
    const scroll = params.get('scroll') === '1'
    const before = readCursor(params.get('before'))
    const after = readCursor(params.get('after'))
    const auditOnly = params.get('auditOnly') === '1'
    let query = supabase.from('monitoring_messages').select('id,meta_id,direction,sent_at,kind,content,media_id', { count: scroll ? undefined : 'exact' }).eq('account_id', accountId).eq('thread_id', id)
    if (before) query = query.or(cursorFilter('sent_at', before))
    if (after) query = query.or(cursorFilter('sent_at', after, true))
    const [thread, messages, audit] = await Promise.all([
      supabase.from('monitoring_threads').select(threadColumns).eq('account_id', accountId).eq('id', id).maybeSingle(),
      auditOnly ? Promise.resolve({ data: [], count: null, error: null }) : scroll
        ? query.order('sent_at', { ascending: !!after }).order('id', { ascending: !!after }).limit(51)
        : query.order('sent_at', { ascending: false }).order('id').range(page * 50, page * 50 + 49),
      !scroll || auditOnly ? supabase.from('monitoring_lead_audit').select('id,changed_by,previous_status,new_status,changed_at', { count: 'exact' }).eq('account_id', accountId).eq('thread_id', id).order('changed_at', { ascending: false }).order('id').range(auditPage * 25, auditPage * 25 + 24)
        : Promise.resolve({ data: [], count: 0, error: null }),
    ])
    if (thread.error || messages.error || audit.error) throw thread.error ?? messages.error ?? audit.error
    if (!thread.data || !canSeeChannel(access, thread.data.channel_id)) return privateJson({ error: 'Conversation not found.' }, 404)
    // The first load after a chat is opened (not hover prefetch, paging or
    // polling) keeps its saved media from cleanup. Recorded after the response.
    if (params.get('opened') === '1') {
      try { afterResponse(() => touchThread(accountId, id)) } catch { void touchThread(accountId, id) }
    }
    const rows = scroll ? (messages.data ?? []).slice(0, 50) : messages.data ?? []
    // Most rich text is already normalized on ingestion. Retrieve missing detail
    // in bounded batches rather than issuing up to 50 ledger queries per chat.
    const needsSource = rows.filter(m => m.meta_id && (m.kind === 'reaction' || (!m.content && ['revoke', 'location', 'contacts', 'interactive', 'button', 'unsupported'].includes(m.kind))))
    const sources = new Map<string, Record<string, unknown>>()
    await Promise.all(Array.from({ length: Math.ceil(needsSource.length / 10) }, async (_, index) => {
      const chunk = needsSource.slice(index * 10, index * 10 + 10)
      const predicates = chunk.map(m => {
        const key = m.direction === 'outbound' ? 'message_echoes' : 'messages'
        return `payload.cs.${JSON.stringify(JSON.stringify({ value: { [key]: [{ id: m.meta_id }] } }))}`
      }).join(',')
      const source = await monitoringAdmin().from('monitoring_events').select('payload')
        .eq('account_id', accountId).eq('channel_id', thread.data!.channel_id).or(predicates).limit(100)
      for (const event of source.data ?? []) {
        for (const key of ['messages', 'message_echoes']) {
          for (const item of event.payload?.value?.[key] ?? []) if (typeof item.id === 'string') sources.set(item.id, item)
        }
      }
    }))
    const enriched = rows.map(message => {
      const raw = sources.get(message.meta_id)
      const reaction = raw?.reaction as { emoji?: string; message_id?: string } | undefined
      return raw ? { ...message, content: messageText(raw) ?? message.content,
        reaction: message.kind === 'reaction' ? { emoji: reaction?.emoji ?? '', target: reaction?.message_id ?? null } : undefined } : message
    })
    return privateJson({ thread: thread.data, messages: enriched, messageTotal: scroll ? thread.data.message_count : messages.count, audit: audit.data, auditTotal: audit.count, page, auditPage,
      nextCursor: scroll && (messages.data?.length ?? 0) > 50 ? makeCursor(rows[rows.length - 1]) : null })
  } catch (error) { return monitoringError(error) }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const access = await requireMonitoring('edit_lead_stage')
    const { db: supabase, accountId, userId } = access
    const id = checkedId((await context.params).id)
    const body = await readJson(request)
    const status = requiredText(body, 'lead_status', 40)
    const thread = await supabase.from('monitoring_threads').select('id,channel_id').eq('account_id', accountId).eq('id', id).maybeSingle()
    if (thread.error) throw thread.error
    if (!thread.data || !canSeeChannel(access, thread.data.channel_id)) return privateJson({ error: 'Conversation not found.' }, 404)
    // Database functions update the status and audit in one transaction: the
    // admin one checks the session; the member one runs after the check above.
    const result = access.full
      ? await supabase.rpc('set_monitoring_lead_status', { p_thread: id, p_status: status })
      : await supabase.rpc('monitoring_set_lead_status_as', { p_account: accountId, p_thread: id, p_status: status, p_actor: userId })
    if (result.error) {
      if (result.error.code === '22023' || result.error.code === '23514') return privateJson({ error: 'Unsupported lead status.' }, 400)
      throw result.error
    }
    return privateJson({ success: true })
  } catch (error) { return monitoringError(error) }
}
