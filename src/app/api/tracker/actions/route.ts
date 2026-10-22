import { privateJson, readJson } from '@/lib/monitoring/http'
import { requireTracker } from '@/lib/tracker/access'
import { actionInput } from '@/lib/tracker/actions'
import { callScript, readConnection, storeSnapshot, TrackerConnectionError } from '@/lib/tracker/connection'
import { trackerError } from '@/lib/tracker/http'
import { buildView, isRawSnapshot } from '@/lib/tracker/model'
import { monitoringAdmin } from '@/lib/monitoring/admin'

export const runtime = 'nodejs'
export const maxDuration = 180

/**
 * People with Full access (and the owner): a change made through the Apps
 * Script, which runs the main tracker script's own functions. Answers with
 * the result and the updated tracker.
 */
export async function POST(request: Request) {
  try {
    const access = await requireTracker('full')
    const body = await readJson(request, 32768)
    const { action, input } = actionInput(body.action, body.input)
    const conn = await readConnection(access.accountId)
    if (!conn.url || !conn.key) throw new TrackerConnectionError('not_connected', 'The Client Tracker is not connected to the Sheet yet.')
    const me = await monitoringAdmin().from('profiles').select('full_name,email').eq('user_id', access.userId).maybeSingle()
    const actor = String(me.data?.full_name || me.data?.email || 'CRM user').slice(0, 60)
    const reply = await callScript(conn.url, conn.key, action, { input, actor }, 170_000)
    if (!isRawSnapshot(reply.snapshot)) return privateJson({ result: reply.result ?? null })
    const fetchedAt = await storeSnapshot(access.accountId, reply.snapshot)
    return privateJson({ result: reply.result ?? null, view: buildView(reply.snapshot, access.level, fetchedAt) })
  } catch (error) { return trackerError(error) }
}
