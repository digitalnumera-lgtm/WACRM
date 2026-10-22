import { monitoringAdmin } from '@/lib/monitoring/admin'
import { MonitoringInputError, privateJson, readJson } from '@/lib/monitoring/http'
import { requireTracker } from '@/lib/tracker/access'
import { TRACKER_APPS_SCRIPT, TRACKER_SCRIPT_VERSION } from '@/lib/tracker/apps-script'
import { callScript, newTrackerKey, readConnection, saveConnection, WEBAPP_URL } from '@/lib/tracker/connection'
import { trackerError } from '@/lib/tracker/http'

export const runtime = 'nodejs'

/** Owner only: the Sheet connection and who has tracker access. */
export async function GET() {
  try {
    const { accountId, userId } = await requireTracker('owner')
    const db = monitoringAdmin()
    const [conn, people, grants] = await Promise.all([
      readConnection(accountId),
      db.from('profiles').select('user_id,full_name,email,account_role').eq('account_id', accountId),
      db.from('tracker_access').select('user_id,level,updated_at').eq('account_id', accountId),
    ])
    if (people.error) throw people.error
    const levels = new Map((grants.error ? [] : grants.data ?? []).map(g => [g.user_id as string, g.level as string]))
    return privateJson({
      ready: conn.ready && !grants.error,
      connection: { url: conn.url, hasKey: !!conn.key, updatedAt: conn.updatedAt },
      script: { version: TRACKER_SCRIPT_VERSION, source: TRACKER_APPS_SCRIPT },
      people: (people.data ?? []).map(p => ({
        user_id: p.user_id, name: p.full_name || p.email || 'Team member', email: p.email, account_role: p.account_role,
        you: p.user_id === userId, level: p.account_role === 'owner' ? 'owner' : levels.get(p.user_id) ?? null,
      })).sort((a, b) => Number(b.level === 'owner') - Number(a.level === 'owner') || String(a.name).localeCompare(String(b.name))),
    })
  } catch (error) { return trackerError(error) }
}

/**
 * Owner only. Body: { url } to save the web app link, { action: 'new_key' }
 * to create a key (returned once), or { action: 'test' } to check the link.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireTracker('owner')
    const body = await readJson(request)
    if (body.action === 'new_key') {
      const key = newTrackerKey()
      await saveConnection(accountId, userId, { key })
      return privateJson({ key })
    }
    if (body.action === 'test') {
      const conn = await readConnection(accountId)
      if (!conn.url || !conn.key) return privateJson({ error: 'Add the web app link and create a key first.' }, 400)
      const reply = await callScript(conn.url, conn.key, 'ping')
      return privateJson({ ok: true, version: reply.version ?? null, latest: TRACKER_SCRIPT_VERSION })
    }
    if ('url' in body) {
      const url = typeof body.url === 'string' ? body.url.trim() : ''
      if (url && !WEBAPP_URL.test(url)) throw new MonitoringInputError('Paste the Web app URL from Apps Script. It starts with https://script.google.com/macros/s/ and ends with /exec.')
      await saveConnection(accountId, userId, { url: url || null })
      return privateJson({ saved: true })
    }
    throw new MonitoringInputError('Nothing to save.')
  } catch (error) { return trackerError(error) }
}
