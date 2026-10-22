import { allowedChannels, hideNumbers, requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { monitoringError, privateJson } from '@/lib/monitoring/http'
import { applyInboxFilters, applyInboxTab, inboxTabs, missingWorkflowSchema, readInboxFilters } from '@/lib/monitoring/inbox'
import { threadsWithText } from '@/lib/monitoring/message-search'

// Tab badges for the inbox (Open, Waiting, Unread, Snoozed, Resolved, All),
// using the same number/agent/lead/label/priority/search filters as the list.
export async function GET(request: Request) {
  try {
    const access = await requireMonitoring('view_inbox')
    const { db: supabase, accountId } = access
    const filters = readInboxFilters(new URL(request.url).searchParams)
    const messageThreads = filters.search ? await threadsWithText(access, filters.search) : []
    let channelIds: string[] | null = null
    if (filters.channel || filters.agent) {
      const channels = await supabase.from('monitoring_channels').select('id,label').eq('account_id', accountId)
      if (channels.error) throw channels.error
      channelIds = (channels.data ?? []).filter(c => (!filters.channel || c.id === filters.channel) && (!filters.agent || c.label === filters.agent)).map(c => c.id)
    }
    channelIds = allowedChannels(access, channelIds)
    if (channelIds && !channelIds.length) return privateJson({ counts: Object.fromEntries(inboxTabs.map(tab => [tab, 0])), workflowReady: true })
    const db = monitoringAdmin()
    const countFor = (tab: typeof inboxTabs[number]) => {
      const base = db.from('monitoring_inbox').select('id', { count: 'exact', head: true }).eq('account_id', accountId)
      return hideNumbers(access, applyInboxTab(applyInboxFilters(base, { ...filters, channelIds, messageThreads }), tab)) as PromiseLike<{ count: number | null; error: unknown }>
    }
    const results = await Promise.all(inboxTabs.map(countFor))
    const failed = results.find(r => r.error)
    if (failed && missingWorkflowSchema(failed.error)) return privateJson({ counts: null, workflowReady: false })
    if (failed) throw failed.error
    return privateJson({ counts: Object.fromEntries(inboxTabs.map((tab, i) => [tab, results[i].count ?? 0])), workflowReady: true })
  } catch (error) { return monitoringError(error) }
}
