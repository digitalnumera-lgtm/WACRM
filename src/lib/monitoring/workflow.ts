import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MonitoringInputError } from './http'
import { missingWorkflowSchema, priorities, WorkflowSchemaMissing } from './inbox'
import type { ThreadWorkflow } from './workflow-types'

export type WorkflowThread = { id: string; channel_id: string; message_count: number }
export function workflowId(account: string, key: string) {
  const hash = createHash('sha256').update(`monitoring-workflow:v1:${account}:${key}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

type MetaRow = { status?: string; status_at_count?: number; snoozed_until?: string | null; seen_count?: number; marked_unread?: boolean; priority?: string }

/** Mirrors the monitoring_inbox view: newer messages reopen resolved/snoozed chats. */
export function deriveWorkflow(count: number, meta?: MetaRow | null, now = Date.now()): ThreadWorkflow {
  const seen = Number.isSafeInteger(meta?.seen_count) ? Math.max(0, Number(meta!.seen_count)) : 0
  const changed = count > Number(meta?.status_at_count ?? -1)
  const until = typeof meta?.snoozed_until === 'string' && Number.isFinite(Date.parse(meta.snoozed_until)) ? meta.snoozed_until : null
  const state = !changed && meta?.status === 'resolved' ? 'resolved'
    : !changed && meta?.status === 'snoozed' && until && Date.parse(until) > now ? 'snoozed' : 'open'
  const priority = priorities.includes(meta?.priority as typeof priorities[number]) ? meta!.priority as ThreadWorkflow['priority'] : 'none'
  return { status: state, snoozed_until: state === 'snoozed' ? until : null, unread_count: Math.max(0, count - seen), marked_unread: meta?.marked_unread === true, priority }
}

/** Validates a requested change and returns the monitoring_thread_meta columns to write. */
export function workflowChange(body: Record<string, unknown>, count: number, now = Date.now()): MetaRow {
  if (body.action === 'priority') {
    if (!priorities.includes(body.priority as typeof priorities[number])) throw new MonitoringInputError('Choose a priority.')
    return { priority: String(body.priority) }
  }
  const observed = body.observed_count
  if (!Number.isSafeInteger(observed) || Number(observed) < 0 || Number(observed) > count) throw new MonitoringInputError('Refresh this conversation before updating it.')
  if (body.action === 'read' || body.action === 'unread') {
    return { seen_count: Number(observed), marked_unread: body.action === 'unread' }
  }
  if (body.action !== 'status' || !['open', 'resolved', 'snoozed'].includes(String(body.status))) throw new MonitoringInputError('Choose a conversation status.')
  let until: string | null = null
  if (body.status === 'snoozed') {
    if (typeof body.until !== 'string' || !Number.isFinite(Date.parse(body.until)) || Date.parse(body.until) <= now || Date.parse(body.until) > now + 30 * 86400000) {
      throw new MonitoringInputError('Choose a snooze time within the next 30 days.')
    }
    until = new Date(body.until).toISOString()
  }
  // Resolving also marks the conversation reviewed, as in Chatwoot.
  return { status: String(body.status), status_at_count: Number(observed), snoozed_until: until,
    ...(body.status === 'resolved' ? { seen_count: Number(observed), marked_unread: false } : {}) }
}

export async function readWorkflows(db: SupabaseClient, account: string, threads: WorkflowThread[]): Promise<Record<string, ThreadWorkflow & { label_ids: string[] }>> {
  if (!threads.length) return {}
  const result = await db.from('monitoring_inbox').select('id,state,snoozed_until,unread_count,marked_unread,priority,label_ids')
    .eq('account_id', account).in('id', threads.map(t => t.id)).limit(threads.length)
  if (result.error && missingWorkflowSchema(result.error)) throw new WorkflowSchemaMissing()
  if (result.error) throw result.error
  return Object.fromEntries((result.data ?? []).map(row => [row.id, {
    status: row.state, snoozed_until: row.snoozed_until, unread_count: row.unread_count,
    marked_unread: row.marked_unread, priority: row.priority, label_ids: row.label_ids ?? [],
  }]))
}

export async function writeWorkflow(db: SupabaseClient, account: string, actor: string, thread: WorkflowThread, body: Record<string, unknown>) {
  const change = workflowChange(body, thread.message_count)
  const result = await db.from('monitoring_thread_meta').upsert({
    thread_id: thread.id, account_id: account, ...change, updated_by: actor, updated_at: new Date().toISOString(),
  }, { onConflict: 'thread_id' })
  if (result.error && missingWorkflowSchema(result.error)) throw new WorkflowSchemaMissing()
  if (result.error) throw result.error
}
