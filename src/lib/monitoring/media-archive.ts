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
