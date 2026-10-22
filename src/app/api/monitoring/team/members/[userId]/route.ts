import { forgetAccountContext } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { assertSameOrigin, checkedId, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { forgetMemberAccess, requireMonitoring } from '@/lib/monitoring/team-access'
import { accessInput, channelInput, ownRole } from '@/lib/monitoring/team'

type Context = { params: Promise<{ userId: string }> }

async function target(accountId: string, userId: string) {
  const result = await monitoringAdmin().from('profiles').select('user_id,account_role').eq('account_id', accountId).eq('user_id', userId).maybeSingle()
  if (result.error) throw result.error
  return result.data as { user_id: string; account_role: string } | null
}

/** Change a member's access: admin (full) or a custom role plus numbers. */
export async function PATCH(request: Request, context: Context) {
  try {
    const { accountId, userId, supabase } = await requireMonitoring('full')
    const memberId = checkedId((await context.params).userId)
    const body = await readJson(request)
    if (memberId === userId) return privateJson({ error: 'You cannot change your own access.' }, 400)
    const member = await target(accountId, memberId)
    if (!member) return privateJson({ error: 'Team member not found.' }, 404)
    if (member.account_role === 'owner') return privateJson({ error: 'The owner always has full access.' }, 400)
    const access = accessInput(body.access)
    const db = monitoringAdmin()
    if (access === 'admin') {
      // Account roles change through the existing database function, which
      // re-checks that the caller is an owner or admin of this company.
      if (member.account_role !== 'admin') {
        const result = await supabase.rpc('set_member_role', { p_user_id: memberId, p_new_role: 'admin' })
        if (result.error) return privateJson({ error: result.error.message || 'Unable to change this member’s access.' }, 400)
      }
      const cleared = await db.from('monitoring_member_access').delete().eq('account_id', accountId).eq('user_id', memberId)
      if (cleared.error) throw cleared.error
    } else {
      await ownRole(db, accountId, access)
      const channels = await channelInput(db, accountId, body.channel_ids)
      const saved = await db.from('monitoring_member_access').upsert({ account_id: accountId, user_id: memberId, role_id: access, channel_ids: channels, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'account_id,user_id' })
      if (saved.error) throw saved.error
      if (member.account_role === 'admin' || member.account_role === 'agent') {
        const result = await supabase.rpc('set_member_role', { p_user_id: memberId, p_new_role: 'viewer' })
        if (result.error) return privateJson({ error: result.error.message || 'Unable to change this member’s access.' }, 400)
      }
    }
    forgetMemberAccess(accountId, memberId)
    forgetAccountContext(memberId)
    return privateJson({ saved: true })
  } catch (error) { return monitoringError(error) }
}

/** Remove someone from the team. Their login keeps working, without CRM access. */
export async function DELETE(request: Request, context: Context) {
  try {
    const { accountId, userId, supabase } = await requireMonitoring('full')
    const memberId = checkedId((await context.params).userId)
    assertSameOrigin(request)
    if (memberId === userId) return privateJson({ error: 'You cannot remove yourself.' }, 400)
    const member = await target(accountId, memberId)
    if (!member) return privateJson({ error: 'Team member not found.' }, 404)
    if (member.account_role === 'owner') return privateJson({ error: 'The owner cannot be removed.' }, 400)
    const result = await supabase.rpc('remove_account_member', { p_user_id: memberId })
    if (result.error) return privateJson({ error: result.error.message || 'Unable to remove this member.' }, 400)
    const cleared = await monitoringAdmin().from('monitoring_member_access').delete().eq('account_id', accountId).eq('user_id', memberId)
    if (cleared.error) throw cleared.error
    forgetMemberAccess(accountId, memberId)
    forgetAccountContext(memberId)
    return privateJson({ removed: true })
  } catch (error) { return monitoringError(error) }
}
