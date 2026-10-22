import { privateJson } from '@/lib/monitoring/http'
import { requireTracker } from '@/lib/tracker/access'
import { getSnapshot } from '@/lib/tracker/connection'
import { trackerError } from '@/lib/tracker/http'
import { buildView } from '@/lib/tracker/model'

export const runtime = 'nodejs'

/** The Client Tracker data, trimmed to what the caller's access level allows. */
export async function GET(request: Request) {
  try {
    const access = await requireTracker('view')
    const force = new URL(request.url).searchParams.get('refresh') === '1'
    const snap = await getSnapshot(access.accountId, { force })
    const view = buildView(snap.raw, access.level, snap.fetchedAt)
    if (snap.stale) view.stale = snap.stale
    return privateJson(view)
  } catch (error) { return trackerError(error) }
}
