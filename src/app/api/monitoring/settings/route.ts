import { requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { managementRepliesEnabled, saveManagementReplies } from '@/lib/monitoring/settings'

export async function GET() {
  try {
    const { accountId } = await requireMonitoring('view_inbox')
    return privateJson({ management_replies_enabled: await managementRepliesEnabled(monitoringAdmin(), accountId) })
  } catch (error) { return monitoringError(error) }
}
export async function PATCH(request: Request) {
  try {
    const { accountId, userId } = await requireMonitoring('full')
    const body = await readJson(request)
    if (typeof body.management_replies_enabled !== 'boolean') return privateJson({ error: 'Choose whether management replies are enabled.' }, 400)
    const saved = await saveManagementReplies(monitoringAdmin(), accountId, userId, body.management_replies_enabled)
    if (!saved) return privateJson({ error: 'Add a business number before changing reply settings.' }, 409)
    return privateJson({ management_replies_enabled: body.management_replies_enabled })
  } catch (error) { return monitoringError(error) }
}
