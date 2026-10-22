import { after } from 'next/server'
import { privateJson, readLimitedBody } from '@/lib/monitoring/http'
import { accountForKey, getSnapshot } from '@/lib/tracker/connection'

export const runtime = 'nodejs'
export const maxDuration = 120

const recent = new Map<string, number>()

/**
 * Called by the connection script after a form answer or a Sheet edit. It
 * carries only the key; the CRM then fetches the new Sheet copy itself.
 */
export async function POST(request: Request) {
  let key = ''
  try { key = String((JSON.parse(await readLimitedBody(request, 2048)) as { key?: unknown }).key ?? '') } catch { return privateJson({ error: 'Invalid request.' }, 400) }
  const accountId = await accountForKey(key)
  if (!accountId) return privateJson({ error: 'Unknown key.' }, 401)
  const last = recent.get(accountId) ?? 0
  if (Date.now() - last < 10_000) return privateJson({ ok: true, queued: false })
  recent.set(accountId, Date.now())
  const refresh = () => getSnapshot(accountId, { force: true }).then(() => undefined, () => undefined)
  try { after(refresh) } catch { void refresh() }
  return privateJson({ ok: true, queued: true })
}
