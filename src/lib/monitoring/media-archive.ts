// Saved copies of WhatsApp media in a private Supabase Storage bucket.
// Meta keeps incoming media for only 7 days; a saved copy stays viewable in
// the CRM until storage cleanup removes it (see storage.ts). Every function here is best-effort: archiving never
// blocks message storage or viewing, and only the server (service role)
// can read or write the bucket.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMonitoringMedia } from './media'
import { decrypt } from '@/lib/whatsapp/encryption'

export const MEDIA_BUCKET = 'monitoring-media'
export const archivePath = (accountId: string, messageId: string) => `${accountId}/${messageId}`

export async function readArchivedMedia(db: SupabaseClient, accountId: string, messageId: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
  try {
    const result = await db.storage.from(MEDIA_BUCKET).download(archivePath(accountId, messageId))
    if (result.error || !result.data) return null
    const type = (result.data.type || 'application/octet-stream').split(';')[0].trim().toLowerCase()
    return { bytes: new Uint8Array(await result.data.arrayBuffer()), type }
  } catch { return null }
}

/** Short-lived signed URL for a stored copy, or null when none exists. */
export async function signedArchiveUrl(db: SupabaseClient, accountId: string, messageId: string, seconds: number): Promise<string | null> {
  try {
    const result = await db.storage.from(MEDIA_BUCKET).createSignedUrl(archivePath(accountId, messageId), seconds)
    return result.error || !result.data?.signedUrl ? null : result.data.signedUrl
  } catch { return null }
}

export async function archiveMedia(db: SupabaseClient, accountId: string, messageId: string, bytes: Uint8Array, type: string) {
  try {
    await db.storage.from(MEDIA_BUCKET).upload(archivePath(accountId, messageId), bytes, { contentType: type, upsert: true, cacheControl: '31536000' })
  } catch { /* Best-effort: the file can still be fetched from Meta while it exists. */ }
}

export interface ArchiveJob { channelId: string; accountId: string; metaIds: string[] }

/** Media types saved as they arrive (others are saved when someone opens them). */
export type AutoSavePolicy = (accountId: string) => Promise<{ kinds: string[]; maxBytes: number }>
const defaultPolicy: AutoSavePolicy = async () => ({ kinds: ['image', 'audio', 'sticker'], maxBytes: 16 * 1024 * 1024 })

/** Copies newly delivered media into storage. Runs after the webhook response. */
export async function archiveDeliveredMedia(db: SupabaseClient, jobs: ArchiveJob[], limit = 25, policy: AutoSavePolicy = defaultPolicy) {
  let done = 0
  const policies = new Map<string, Awaited<ReturnType<AutoSavePolicy>>>()
  for (const job of jobs) {
    if (done >= limit) return
    if (!policies.has(job.accountId)) policies.set(job.accountId, await policy(job.accountId))
    const { kinds, maxBytes } = policies.get(job.accountId)!
    if (!kinds.length) continue
    const credential = await db.from('monitoring_credentials').select('encrypted_token').eq('channel_id', job.channelId).maybeSingle()
    if (credential.error || !credential.data) continue
    let token: string
    try { token = decrypt(credential.data.encrypted_token) } catch { continue }
    for (let i = 0; i < job.metaIds.length && done < limit; i += 100) {
      const rows = await db.from('monitoring_messages').select('id,media_id').eq('channel_id', job.channelId).in('meta_id', job.metaIds.slice(i, i + 100)).in('kind', kinds).not('media_id', 'is', null)
      if (rows.error) break
      for (const row of rows.data ?? []) {
        if (done >= limit) return
        done++
        try {
          if (await signedArchiveUrl(db, job.accountId, row.id, 60)) continue
          const { bytes, type } = await fetchMonitoringMedia(row.media_id, token)
          if (bytes.byteLength <= maxBytes) await archiveMedia(db, job.accountId, row.id, bytes, type)
        } catch { /* Expired, unsupported or inaccessible media stays as-is. */ }
      }
    }
  }
}

// Catch-up for media that was not saved when it arrived (for example while a
// number's Meta access was being replaced). Meta only keeps media for a short
// time, so this runs often but does little: at most once every few minutes per
// server, a small batch, and it skips items that already failed recently.
const CATCH_UP_EVERY_MS = 5 * 60 * 1000
const RETRY_FAILED_AFTER_MS = 6 * 60 * 60 * 1000
const CATCH_UP_DAYS = 8
let lastCatchUp = 0
const recentFailures = new Map<string, number>()

async function archivedIds(db: SupabaseClient, accountId: string): Promise<Set<string> | null> {
  const names = new Set<string>()
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const page = await db.storage.from(MEDIA_BUCKET).list(accountId, { limit: 1000, offset })
    if (page.error) return null
    for (const object of page.data ?? []) names.add(object.name)
    if ((page.data?.length ?? 0) < 1000) break
  }
  return names
}

/** Saves recent photos and other auto-saved media that have no stored copy yet. */
export async function archiveMissingMedia(db: SupabaseClient, policy: AutoSavePolicy = defaultPolicy, limit = 20, now = Date.now()): Promise<{ saved: number; failed: number }> {
  const result = { saved: 0, failed: 0 }
  if (now - lastCatchUp < CATCH_UP_EVERY_MS) return result
  lastCatchUp = now
  const since = new Date(now - CATCH_UP_DAYS * 86_400_000).toISOString()
  const recent = await db.from('monitoring_messages').select('id,account_id,channel_id,media_id,kind').gte('sent_at', since).not('media_id', 'is', null).in('kind', ['image', 'sticker', 'audio', 'video', 'document']).order('sent_at', { ascending: false }).limit(1000)
  if (recent.error || !recent.data?.length) return result
  const saved = new Map<string, Set<string> | null>()
  const policies = new Map<string, Awaited<ReturnType<AutoSavePolicy>>>()
  const tokens = new Map<string, string | null>()
  for (const row of recent.data) {
    if (result.saved + result.failed >= limit) break
    if ((recentFailures.get(row.id) ?? 0) > now - RETRY_FAILED_AFTER_MS) continue
    if (!policies.has(row.account_id)) policies.set(row.account_id, await policy(row.account_id))
    const { kinds, maxBytes } = policies.get(row.account_id)!
    if (!kinds.includes(row.kind)) continue
    if (!saved.has(row.account_id)) saved.set(row.account_id, await archivedIds(db, row.account_id))
    const existing = saved.get(row.account_id)
    if (!existing || existing.has(row.id)) continue
    if (!tokens.has(row.channel_id)) {
      const credential = await db.from('monitoring_credentials').select('encrypted_token').eq('channel_id', row.channel_id).maybeSingle()
      let token: string | null = null
      try { if (credential.data) token = decrypt(credential.data.encrypted_token) } catch { token = null }
      tokens.set(row.channel_id, token)
    }
    const token = tokens.get(row.channel_id)
    if (!token) continue
    try {
      const { bytes, type } = await fetchMonitoringMedia(row.media_id, token)
      if (bytes.byteLength > maxBytes) { recentFailures.set(row.id, now); continue }
      await db.storage.from(MEDIA_BUCKET).upload(archivePath(row.account_id, row.id), bytes, { contentType: type, upsert: true, cacheControl: '31536000' }).then(r => { if (r.error) throw r.error })
      existing.add(row.id)
      result.saved++
    } catch {
      recentFailures.set(row.id, now)
      result.failed++
    }
  }
  if (result.saved || result.failed) console.info('[media-catch-up]', JSON.stringify(result))
  return result
}

/** Test helper. */
export function resetMediaCatchUp() { lastCatchUp = 0; recentFailures.clear() }
