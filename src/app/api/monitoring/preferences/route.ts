import { createClient } from '@/lib/supabase/server'
import { monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { sanitizePreferences } from '@/lib/monitoring/preferences'
import { requireMonitoring } from '@/lib/monitoring/team-access'

/** The signed-in user's own CRM preferences. */
export async function GET() {
  try {
    await requireMonitoring('view_inbox')
    const { data, error } = await (await createClient()).auth.getUser()
    if (error || !data.user) return privateJson({ error: 'Sign in to continue.' }, 401)
    return privateJson({ preferences: sanitizePreferences(data.user.user_metadata?.crm_preferences) })
  } catch (error) { return monitoringError(error) }
}

export async function PUT(request: Request) {
  try {
    await requireMonitoring('view_inbox')
    const preferences = sanitizePreferences((await readJson(request, 8192)).preferences)
    const { error } = await (await createClient()).auth.updateUser({ data: { crm_preferences: preferences } })
    if (error) return privateJson({ error: 'Your preferences could not be saved. Please try again.' }, 503)
    return privateJson({ preferences })
  } catch (error) { return monitoringError(error) }
}
