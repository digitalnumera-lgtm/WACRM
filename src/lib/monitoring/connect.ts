// Embedded Signup ("Connect number") for WhatsApp Business app numbers, with
// coexistence history/contacts sync. Server-side only: the app secret and the
// exchanged business token never reach the browser.
import type { SupabaseClient } from '@supabase/supabase-js'
import { workflowId } from './workflow'

export const GRAPH = 'https://graph.facebook.com/v26.0'
// Public identifiers (not secrets). Environment variables override them.
export const META_APP_ID = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || '1121820883867005'
export const SYNC_TYPES = ['smb_app_state_sync', 'history'] as const
export type SyncType = typeof SYNC_TYPES[number]
/** Meta allows each sync once, within 24 hours of onboarding. */
export const SYNC_WINDOW_MS = 24 * 3600 * 1000

export interface SyncAttempt { ok: boolean; at: string; request_id?: string; code?: number; message?: string }
export interface ConnectionRecord {
  connected_at: string; connected_by: string; waba_id: string; phone_number_id: string; display_number: string | null
  token_source: 'embedded_signup' | 'existing'; syncs: Partial<Record<SyncType, SyncAttempt>>
}

export class ConnectError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

type MetaError = { code?: number; error_subcode?: number; message?: string }
async function metaError(response: Response): Promise<MetaError> {
  try { return ((await response.json()) as { error?: MetaError }).error ?? {} } catch { return {} }
}
const options = (init: RequestInit = {}): RequestInit => ({ cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000), ...init })

/** Exchanges the one-time Embedded Signup code (valid ~30 seconds) for a business token. */
// META_APP_SECRET may list several secrets (comma-separated, for rotation);
// the first one is the app's current secret.
function appSecret(): string {
  const secret = (process.env.META_APP_SECRET ?? '').split(',').map(s => s.trim()).find(Boolean)
  if (!secret) throw new ConnectError('The Meta app secret is not configured on the server.', 503)
  return secret
}

/**
 * Meta normally accepts the popup's code with no redirect_uri. When it finishes
 * through its "continue with previous settings" shortcut, the code is bound to
 * the page that opened it (error 100/36008), so those addresses are tried next.
 * A rejected attempt does not use up the code.
 */
export async function exchangeSignupCode(code: string, redirectUris: string[] = []): Promise<string> {
  const secret = appSecret()
  let response: Response | null = null
  for (const redirectUri of [null, ...redirectUris]) {
    const url = new URL(`${GRAPH}/oauth/access_token`)
    url.searchParams.set('client_id', META_APP_ID)
    url.searchParams.set('client_secret', secret)
    url.searchParams.set('code', code)
    if (redirectUri) url.searchParams.set('redirect_uri', redirectUri)
    response = await fetch(url, options())
    if (response.ok) break
    const error = await metaError(response.clone())
    if (error.error_subcode !== 36008) break
  }
  if (!response!.ok) {
    const error = await metaError(response!)
    // Meta's error text names the problem (expired, already used, wrong secret)
    // and contains no secrets; show it so a failed connection can be diagnosed.
    const detail = `${typeof error.message === 'string' ? error.message.slice(0, 200) : `HTTP ${response!.status}`} (code ${error.code ?? '?'}${error.error_subcode ? `/${error.error_subcode}` : ''})`
    console.error('[connect] code exchange failed:', detail)
    throw new ConnectError(`Meta rejected the sign-in: ${detail}. Please run Connect again.`, 400)
  }
  const data = await response!.json() as { access_token?: unknown }
  if (typeof data.access_token !== 'string' || !data.access_token) throw new ConnectError('Meta did not return an access token. Please run Connect again.', 502)
  return data.access_token
}

/**
 * WhatsApp accounts the signed-in business shared with this app, read from the
 * token's granular scopes. Used when Meta's popup does not report the account.
 */
