import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MonitoringInputError } from './http'
import type { ThreadWorkflow } from './workflow-types'

export type WorkflowThread = { id: string; channel_id: string; message_count: number }
type Entry = { id: string; payload: Record<string, unknown> }
export function workflowId(account: string, key: string) {
  const hash = createHash('sha256').update(`monitoring-workflow:v1:${account}:${key}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
export function deriveWorkflow(count: number, status?: Record<string, unknown>, read?: Record<string, unknown>, now = Date.now()): ThreadWorkflow {
  const seen = Number.isSafeInteger(read?.seen_count) ? Math.max(0, Number(read!.seen_count)) : 0
  const unread = Math.max(0, count - seen)
  const marked = read?.marked_unread === true
  const changed = count > Number(status?.at_count ?? -1)
  const until = typeof status?.until === 'string' && Number.isFinite(Date.parse(status.until)) ? status.until : null
  const state = !changed && status?.status === 'resolved' ? 'resolved'
    : !changed && status?.status === 'snoozed' && until && Date.parse(until) > now ? 'snoozed' : 'open'
  return { status: state, snoozed_until: state === 'snoozed' ? until : null, unread_count: unread, marked_unread: marked }
}
export async function readWorkflows(db: SupabaseClient, account: string, threads: WorkflowThread[]) {
  if (!threads.length) return {}
  const ids = threads.flatMap(t => ['status', 'read'].map(key => workflowId(account, `${t.id}:${key}`)))
  const result = await db.from('monitoring_events').select('id,payload').eq('account_id', account)
    .in('field', ['management_thread_status', 'management_thread_read']).in('id', ids).limit(ids.length)
  if (result.error) throw result.error
  const rows = new Map<string, Record<string, unknown>>((result.data as Entry[]).map(row => [row.id, row.payload]))
  return Object.fromEntries(threads.map(t => [t.id, deriveWorkflow(t.message_count,
    rows.get(workflowId(account, `${t.id}:status`)), rows.get(workflowId(account, `${t.id}:read`)))]))
}

export function workflowChange(body: Record<string, unknown>, count: number, now = Date.now()) {
  const observed = body.observed_count
  if (!Number.isSafeInteger(observed) || Number(observed) < 0 || Number(observed) > count) throw new MonitoringInputError('Refresh this conversation before updating it.')
  if (body.action === 'read' || body.action === 'unread') {
    return { key: 'read', payload: { seen_count: observed, marked_unread: body.action === 'unread' } }
  }
  if (body.action !== 'status' || !['open', 'resolved', 'snoozed'].includes(String(body.status))) throw new MonitoringInputError('Choose a conversation status.')
  let until: string | null = null
  if (body.status === 'snoozed') {
    if (typeof body.until !== 'string' || !Number.isFinite(Date.parse(body.until)) || Date.parse(body.until) <= now || Date.parse(body.until) > now + 30 * 86400000) {
      throw new MonitoringInputError('Choose a snooze time within the next 30 days.')
    }
    until = new Date(body.until).toISOString()
  }
  return { key: 'status', payload: { status: body.status, at_count: observed, until } }
}

export async function writeWorkflow(db: SupabaseClient, account: string, actor: string, thread: WorkflowThread, body: Record<string, unknown>) {
  const change = workflowChange(body, thread.message_count)
  const id = workflowId(account, `${thread.id}:${change.key}`)
  const result = await db.from('monitoring_events').upsert({
    id, account_id: account, channel_id: thread.channel_id, event_hash: id,
    field: `management_thread_${change.key}`, needs_review: false,
    payload: { ...change.payload, thread_id: thread.id, updated_by: actor, updated_at: new Date().toISOString() },
  }, { onConflict: 'id' })
  if (result.error) throw result.error
}
