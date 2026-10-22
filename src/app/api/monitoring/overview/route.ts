import { monitoringAdmin } from '@/lib/monitoring/admin'
import { MonitoringInputError, monitoringError, privateJson } from '@/lib/monitoring/http'
import { applyInboxTab, missingWorkflowSchema } from '@/lib/monitoring/inbox'
import { requireMonitoring, scopeChannels } from '@/lib/monitoring/team-access'

type Counted = PromiseLike<{ count: number | null; error: unknown }>

/**
 * Dashboard in one request: status counts, who is waiting per agent, and
 * message volume for the period against the period before it.
 */
export async function GET(request: Request) {
  try {
    const access = await requireMonitoring('view_reports')
    const { accountId, db } = access
    const days = Number(new URL(request.url).searchParams.get('days') ?? 7)
    if (![1, 7, 30].includes(days)) throw new MonitoringInputError('Choose 1, 7 or 30 days')
    const now = Date.now()
    const start = new Date(now - days * 86400000).toISOString()
    const previous = new Date(now - 2 * days * 86400000).toISOString()
    const admin = monitoringAdmin()
    const inbox = () => scopeChannels(access, admin.from('monitoring_inbox').select('id', { count: 'exact', head: true }).eq('account_id', accountId))
    const messages = (direction: string, from: string, until: string) => scopeChannels(access, db.from('monitoring_messages').select('id', { count: 'exact', head: true })
      .eq('account_id', accountId).eq('direction', direction).gte('sent_at', from).lt('sent_at', until)) as unknown as Counted
    const until = new Date(now).toISOString()
    type Rows = { order: (column: string) => { limit: (n: number) => PromiseLike<{ data: { channel_id: string; last_message_at: string }[] | null; error: unknown }> } }
    const base = scopeChannels(access, admin.from('monitoring_inbox').select('channel_id,last_message_at').eq('account_id', accountId)) as unknown as Parameters<typeof applyInboxTab>[0]
    const waitingQuery = applyInboxTab(base, 'waiting') as unknown as Rows
    const [unread, open, resolved, waitingRows, inNow, inBefore, outNow, outBefore, active] = await Promise.all([
      applyInboxTab(inbox(), 'unread') as unknown as Counted,
      applyInboxTab(inbox(), 'open') as unknown as Counted,
      applyInboxTab(inbox(), 'resolved') as unknown as Counted,
      waitingQuery.order('last_message_at').limit(5000),
      messages('inbound', start, until), messages('inbound', previous, start),
      messages('outbound', start, until), messages('outbound', previous, start),
      scopeChannels(access, db.from('monitoring_threads').select('id', { count: 'exact', head: true }).eq('account_id', accountId).gte('last_message_at', start)) as unknown as Counted,
    ])
    const workflow = [unread, open, resolved, waitingRows]
    const failed = workflow.find(r => r.error)
    const ready = !(failed && missingWorkflowSchema(failed.error))
    if (failed && ready) throw failed.error
    for (const r of [inNow, inBefore, outNow, outBefore, active]) if (r.error) throw r.error
    const perAgent: Record<string, { count: number; oldest: string }> = {}
    for (const row of (ready ? waitingRows.data ?? [] : []) as { channel_id: string; last_message_at: string }[]) {
      perAgent[row.channel_id] ??= { count: 0, oldest: row.last_message_at }
      perAgent[row.channel_id].count++
    }
    return privateJson({
      days, workflowReady: ready,
      counts: ready ? { unread: unread.count ?? 0, open: open.count ?? 0, resolved: resolved.count ?? 0, waiting: waitingRows.data?.length ?? 0 } : null,
      waiting: perAgent,
      volume: { inbound: [inNow.count ?? 0, inBefore.count ?? 0], outbound: [outNow.count ?? 0, outBefore.count ?? 0] },
      activeConversations: active.count ?? 0,
    })
  } catch (error) { return monitoringError(error) }
}
