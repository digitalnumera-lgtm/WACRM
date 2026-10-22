import { monitoringAdmin } from '@/lib/monitoring/admin'
import { assertSameOrigin, checkedId, monitoringError, privateJson } from '@/lib/monitoring/http'
import { requireMonitoring } from '@/lib/monitoring/team-access'

/** Cancel a pending invitation (its link stops working). */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { accountId } = await requireMonitoring('full')
    const id = checkedId((await context.params).id)
    assertSameOrigin(request)
    const result = await monitoringAdmin().from('account_invitations').delete().eq('account_id', accountId).eq('id', id).is('accepted_at', null).select('id').maybeSingle()
    if (result.error) throw result.error
    if (!result.data) return privateJson({ error: 'Invitation not found or already accepted.' }, 404)
    return privateJson({ deleted: true })
  } catch (error) { return monitoringError(error) }
}
