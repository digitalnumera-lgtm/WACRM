import { monitoringError, privateJson } from '@/lib/monitoring/http'
import { monitoringMe } from '@/lib/monitoring/team-access'

/** What the signed-in user may do in the CRM (used to show or hide the UI). */
export async function GET() {
  try {
    const me = await monitoringMe()
    if (!me) return privateJson({ error: 'Your account has no CRM access yet. Ask your company owner to assign you a role.' }, 403)
    return privateJson({ me })
  } catch (error) { return monitoringError(error) }
}
