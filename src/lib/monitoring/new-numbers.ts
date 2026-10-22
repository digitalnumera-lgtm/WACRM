import { monitoringAdmin } from './admin'
import { scopeChannels, type MonitoringAccess } from './team-access'

type Thread = { id: string; customer: string; channel_id: string; created_at: string; monitoring_messages?: { sent_at: string }[] | null }
type Rows<T> = PromiseLike<{ data: T[] | null; error: unknown }>
export type NewNumbers = { today: number; yesterday: number; byChannel: Record<string, number> }

/**
 * Customers (phone numbers) whose very first conversation started today,
 * compared with yesterday. A chat counts from its first message, so history
 * imported today does not count as new.
 */
export async function newNumbers(access: Pick<MonitoringAccess, 'channelIds' | 'hiddenIds'>, accountId: string, todayStart: Date): Promise<NewNumbers> {
  const db = monitoringAdmin()
  const today = todayStart.getTime(), yesterday = today - 86400000
  const recent = await (scopeChannels(access, db.from('monitoring_threads').select('id,customer,channel_id,created_at,monitoring_messages(sent_at)')
    .eq('account_id', accountId).gte('created_at', new Date(yesterday).toISOString())
    .order('sent_at', { referencedTable: 'monitoring_messages', ascending: true })
    .limit(1, { referencedTable: 'monitoring_messages' })) as unknown as { limit: (n: number) => Rows<Thread> }).limit(2000)
  if (recent.error) throw recent.error
  const started = (recent.data ?? []).map(t => ({ ...t, first: Date.parse(t.monitoring_messages?.[0]?.sent_at ?? t.created_at) })).filter(t => t.first >= yesterday)
  const customers = [...new Set(started.map(t => t.customer))]
  if (!customers.length) return { today: 0, yesterday: 0, byChannel: {} }
  // Earliest earlier conversation per customer, to tell new numbers from returning ones.
  const earlier = new Map<string, number>()
  for (let i = 0; i < customers.length; i += 200) {
    const prior = await (scopeChannels(access, db.from('monitoring_threads').select('customer,created_at').eq('account_id', accountId)
      .in('customer', customers.slice(i, i + 200)).lt('created_at', new Date(today).toISOString())) as unknown as Rows<{ customer: string; created_at: string }>)
    if (prior.error) throw prior.error
    for (const row of prior.data ?? []) {
      const at = Date.parse(row.created_at)
      earlier.set(row.customer, Math.min(at, earlier.get(row.customer) ?? Infinity))
    }
  }
  const counted = { today: new Set<string>(), yesterday: new Set<string>() }
  const byChannel: Record<string, Set<string>> = {}
  for (const t of [...started].sort((a, b) => a.first - b.first)) {
    if (t.first >= today) {
      // New today: no conversation with this number before today (on any agent).
      if (earlier.has(t.customer) || counted.today.has(t.customer)) continue
      counted.today.add(t.customer)
      ;(byChannel[t.channel_id] ??= new Set()).add(t.customer)
    } else if ((earlier.get(t.customer) ?? Infinity) >= yesterday) counted.yesterday.add(t.customer)
  }
  return { today: counted.today.size, yesterday: counted.yesterday.size, byChannel: Object.fromEntries(Object.entries(byChannel).map(([id, set]) => [id, set.size])) }
}
