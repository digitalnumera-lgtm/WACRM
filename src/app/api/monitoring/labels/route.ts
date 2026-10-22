import { requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { missingWorkflowSchema } from '@/lib/monitoring/inbox'
import { check, labelColumns, labelInput } from '@/lib/monitoring/labels'

export async function GET() {
  try {
    const { accountId } = await requireMonitoring('view_inbox')
    const result = await monitoringAdmin().from('monitoring_labels').select(labelColumns).eq('account_id', accountId).order('name').limit(200)
    if (result.error && missingWorkflowSchema(result.error)) return privateJson({ labels: [], workflowReady: false })
    if (result.error) throw result.error
    return privateJson({ labels: result.data, workflowReady: true })
  } catch (error) { return monitoringError(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireMonitoring('manage_labels')
    const input = labelInput(await readJson(request))
    const db = monitoringAdmin()
    const total = check(await db.from('monitoring_labels').select('id', { count: 'exact', head: true }).eq('account_id', accountId))
    if ((total.count ?? 0) >= 200) return privateJson({ error: 'A company can have up to 200 labels.' }, 400)
    const result = check(await db.from('monitoring_labels').insert({ ...input, account_id: accountId, created_by: userId }).select(labelColumns).single())
    return privateJson({ label: result.data }, 201)
  } catch (error) { return monitoringError(error) }
}
