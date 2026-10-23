import { privateJson } from '@/lib/monitoring/http'
import { requireTracker } from '@/lib/tracker/access'
import { callScript, readConnection, TrackerConnectionError } from '@/lib/tracker/connection'
import { trackerError } from '@/lib/tracker/http'

export const runtime = 'nodejs'

const cache = new Map<string, { expires: number; options: unknown }>()

/** Choices for the add-deal form (the Closed Deal form's own options), cached for 10 minutes. */
export async function GET() {
  try {
    const { accountId } = await requireTracker('full')
    const hit = cache.get(accountId)
    if (hit && hit.expires > Date.now()) return privateJson(hit.options)
    const conn = await readConnection(accountId)
    if (!conn.url || !conn.key) throw new TrackerConnectionError('not_connected', 'The Google Sheet is not connected yet.')
    const reply = await callScript(conn.url, conn.key, 'options')
    cache.set(accountId, { expires: Date.now() + 600_000, options: reply.options })
    return privateJson(reply.options)
  } catch (error) { return trackerError(error) }
}
