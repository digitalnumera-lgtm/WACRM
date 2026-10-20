import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { customerMessageKinds, replyWindow } from './reply-window'
import { submitManagementText } from './management-transport'
import { managementRepliesEnabled } from './settings'

type Target = { thread: { id: string; channel_id: string; customer: string; customer_name: string | null }; channel: { id: string; active: boolean; phone_number_id: string } }
export async function managementReplyTarget(db: SupabaseClient, account: string, threadId: string): Promise<Target | null> {
  const thread = await db.from('monitoring_threads').select('id,channel_id,customer,customer_name').eq('account_id', account).eq('id', threadId).maybeSingle()
  if (thread.error) throw new Error('Thread unavailable')
  if (!thread.data) return null
  const channel = await db.from('monitoring_channels').select('id,active,phone_number_id').eq('account_id', account).eq('id', thread.data.channel_id).maybeSingle()
  if (channel.error) throw new Error('Channel unavailable')
  return channel.data ? { thread: thread.data, channel: channel.data } : null
}
export async function managementReplyWindow(db: SupabaseClient, account: string, threadId: string) {
  const inbound = await db.from('monitoring_messages').select('sent_at').eq('account_id', account).eq('thread_id', threadId).eq('direction', 'inbound').in('kind', customerMessageKinds).order('sent_at', { ascending: false }).limit(1).maybeSingle()
  if (inbound.error) throw new Error('Reply window unavailable')
  return replyWindow(inbound.data?.sent_at ?? null)
}
type Attempt = { digest: string; thread_id: string; actor_id: string; text: string; state: string; timestamp: string; meta_id?: string; saved?: boolean; code?: number | null }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export async function readReplyAttempt(db: SupabaseClient, account: string, threadId: string, id: string) {
  const result = await db.from('monitoring_events').select('payload').eq('account_id', account).eq('id', id).eq('field', 'management_reply').maybeSingle()
  if (result.error) throw new Error('Reply status unavailable')
  const attempt = result.data?.payload as Attempt | undefined
  return attempt?.thread_id === threadId ? attempt : null
}
export function replyAttemptResult(attempt: Attempt) {
  if (attempt.state === 'accepted') return { state: 'accepted', saved: attempt.saved === true, message: attempt.saved ? 'Accepted by WhatsApp. Delivery is not yet confirmed.' : 'Accepted by WhatsApp. Saving the conversation needs review; do not send it again.' }
  if (attempt.state === 'rejected') return { state: 'rejected', message: attempt.code === 131047 ? 'WhatsApp requires an approved template outside the reply window.' : attempt.code === 190 ? 'WhatsApp access expired. Renew this business number’s connection.' : 'WhatsApp rejected this reply. Check the number’s connection and messaging permissions.' }
  return { state: 'uncertain', message: 'Sending could not be confirmed. Check the conversation or phone before sending the same message again.' }
}

/** The existing event primary key is a durable one-use reservation. Concurrent
 * calls and retries cannot contact Meta twice with the same request ID. Unknown
 * outcomes stay reserved, including a crash between Meta acceptance and saving.
 */
export async function sendManagementReply(db: SupabaseClient, account: string, actor: string, target: Target, requestId: string, text: string) {
  if (!(await managementRepliesEnabled(db, account))) return { status: 403, body: { error: 'Management replies are disabled in workspace settings.' } }
  const digest = hash(JSON.stringify([target.thread.id, text]))
  const prior = await readReplyAttempt(db, account, target.thread.id, requestId)
  if (prior) {
    if (prior.digest !== digest) return { status: 409, body: { error: 'This request ID belongs to a different reply.' } }
    return { status: prior.state === 'accepted' ? 200 : prior.state === 'rejected' ? 422 : 202, body: replyAttemptResult(prior) }
  }
  if (!target.channel.active) return { status: 409, body: { error: 'This business number is paused.' } }
  if (!/^\d{6,20}$/.test(target.thread.customer)) return { status: 400, body: { error: 'This conversation does not have a supported customer phone number.' } }
  if (!(await managementReplyWindow(db, account, target.thread.id)).open) return { status: 409, body: { error: 'The 24-hour reply window is closed. Wait for a new customer message; template replies are not available here yet.' } }
  const credential = await db.from('monitoring_credentials').select('encrypted_token').eq('channel_id', target.channel.id).maybeSingle()
  if (credential.error || !credential.data) throw new Error('Channel access unavailable')
  const token = decrypt(credential.data.encrypted_token)
  const attempt: Attempt = { digest, thread_id: target.thread.id, actor_id: actor, text, state: 'pending', timestamp: new Date().toISOString() }
  const reservation = await db.from('monitoring_events').insert({ id: requestId, account_id: account, channel_id: target.channel.id, event_hash: hash(`management-reply:${account}:${requestId}`), field: 'management_reply', payload: attempt, needs_review: true })
  if (reservation.error) {
    if (reservation.error.code !== '23505') throw new Error('Could not reserve reply')
    const concurrent = await readReplyAttempt(db, account, target.thread.id, requestId)
    if (!concurrent || concurrent.digest !== digest) return { status: 409, body: { error: 'This request ID is already in use.' } }
    return { status: concurrent.state === 'accepted' ? 200 : concurrent.state === 'rejected' ? 422 : 202, body: replyAttemptResult(concurrent) }
  }
  const outcome = await submitManagementText(target.channel.phone_number_id, token, target.thread.customer, text)
  Object.assign(attempt, outcome)
  const saveAttempt = async () => db.from('monitoring_events').update({ payload: attempt, needs_review: attempt.state === 'uncertain' || attempt.state === 'pending' || (attempt.state === 'accepted' && !attempt.saved) }).eq('account_id', account).eq('id', requestId).select('id').single()
  // Store the result before updating the inbox so a failed inbox write never
  // leads to another transport call. No raw Meta error or token is retained.
  await saveAttempt()
  if (outcome.state === 'accepted') {
    const recorded = await db.rpc('ingest_monitoring_event', { p_channel: target.channel.id, p_hash: hash(`management-reply-result:${account}:${requestId}`), p_field: 'management_reply_result', p_payload: { request_id: requestId, actor_id: actor, meta_id: outcome.meta_id }, p_messages: [{ id: outcome.meta_id, customer: target.thread.customer, name: target.thread.customer_name, direction: 'outbound', timestamp: attempt.timestamp, kind: 'text', text, media_id: null }], p_review: false })
    attempt.saved = !recorded.error
    await saveAttempt()
  }
  return { status: outcome.state === 'accepted' ? 200 : outcome.state === 'rejected' ? 422 : 202, body: replyAttemptResult(attempt) }
}
