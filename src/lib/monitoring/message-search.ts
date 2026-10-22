import { scopeChannels, type MonitoringAccess } from './team-access'

const MAX_THREADS = 150

/**
 * Conversations where any message (text or caption) contains the search, so
 * the inbox search finds older messages too, not only the latest one.
 */
export async function threadsWithText(access: Pick<MonitoringAccess, 'db' | 'accountId' | 'channelIds' | 'hiddenIds'>, search: string): Promise<string[]> {
  if (search.trim().length < 2) return []
  const pattern = `%${search.replace(/\\/g, '\\\\').replace(/[%_*]/g, '\\$&')}%`
  type Rows = { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<{ data: { thread_id: string }[] | null; error: unknown }> } }
  const result = await (scopeChannels(access, access.db.from('monitoring_messages').select('thread_id').eq('account_id', access.accountId).ilike('content', pattern)) as unknown as Rows)
    .order('sent_at', { ascending: false }).limit(1000)
  if (result.error) return [] // The search still covers names, numbers and last messages.
  return [...new Set((result.data ?? []).map(r => r.thread_id))].slice(0, MAX_THREADS)
}
