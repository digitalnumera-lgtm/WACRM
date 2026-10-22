import { canSeeChannel, requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { labelIds, setThreadLabels } from '@/lib/monitoring/labels'

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireMonitoring('apply_labels')
    const { db: supabase, accountId, userId } = access
    const id = checkedId((await context.params).id)
    const ids = labelIds((await readJson(request)).label_ids)
    const thread = await supabase.from('monitoring_threads').select('id,channel_id').eq('account_id', accountId).eq('id', id).maybeSingle()
    if (thread.error) throw thread.error
    if (!thread.data || !canSeeChannel(access, thread.data.channel_id)) return privateJson({ error: 'Conversation not found.' }, 404)
    await setThreadLabels(monitoringAdmin(), accountId, userId, id, ids)
    return privateJson({ label_ids: ids })
  } catch (error) { return monitoringError(error) }
}
