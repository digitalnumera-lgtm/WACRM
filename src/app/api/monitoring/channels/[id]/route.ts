import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'

// Removal is reversible: retain the channel, credentials and conversations.
// The webhook and management reply paths already reject inactive channels.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { accountId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    const body = await readJson(request)
    if (typeof body.active !== 'boolean') return privateJson({ error: 'Choose whether monitoring is enabled.' }, 400)
    const result = await monitoringAdmin().from('monitoring_channels')
      .update({ active: body.active }).eq('account_id', accountId).eq('id', id)
      .select('id,active').maybeSingle()
    if (result.error) throw result.error
    if (!result.data) return privateJson({ error: 'Business number not found.' }, 404)
    return privateJson({ channel: result.data })
  } catch (error) { return monitoringError(error) }
}
