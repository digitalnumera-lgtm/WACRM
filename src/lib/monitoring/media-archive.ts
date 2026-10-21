// Permanent copies of WhatsApp media in a private Supabase Storage bucket.
// Meta keeps media only for a limited time; once archived, a file stays
// viewable in the CRM. Every function here is best-effort: archiving never
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

export async function archiveMedia(db: SupabaseClient, accountId: string, messageId: string, bytes: Uint8Array, type: string) {
  try {
    await db.storage.from(MEDIA_BUCKET).upload(archivePath(accountId, messageId), bytes, { contentType: type, upsert: true, cacheControl: '0' })
  } catch { /* Best-effort: the file can still be fetched from Meta while it exists. */ }
}

export interface ArchiveJob { channelId: string; accountId: string; metaIds: string[] }

/** Copies newly delivered media into storage. Runs after the webhook response. */
export async function archiveDeliveredMedia(db: SupabaseClient, jobs: ArchiveJob[], limit = 25) {
  let done = 0
  for (const job of jobs) {
    if (done >= limit) return
    const credential = await db.from('monitoring_credentials').select('encrypted_token').eq('channel_id', job.channelId).maybeSingle()
    if (credential.error || !credential.data) continue
    let token: string
    try { token = decrypt(credential.data.encrypted_token) } catch { continue }
    for (let i = 0; i < job.metaIds.length && done < limit; i += 100) {
      const rows = await db.from('monitoring_messages').select('id,media_id').eq('channel_id', job.channelId).in('meta_id', job.metaIds.slice(i, i + 100)).not('media_id', 'is', null)
      if (rows.error) break
      for (const row of rows.data ?? []) {
        if (done >= limit) return
        done++
        try {
          if (await readArchivedMedia(db, job.accountId, row.id)) continue
          const { bytes, type } = await fetchMonitoringMedia(row.media_id, token)
          await archiveMedia(db, job.accountId, row.id, bytes, type)
        } catch { /* Expired, unsupported or inaccessible media stays as-is. */ }
      }
    }
  }
}
