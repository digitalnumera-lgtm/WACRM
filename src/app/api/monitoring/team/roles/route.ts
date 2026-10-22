import { monitoringAdmin } from '@/lib/monitoring/admin'
import { monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { requireMonitoring } from '@/lib/monitoring/team-access'
import { roleInput } from '@/lib/monitoring/team'

/** Create a custom role. */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireMonitoring('full')
    const input = roleInput(await readJson(request))
    const db = monitoringAdmin()
    const total = await db.from('monitoring_roles').select('id', { count: 'exact', head: true }).eq('account_id', accountId)
    if (total.error) throw total.error
    if ((total.count ?? 0) >= 50) return privateJson({ error: 'A company can have up to 50 roles.' }, 400)
    const result = await db.from('monitoring_roles').insert({ ...input, account_id: accountId, created_by: userId }).select('id,name,description,permissions').single()
    if (result.error?.code === '23505') return privateJson({ error: 'A role with this name already exists.' }, 409)
    if (result.error) throw result.error
    return privateJson({ role: result.data }, 201)
  } catch (error) { return monitoringError(error) }
}
