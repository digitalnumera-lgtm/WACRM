import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, MonitoringInputError, privateJson, readJson } from '@/lib/monitoring/http'
import { isGrantLevel, requireTracker } from '@/lib/tracker/access'
import { trackerError } from '@/lib/tracker/http'

/** Owner only. Body: { user_id, level: 'view' | 'amounts' | 'full' | null } (null removes access). */
export async function PUT(request: Request) {
  try {
    const { accountId, userId } = await requireTracker('owner')
    const body = await readJson(request)
    const memberId = checkedId(String(body.user_id ?? ''))
    if (memberId === userId) throw new MonitoringInputError('The owner always has full access.')
    const db = monitoringAdmin()
    const member = await db.from('profiles').select('account_role').eq('account_id', accountId).eq('user_id', memberId).maybeSingle()
    if (member.error) throw member.error
    if (!member.data) return privateJson({ error: 'Team member not found.' }, 404)
    if (member.data.account_role === 'owner') throw new MonitoringInputError('The owner always has full access.')
    if (body.level === null) {
      const removed = await db.from('tracker_access').delete().eq('account_id', accountId).eq('user_id', memberId)
      if (removed.error) throw removed.error
      return privateJson({ saved: true, level: null })
    }
    if (!isGrantLevel(body.level)) throw new MonitoringInputError('Choose an access level.')
    const saved = await db.from('tracker_access').upsert({ account_id: accountId, user_id: memberId, level: body.level, granted_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'account_id,user_id' })
    if (saved.error) throw saved.error
    return privateJson({ saved: true, level: body.level })
  } catch (error) { return trackerError(error) }
}
