import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { deriveWorkflow, writeWorkflow } from '@/lib/monitoring/workflow'

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    const body = await readJson(request)
    const thread = await supabase.from('monitoring_threads').select('id,channel_id,message_count').eq('account_id', accountId).eq('id', id).maybeSingle()
    if (thread.error) throw thread.error
    if (!thread.data) return privateJson({ error: 'Conversation not found.' }, 404)
    const db = monitoringAdmin()
    // writeWorkflow returns the saved row, so no second read is needed.
    const meta = await writeWorkflow(db, accountId, userId, thread.data, body)
    return privateJson({ workflow: deriveWorkflow(thread.data.message_count, meta) })
  } catch (error) { return monitoringError(error) }
}
