import type { SupabaseClient } from '@supabase/supabase-js'
import { checkedId, MonitoringInputError, WorkflowSchemaMissing } from './http'
import { missingWorkflowSchema } from './inbox'

export const labelColumns = 'id,name,color,description'
export const labelPalette = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b']

export function labelInput(body: Record<string, unknown>, partial = false) {
  const value: { name?: string; color?: string; description?: string | null } = {}
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 40) throw new MonitoringInputError('Label name must be 1–40 characters.')
    value.name = body.name.trim()
  }
  if (!partial || body.color !== undefined) {
    const color = body.color ?? labelPalette[5]
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new MonitoringInputError('Choose a valid label colour.')
    value.color = color.toLowerCase()
  }
  if (body.description !== undefined) {
    if (body.description !== null && (typeof body.description !== 'string' || body.description.length > 200)) throw new MonitoringInputError('Description must be 200 characters or fewer.')
    value.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
  }
  return value
}

export function labelIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) throw new MonitoringInputError('Choose up to 20 labels.')
  return [...new Set(value.map(id => checkedId(String(id))))]
}

/** Throws WorkflowSchemaMissing for an uninstalled schema, otherwise the original error. */
export function check<T extends { error: unknown }>(result: T): T {
  if (result.error && missingWorkflowSchema(result.error)) throw new WorkflowSchemaMissing()
  if ((result.error as { code?: string } | null)?.code === '23505') throw new MonitoringInputError('A label with this name already exists.')
  if (result.error) throw result.error
  return result
}

/** Replaces a conversation's labels with the given set (company-scoped). */
export async function setThreadLabels(db: SupabaseClient, account: string, actor: string, thread: string, ids: string[]) {
  if (ids.length) {
    const owned = check(await db.from('monitoring_labels').select('id').eq('account_id', account).in('id', ids))
    if ((owned.data ?? []).length !== ids.length) throw new MonitoringInputError('One or more labels no longer exist.')
  }
  let removal = db.from('monitoring_thread_labels').delete().eq('account_id', account).eq('thread_id', thread)
  if (ids.length) removal = removal.not('label_id', 'in', `(${ids.join(',')})`)
  check(await removal)
  if (ids.length) check(await db.from('monitoring_thread_labels').upsert(ids.map(label_id => ({ thread_id: thread, label_id, account_id: account, added_by: actor })),
    { onConflict: 'thread_id,label_id', ignoreDuplicates: true }))
}
