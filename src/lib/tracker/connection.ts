// The private link to the Apps Script web app, and the cached Sheet copy.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { isRawSnapshot, type RawSnapshot } from './model'

export const WEBAPP_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/
const FRESH_MS = 60_000
const TIMEOUT_MS = 30_000

export class TrackerConnectionError extends Error {
  constructor(public code: 'not_connected' | 'bad_key' | 'unreachable' | 'script_error' | 'bad_reply', message: string) { super(message) }
}

export interface ConnectionInfo { url: string | null; hasKey: boolean; updatedAt: string | null; ready: boolean }

export async function readConnection(accountId: string): Promise<{ url: string | null; key: string | null; updatedAt: string | null; ready: boolean }> {
  const row = await monitoringAdmin().from('tracker_connection').select('webapp_url,encrypted_key,updated_at').eq('account_id', accountId).maybeSingle()
  if (row.error) {
    if (['PGRST205', '42P01'].includes(row.error.code ?? '')) return { url: null, key: null, updatedAt: null, ready: false }
    throw row.error
  }
  let key: string | null = null
  try { key = row.data?.encrypted_key ? decrypt(row.data.encrypted_key) : null } catch { key = null }
  return { url: row.data?.webapp_url ?? null, key, updatedAt: row.data?.updated_at ?? null, ready: true }
}

export const newTrackerKey = () => randomBytes(24).toString('base64url')

export async function saveConnection(accountId: string, userId: string, patch: { url?: string | null; key?: string }) {
  const current = await readConnection(accountId)
  const row = {
    account_id: accountId, updated_by: userId, updated_at: new Date().toISOString(),
    webapp_url: patch.url !== undefined ? patch.url : current.url,
    encrypted_key: patch.key ? encrypt(patch.key) : current.key ? encrypt(current.key) : null,
  }
  const saved = await monitoringAdmin().from('tracker_connection').upsert(row, { onConflict: 'account_id' })
  if (saved.error) throw saved.error
  inflight.delete(accountId)
  memory.delete(accountId)
}

/** Calls the Apps Script web app. The key travels in the body, never in the URL. */
export async function callScript(url: string, key: string, action: string, extra: Record<string, unknown> = {}, timeout = TIMEOUT_MS): Promise<Record<string, unknown>> {
  if (!WEBAPP_URL.test(url)) throw new TrackerConnectionError('not_connected', 'The web app link is not a Google Apps Script link.')
  let response: Response
  try {
    // Apps Script answers a POST with a redirect to the result, which fetch follows as a GET.
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...extra, key, action }), redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(timeout) })
  } catch { throw new TrackerConnectionError('unreachable', 'Google did not answer. Try again in a moment.') }
  const text = await response.text()
  let body: Record<string, unknown>
  try { body = JSON.parse(text) } catch {
    // Google's own error page: keep its headline (never script data) so the cause is visible.
    const said = googleError(text)
    console.warn('[tracker] non-JSON reply', JSON.stringify({ action, status: response.status, said }))
    if (/sign in|accounts\.google/i.test(text)) throw new TrackerConnectionError('bad_reply', 'Google asked for a sign-in: set the deployment to Who has access: Anyone, then deploy a new version.')
    if (/not found: doPost|function not found/i.test(said)) throw new TrackerConnectionError('bad_reply', 'The deployed script has no doPost: paste the full crm-connect script, save and deploy a new version.')
    throw new TrackerConnectionError('bad_reply', said
      ? `Google could not run the script: "${said}". Try Refresh again in a minute; if it repeats, deploy a new version.`
      : response.ok ? 'The web app did not answer with data. Check it is deployed with access "Anyone" and the link ends in /exec.'
        : `Google answered with an error (${response.status}). Check the web app link and that it is deployed.`)
  }
  if (body.ok !== true) {
    if (body.error === 'unknown_action') throw new TrackerConnectionError('script_error', 'The script file is out of date. Copy the latest script from Clients → Settings, paste it over crm-connect and deploy a new version.')
    if (body.error === 'bad_key') throw new TrackerConnectionError('bad_key', 'The script rejected the key. Paste the current key into the script, save, and deploy a new version.')
    throw new TrackerConnectionError('script_error', typeof body.message === 'string' ? `The script hit an error: ${body.message}` : 'The script could not read the Sheet.')
  }
  return body
}

