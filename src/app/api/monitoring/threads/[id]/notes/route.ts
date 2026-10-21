import { requireRole } from '@/lib/auth/account'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson, readJson, requiredText } from '@/lib/monitoring/http'
import { workflowId } from '@/lib/monitoring/workflow'
import { cursorFilter, readCursor } from '@/lib/monitoring/scroll'

type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    const thread = await supabase.from('monitoring_threads').select('id').eq('account_id', accountId).eq('id', id).maybeSingle()
    if (thread.error) throw thread.error
    if (!thread.data) return privateJson({ error: 'Conversation not found.' }, 404)
    const before = readCursor(new URL(request.url).searchParams.get('before'))
    let query = monitoringAdmin().from('monitoring_events').select('id,payload,received_at')
      .eq('account_id', accountId).eq('field', 'management_note').contains('payload', { thread_id: id })
    if (before) query = query.or(cursorFilter('received_at', before))
    const result = await query.order('received_at', { ascending: false }).order('id', { ascending: false }).limit(31)
    if (result.error) throw result.error
    const rows = result.data.slice(0, 30)
    const last = rows.at(-1)
    return privateJson({ notes: rows.map(row => ({ id: row.id, body: row.payload.body, author: row.payload.author_name, created_at: row.received_at })),
      nextCursor: result.data.length > 30 && last ? `${last.received_at}|${last.id}` : null })
  } catch (error) { return monitoringError(error) }
}
export async function POST(request: Request, context: Context) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const id = checkedId((await context.params).id)
    const body = await readJson(request, 32768)
    const text = requiredText(body, 'body', 5000)
    const requestId = checkedId(String(body.request_id ?? ''))
    const thread = await supabase.from('monitoring_threads').select('id,channel_id').eq('account_id', accountId).eq('id', id).maybeSingle()
    if (thread.error) throw thread.error
    if (!thread.data) return privateJson({ error: 'Conversation not found.' }, 404)
    const db = monitoringAdmin()
    const profile = await db.from('profiles').select('full_name').eq('account_id', accountId).eq('user_id', userId).maybeSingle()
    if (profile.error) throw profile.error
    const noteId = workflowId(accountId, `note:${id}:${requestId}`)
    // Immutable and idempotent. Retrying a slow request never duplicates a note.
    const result = await db.from('monitoring_events').upsert({
      id: noteId, account_id: accountId, channel_id: thread.data.channel_id, event_hash: noteId,
      field: 'management_note', needs_review: false,
      payload: { thread_id: id, body: text, author_id: userId, author_name: profile.data?.full_name || 'Management' },
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (result.error) throw result.error
    const saved = await db.from('monitoring_events').select('id,payload').eq('account_id', accountId).eq('id', noteId).eq('field', 'management_note').single()
    if (saved.error) throw saved.error
    if (saved.data.payload.body !== text || saved.data.payload.author_id !== userId) return privateJson({ error: 'This note request was already used. Reload notes before adding another.' }, 409)
    return privateJson({ id: noteId })
  } catch (error) { return monitoringError(error) }
}
