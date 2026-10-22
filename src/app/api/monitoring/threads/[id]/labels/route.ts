import { canSeeChannel, requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { changeThreadLabels, labelIds, setThreadLabels } from '@/lib/monitoring/labels'

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireMonitoring('apply_labels')
    const { db: supabase, accountId, userId } = access
    const id = checkedId((await context.params).id)
    const body = await readJson(request)
    // Preferred: { add, remove } changes. { label_ids } replaces the whole set (older clients).
    const delta = body.add !== undefined || body.remove !== undefined
    const add = delta ? labelIds(body.add ?? []) : []
    const remove = delta ? labelIds(body.remove ?? []) : []
    const ids = delta ? [] : labelIds(body.label_ids)
    const thread = await supabase.from('monitoring_threads').select('id,channel_id').eq('account_id', accountId).eq('id', id).maybeSingle()
    if (thread.error) throw thread.error
    if (!thread.data || !canSeeChannel(access, thread.data.channel_id)) return privateJson({ error: 'Conversation not found.' }, 404)
    if (delta) return privateJson({ label_ids: await changeThreadLabels(monitoringAdmin(), accountId, userId, id, add, remove.filter(r => !add.includes(r))) })
    await setThreadLabels(monitoringAdmin(), accountId, userId, id, ids)
    return privateJson({ label_ids: ids })
  } catch (error) { return monitoringError(error) }
}
