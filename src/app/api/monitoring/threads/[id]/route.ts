import { requireRole } from '@/lib/auth/account'
import { checkedId, monitoringError, pageNumber, privateJson, readJson, requiredText, threadColumns } from '@/lib/monitoring/http'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    const params = new URL(request.url).searchParams
    const page = pageNumber(params.get('page'))
    const auditPage = pageNumber(params.get('auditPage'))
    const thread = await supabase.from('monitoring_threads').select(threadColumns).eq('account_id', accountId).eq('id', id).maybeSingle()
    if (thread.error) throw thread.error
    if (!thread.data) return privateJson({ error: 'Conversation not found.' }, 404)
    const [messages, audit] = await Promise.all([
      supabase.from('monitoring_messages').select('id,direction,sent_at,kind,content,media_id', { count: 'exact' }).eq('account_id', accountId).eq('thread_id', id).order('sent_at', { ascending: false }).order('id').range(page * 50, page * 50 + 49),
      supabase.from('monitoring_lead_audit').select('id,changed_by,previous_status,new_status,changed_at', { count: 'exact' }).eq('account_id', accountId).eq('thread_id', id).order('changed_at', { ascending: false }).order('id').range(auditPage * 25, auditPage * 25 + 24),
    ])
    if (messages.error || audit.error) throw messages.error ?? audit.error
    return privateJson({ thread: thread.data, messages: messages.data, messageTotal: messages.count, audit: audit.data, auditTotal: audit.count, page, auditPage })
  } catch (error) { return monitoringError(error) }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    const body = await readJson(request)
    const status = requiredText(body, 'lead_status', 40)
    const thread = await supabase.from('monitoring_threads').select('id').eq('account_id', accountId).eq('id', id).maybeSingle()
    if (thread.error) throw thread.error
    if (!thread.data) return privateJson({ error: 'Conversation not found.' }, 404)
    // Existing database function updates the status and audit in one transaction.
    const result = await supabase.rpc('set_monitoring_lead_status', { p_thread: id, p_status: status })
    if (result.error) {
      if (result.error.code === '22023' || result.error.code === '23514') return privateJson({ error: 'Unsupported lead status.' }, 400)
      throw result.error
    }
    return privateJson({ success: true })
  } catch (error) { return monitoringError(error) }
}
