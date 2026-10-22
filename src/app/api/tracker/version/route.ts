import { monitoringAdmin } from '@/lib/monitoring/admin'
import { privateJson } from '@/lib/monitoring/http'
import { requireTracker } from '@/lib/tracker/access'
import { trackerError } from '@/lib/tracker/http'

/** When the CRM last got a new copy of the Sheet: the open tracker checks this every few seconds. */
export async function GET() {
  try {
    const { accountId } = await requireTracker('view')
    const row = await monitoringAdmin().from('tracker_snapshot').select('fetched_at,data_hash').eq('account_id', accountId).maybeSingle()
    return privateJson({ fetchedAt: row.data?.fetched_at ?? null, version: row.data?.data_hash ?? null })
  } catch (error) { return trackerError(error) }
}