export async function sharedWhatsAppAccounts(token: string): Promise<string[]> {
  const url = new URL(`${GRAPH}/debug_token`)
  url.searchParams.set('input_token', token)
  url.searchParams.set('access_token', `${META_APP_ID}|${appSecret()}`)
  const response = await fetch(url, options())
  if (!response.ok) return []
  const body = await response.json().catch(() => null) as { data?: { granular_scopes?: { scope?: string; target_ids?: unknown[] }[] } } | null
  const ids = new Set<string>()
  for (const scope of body?.data?.granular_scopes ?? []) {
    if (scope.scope !== 'whatsapp_business_management' && scope.scope !== 'whatsapp_business_messaging') continue
    for (const id of scope.target_ids ?? []) if (typeof id === 'string' && /^\d+$/.test(id)) ids.add(id)
  }
  return [...ids]
}

/** Requests the one-time contacts or chat-history sync for a coexistence number. */
export async function requestSync(phoneNumberId: string, token: string, type: SyncType): Promise<SyncAttempt> {
  const at = new Date().toISOString()
  try {
    const response = await fetch(`${GRAPH}/${phoneNumberId}/smb_app_data`, options({
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: type }),
    }))
    if (!response.ok) {
      const error = await metaError(response)
      // Meta's error text describes the request, not secrets; keep it short.
      return { ok: false, at, code: error.code, message: typeof error.message === 'string' ? error.message.slice(0, 240) : `Meta returned ${response.status}` }
    }
    const data = await response.json().catch(() => ({})) as { request_id?: unknown }
    return { ok: true, at, ...(typeof data.request_id === 'string' ? { request_id: data.request_id } : {}) }
  } catch {
    return { ok: false, at, message: 'Meta could not be reached. Retry shortly.' }
  }
}

export const connectionEventId = (accountId: string, channelId: string) => workflowId(accountId, `connection:${channelId}`)

export async function readConnection(db: SupabaseClient, accountId: string, channelId: string): Promise<ConnectionRecord | null> {
  const result = await db.from('monitoring_events').select('payload').eq('account_id', accountId).eq('id', connectionEventId(accountId, channelId)).maybeSingle()
  if (result.error) throw new Error('Connection lookup failed')
  return (result.data?.payload as ConnectionRecord | undefined) ?? null
}

export async function writeConnection(db: SupabaseClient, accountId: string, channelId: string, record: ConnectionRecord) {
  const id = connectionEventId(accountId, channelId)
  const result = await db.from('monitoring_events').upsert({
    id, account_id: accountId, channel_id: channelId, event_hash: id, field: 'management_connection', needs_review: false, payload: record,
  }, { onConflict: 'id' })
  if (result.error) throw new Error('Connection record failed')
}

/** A sync can be (re)requested only while Meta's 24-hour window is open and it has not already succeeded. */
export function canRequestSync(record: ConnectionRecord | null, type: SyncType, now = Date.now()) {
  if (!record) return false
  if (record.syncs[type]?.ok) return false
  return now - Date.parse(record.connected_at) < SYNC_WINDOW_MS
}

export interface HistoryProgress {
  chunks: number; messages: number; progress: number | null; phases: number[]; declined: boolean
  contacts: number; last_received_at: string | null
}

/** Aggregates the compact sync summaries stored in the event ledger. */
export function historyProgress(rows: { field: string; payload: unknown; received_at: string }[]): HistoryProgress {
  const out: HistoryProgress = { chunks: 0, messages: 0, progress: null, phases: [], declined: false, contacts: 0, last_received_at: null }
  for (const row of rows) {
    const value = ((row.payload ?? {}) as { value?: Record<string, unknown> }).value ?? {}
    if (!out.last_received_at || row.received_at > out.last_received_at) out.last_received_at = row.received_at
    if (row.field === 'smb_app_state_sync') { out.contacts += Number(value.received) || 0; continue }
    if (value.declined === true) out.declined = true
    out.messages += Number(value.messages) || 0
    for (const chunk of Array.isArray(value.chunks) ? value.chunks as Record<string, unknown>[] : []) {
      out.chunks++
      const progress = Number(chunk.progress)
      if (chunk.progress !== null && Number.isFinite(progress)) out.progress = Math.max(out.progress ?? 0, Math.min(100, progress))
      const phase = Number(chunk.phase)
      if (chunk.phase !== null && Number.isInteger(phase) && !out.phases.includes(phase)) out.phases.push(phase)
    }
  }
  out.phases.sort()
  return out
}