const inflight = new Map<string, Promise<{ raw: RawSnapshot; fetchedAt: string }>>()
const memory = new Map<string, { raw: RawSnapshot; fetchedAt: string }>()
function remember(accountId: string, raw: RawSnapshot, fetchedAt: string) {
  if (memory.size > 100) memory.clear()
  const known = memory.get(accountId)
  if (!known || known.fetchedAt <= fetchedAt) memory.set(accountId, { raw, fetchedAt })
}
/** Forget the in-memory copy (tests, or after the connection changes). */
export function forgetSnapshot(accountId?: string) { if (accountId) memory.delete(accountId); else memory.clear() }

/**
 * The Sheet copy: reused for a minute, then fetched again. When Google cannot
 * be reached the last copy is returned with `stale` set.
 */
export async function getSnapshot(accountId: string, { force = false } = {}): Promise<{ raw: RawSnapshot; fetchedAt: string; stale?: string }> {
  // A fresh copy in this server's memory needs no database trip (the database is far away).
  const local = memory.get(accountId)
  if (local && !force && Date.now() - Date.parse(local.fetchedAt) < FRESH_MS) return local
  const db = monitoringAdmin()
  const cached = await db.from('tracker_snapshot').select('data,fetched_at').eq('account_id', accountId).maybeSingle()
  if (cached.error && !['PGRST205', '42P01'].includes(cached.error.code ?? '')) throw cached.error
  const have = cached.data && isRawSnapshot(cached.data.data) ? { raw: cached.data.data as RawSnapshot, fetchedAt: cached.data.fetched_at as string } : null
  if (have) remember(accountId, have.raw, have.fetchedAt)
  if (have && !force && Date.now() - Date.parse(have.fetchedAt) < FRESH_MS) return have
  let job = inflight.get(accountId)
  if (!job) {
    job = (async () => {
      const conn = await readConnection(accountId)
      if (!conn.url || !conn.key) throw new TrackerConnectionError('not_connected', 'The Google Sheet is not connected yet.')
      const body = await callScript(conn.url, conn.key, 'snapshot', {}, 90_000)
      if (!isRawSnapshot(body.snapshot)) throw new TrackerConnectionError('bad_reply', 'The script answered without Sheet data. Update the script file to the latest version.')
      const fetchedAt = await storeSnapshot(accountId, body.snapshot)
      return { raw: body.snapshot, fetchedAt }
    })().finally(() => inflight.delete(accountId))
    inflight.set(accountId, job)
  }
  try { return await job }
  catch (error) {
    if (have && error instanceof TrackerConnectionError) return { ...have, stale: error.message }
    throw error
  }
}

/** Saves a Sheet copy the script returned after a change. */
export async function storeSnapshot(accountId: string, snapshot: RawSnapshot): Promise<string> {
  const db = monitoringAdmin()
  const fetchedAt = new Date().toISOString()
  remember(accountId, snapshot, fetchedAt)
  const hash = snapshotHash(snapshot)
  // Same content as last time: only the time is updated (a tiny write instead of the whole copy).
  const same = await db.from('tracker_snapshot').update({ fetched_at: fetchedAt }).eq('account_id', accountId).eq('data_hash', hash).select('account_id')
  if (!same.error && (same.data?.length ?? 0) > 0) return fetchedAt
  const saved = await db.from('tracker_snapshot').upsert({ account_id: accountId, data: snapshot, fetched_at: fetchedAt, data_hash: hash }, { onConflict: 'account_id' })
  if (saved.error) throw saved.error
  return fetchedAt
}

/** Fingerprint of the Sheet copy without its timestamp: unchanged copies are not written again. */
export function snapshotHash(snapshot: RawSnapshot): string {
  const { generatedAt: _ignored, ...rest } = snapshot // eslint-disable-line @typescript-eslint/no-unused-vars
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex')
}

/** The company whose script sent this key, or null. */
export async function accountForKey(key: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(key)) return null
  const rows = await monitoringAdmin().from('tracker_connection').select('account_id,encrypted_key').not('encrypted_key', 'is', null)
  if (rows.error) return null
  const given = Buffer.from(key)
  for (const row of rows.data ?? []) {
    let stored: string
    try { stored = decrypt(row.encrypted_key as string) } catch { continue }
    const want = Buffer.from(stored)
    if (want.length === given.length && timingSafeEqual(want, given)) return row.account_id as string
  }
  return null
}

/** The headline of a Google error page (title or first message line), at most 160 characters. */
export function googleError(html: string): string {
  const pick = /<div[^>]*class="[^"]*errorMessage[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''
  return pick.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 160)
}
