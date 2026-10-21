import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { assertSameOrigin, checkedId, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { check, labelColumns, labelInput } from '@/lib/monitoring/labels'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context) {
  try {
    const { accountId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    const input = labelInput(await readJson(request), true)
    const result = check(await monitoringAdmin().from('monitoring_labels').update(input).eq('account_id', accountId).eq('id', id).select(labelColumns).maybeSingle())
    if (!result.data) return privateJson({ error: 'Label not found.' }, 404)
    return privateJson({ label: result.data })
  } catch (error) { return monitoringError(error) }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { accountId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    assertSameOrigin(request)
    // Removing a label detaches it from conversations (cascade); messages are untouched.
    const result = check(await monitoringAdmin().from('monitoring_labels').delete().eq('account_id', accountId).eq('id', id).select('id').maybeSingle())
    if (!result.data) return privateJson({ error: 'Label not found.' }, 404)
    return privateJson({ deleted: true })
  } catch (error) { return monitoringError(error) }
}
