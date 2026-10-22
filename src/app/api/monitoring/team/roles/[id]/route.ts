import { monitoringAdmin } from '@/lib/monitoring/admin'
import { assertSameOrigin, checkedId, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { forgetMemberAccess, requireMonitoring } from '@/lib/monitoring/team-access'
import { roleInput } from '@/lib/monitoring/team'

type Context = { params: Promise<{ id: string }> }

/** Rename a role or change what it may do (applies to everyone with the role). */
export async function PATCH(request: Request, context: Context) {
  try {
    const { accountId } = await requireMonitoring('full')
    const id = checkedId((await context.params).id)
    const input = roleInput(await readJson(request), true)
    const result = await monitoringAdmin().from('monitoring_roles').update({ ...input, updated_at: new Date().toISOString() })
      .eq('account_id', accountId).eq('id', id).select('id,name,description,permissions').maybeSingle()
    if (result.error?.code === '23505') return privateJson({ error: 'A role with this name already exists.' }, 409)
    if (result.error) throw result.error
    if (!result.data) return privateJson({ error: 'Role not found.' }, 404)
    forgetMemberAccess(accountId)
    return privateJson({ role: result.data })
  } catch (error) { return monitoringError(error) }
}

/** Delete a role that nobody uses (pending invites with it are cancelled). */
export async function DELETE(request: Request, context: Context) {
  try {
    const { accountId } = await requireMonitoring('full')
    const id = checkedId((await context.params).id)
    assertSameOrigin(request)
    const db = monitoringAdmin()
    const used = await db.from('monitoring_member_access').select('user_id', { count: 'exact', head: true }).eq('account_id', accountId).eq('role_id', id)
    if (used.error) throw used.error
    if (used.count) return privateJson({ error: `${used.count} team member${used.count === 1 ? ' has' : 's have'} this role. Give them another role first.` }, 409)
    const invites = await db.from('monitoring_invites').select('invitation_id').eq('account_id', accountId).eq('role_id', id)
    if (invites.error) throw invites.error
    if (invites.data?.length) {
      const cancelled = await db.from('account_invitations').delete().eq('account_id', accountId).is('accepted_at', null).in('id', invites.data.map(i => i.invitation_id))
      if (cancelled.error) throw cancelled.error
    }
    const result = await db.from('monitoring_roles').delete().eq('account_id', accountId).eq('id', id).select('id').maybeSingle()
    if (result.error?.code === '23503') return privateJson({ error: 'This role is still assigned. Give its members another role first.' }, 409)
    if (result.error) throw result.error
    if (!result.data) return privateJson({ error: 'Role not found.' }, 404)
    return privateJson({ deleted: true })
  } catch (error) { return monitoringError(error) }
}
