import { randomUUID } from 'node:crypto'
import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, MonitoringInputError, monitoringError, privateJson, readJson, requiredText } from '@/lib/monitoring/http'
import { workflowId } from '@/lib/monitoring/workflow'

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const search = new URL(request.url).searchParams.get('q')?.trim() ?? ''
    if (search.length > 120) throw new MonitoringInputError('Search is too long.')
    let query = monitoringAdmin().from('monitoring_events').select('id,payload', { count: 'exact' })
      .eq('account_id', accountId).eq('field', 'management_quick_reply').eq('payload->>deleted', 'false')
    if (search) query = query.ilike('payload->>title', `%${search.replace(/[\\%_]/g, '\\$&')}%`)
    const result = await query.order('payload->>title').order('id').limit(100)
    if (result.error) throw result.error
    return privateJson({ replies: result.data.map(row => ({ id: row.id, title: row.payload.title, body: row.payload.body, version: row.payload.version })), total: result.count })
  } catch (error) { return monitoringError(error) }
}
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const body = await readJson(request, 32768)
    const title = requiredText(body, 'title', 80)
    const text = requiredText(body, 'body', 4096)
    const requestId = checkedId(String(body.request_id ?? ''))
    const db = monitoringAdmin()
    const channel = await db.from('monitoring_channels').select('id').eq('account_id', accountId).order('created_at').order('id').limit(1).maybeSingle()
    if (channel.error) throw channel.error
    if (!channel.data) return privateJson({ error: 'Add a business number before creating saved replies.' }, 409)
    const id = workflowId(accountId, `quick-reply:${requestId}`)
    const result = await db.from('monitoring_events').upsert({
      id, account_id: accountId, channel_id: channel.data.id, event_hash: id,
      field: 'management_quick_reply', needs_review: false,
      payload: { title, body: text, deleted: false, version: randomUUID(), updated_by: userId, updated_at: new Date().toISOString() },
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (result.error) throw result.error
    const saved = await db.from('monitoring_events').select('payload').eq('account_id', accountId).eq('id', id).eq('field', 'management_quick_reply').single()
    if (saved.error) throw saved.error
    if (saved.data.payload.title !== title || saved.data.payload.body !== text || saved.data.payload.deleted) return privateJson({ error: 'This save request was already used. Refresh saved replies.' }, 409)
    return privateJson({ id })
  } catch (error) { return monitoringError(error) }
}
export async function PATCH(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const body = await readJson(request, 32768)
    const id = checkedId(String(body.id ?? ''))
    const version = checkedId(String(body.version ?? ''))
    if (body.action !== 'update' && body.action !== 'delete') throw new MonitoringInputError('Choose an update or removal.')
    const title = body.action === 'update' ? requiredText(body, 'title', 80) : ''
    const text = body.action === 'update' ? requiredText(body, 'body', 4096) : ''
    const result = await monitoringAdmin().from('monitoring_events').update({
      payload: { title, body: text, deleted: body.action === 'delete', version: randomUUID(), updated_by: userId, updated_at: new Date().toISOString() },
    }).eq('account_id', accountId).eq('id', id).eq('field', 'management_quick_reply')
      .eq('payload->>deleted', 'false').eq('payload->>version', version).select('id').maybeSingle()
    if (result.error) throw result.error
    if (!result.data) return privateJson({ error: 'This reply changed or is unavailable. Refresh before editing it again.' }, 409)
    return privateJson({ id })
  } catch (error) { return monitoringError(error) }
}
