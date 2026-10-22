import { checkedId, MonitoringInputError, WorkflowSchemaMissing } from './http'
export { WorkflowSchemaMissing }
import { cursorFilter, readCursor } from './scroll'

// Columns of the monitoring_inbox view (supabase/numera/001_inbox_workflow.sql).
export const inboxColumns = 'id,account_id,channel_id,customer,customer_name,lead_status,last_message_at,last_preview,last_direction,message_count,state,snoozed_until,unread_count,marked_unread,is_unread,priority,label_ids'

// "waiting" = the customer spoke last and the agent has not answered yet.
export const inboxTabs = ['open', 'waiting', 'unread', 'snoozed', 'resolved', 'all'] as const
export type InboxTab = typeof inboxTabs[number]
export const priorities = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type Priority = typeof priorities[number]
export const inboxSorts = ['latest', 'oldest'] as const

export type InboxFilters = {
  tab: InboxTab; channelIds: string[] | null; status: string | null; label: string | null;
  priority: Priority | null; search: string | null; sort: typeof inboxSorts[number];
  cursor: ReturnType<typeof readCursor>
  /** Conversations with a message matching the search (any message, not just the last). */
  messageThreads?: string[]
}

/** True when the optional workflow schema has not been installed yet. */
export function missingWorkflowSchema(error: unknown) {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST200' || code === '42703'
}

export function searchLiteral(search: string) {
  // Quote PostgREST operands and escape ILIKE wildcards so user input cannot
  // inject filters or broaden a company query.
  return search.replace(/\\/g, '\\\\').replace(/[%_*]/g, '\\$&').replace(/"/g, '\\"')
}

/**
 * Phone-number forms of a search. Numbers are stored with the country code
 * (92301…), so 0301…, +92 301…, 0092 301… and 92301… all find the same chat.
 */
export function numberVariants(search: string): string[] {
  if (!/^[\d\s()+.-]+$/.test(search)) return []
  const digits = search.replace(/\D/g, '')
  if (digits.length < 3) return []
  const variants = new Set([digits])
  if (digits.startsWith('00')) variants.add(digits.slice(2))
  else if (digits.startsWith('0')) variants.add(`92${digits.slice(1)}`)
  return [...variants]
}

/** PostgREST `or` filter for the inbox search box. */
export function searchFilter(search: string, messageThreads: readonly string[] = []) {
  const literal = searchLiteral(search)
  const numbers = numberVariants(search)
  return [
    ...(numbers.length ? numbers : [literal]).map(n => `customer.ilike."%${n}%"`),
    `customer_name.ilike."%${literal}%"`, `last_preview.ilike."%${literal}%"`,
    ...(messageThreads.length ? [`id.in.(${messageThreads.join(',')})`] : []),
  ].join(',')
}

export function readInboxFilters(params: URLSearchParams): Omit<InboxFilters, 'channelIds'> & { channel: string | null; agent: string | null } {
  const tab = (params.get('tab') || 'all') as InboxTab
  if (!inboxTabs.includes(tab)) throw new MonitoringInputError('Invalid inbox tab')
  const sort = (params.get('sort') || 'latest') as typeof inboxSorts[number]
  if (!inboxSorts.includes(sort)) throw new MonitoringInputError('Invalid sort order')
  const status = params.get('status') || null
  if (status && !/^[a-z_]{1,40}$/.test(status)) throw new MonitoringInputError('Invalid lead status')
  const priority = (params.get('priority') || null) as Priority | null
  if (priority && !priorities.includes(priority)) throw new MonitoringInputError('Invalid priority')
  const label = params.get('label') ? checkedId(params.get('label')!) : null
  const channel = params.get('channel') ? checkedId(params.get('channel')!) : null
  const agent = params.get('agent')?.trim() || null
  if (agent && agent.length > 120) throw new MonitoringInputError('Invalid agent')
  const search = params.get('q')?.trim() || null
  if (search && search.length > 120) throw new MonitoringInputError('Search is too long')
  return { tab, sort, status, priority, label, channel, agent, search, cursor: readCursor(params.get('before')) }
}

// Minimal structural type so helpers accept any PostgREST select builder.
interface Query {
  in(column: string, values: readonly unknown[]): this
  eq(column: string, value: unknown): this
  neq(column: string, value: unknown): this
  contains(column: string, value: unknown): this
  or(filters: string): this
}

/** Applies every filter except the tab, so tab counts can share it. */
export function applyInboxFilters<Q extends Query>(query: Q, f: Omit<InboxFilters, 'tab' | 'sort' | 'cursor'>): Q {
  let q = query
  if (f.channelIds) q = q.in('channel_id', f.channelIds)
  if (f.status) q = q.eq('lead_status', f.status)
  if (f.priority) q = q.eq('priority', f.priority)
  if (f.label) q = q.contains('label_ids', [f.label])
  if (f.search) q = q.or(searchFilter(f.search, f.messageThreads))
  return q
}

export function applyInboxTab<Q extends Query>(query: Q, tab: InboxTab): Q {
  if (tab === 'unread') return query.eq('is_unread', true).neq('state', 'resolved')
  if (tab === 'waiting') return query.eq('last_direction', 'inbound').neq('state', 'resolved')
  if (tab === 'open' || tab === 'snoozed' || tab === 'resolved') return query.eq('state', tab)
  return query
}

export function applyInboxCursor<Q extends Query>(query: Q, f: Pick<InboxFilters, 'cursor' | 'sort'>): Q {
  if (!f.cursor) return query
  return query.or(cursorFilter('last_message_at', f.cursor, f.sort === 'oldest'))
}

export const pageSize = 30
