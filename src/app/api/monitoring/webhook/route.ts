import { randomUUID, timingSafeEqual } from 'node:crypto'
import { after } from 'next/server'
import { archiveDeliveredMedia } from '@/lib/monitoring/media-archive'
import { AUTO_SAVE_MAX_BYTES, readStorageSettings, runStorageCleanup } from '@/lib/monitoring/storage'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { monitoringBatches, persistMonitoringBatches } from '@/lib/monitoring/ingest'
import { privateJson, readLimitedBody } from '@/lib/monitoring/http'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const token = process.env.META_MONITORING_VERIFY_TOKEN
  if (!token) return privateJson({ error: 'Webhook verification is not configured.' }, 503)
  const params = new URL(request.url).searchParams
  const supplied = Buffer.from(params.get('hub.verify_token') ?? '')
  const expected = Buffer.from(token)
  if (params.get('hub.mode') !== 'subscribe' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return privateJson({ error: 'Verification failed.' }, 403)
  }
  const challenge = params.get('hub.challenge')
  if (!challenge || challenge.length > 1024) return privateJson({ error: 'Invalid challenge.' }, 400)
  return new Response(challenge, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  // Only server-generated IDs and fixed outcome labels enter the logs.
  // Never include request URLs/headers, payloads, identifiers or error objects.
  const requestId = randomUUID()
  const outcomes: Record<string, number> = {}
  const finish = (event: string, status: number, data: unknown) => {
    console.info('[monitoring-webhook]', JSON.stringify({ requestId, event, status, outcomes }))
    const response = privateJson(data, status)
    response.headers.set('X-Monitoring-Request-Id', requestId)
    return response
  }
  console.info('[monitoring-webhook]', JSON.stringify({ requestId, event: 'received' }))
  if (!process.env.META_APP_SECRET?.trim()) return finish('app_secret_missing', 503, { error: 'Webhook signature verification is not configured.' })
  let raw: string
  // Coexistence history chunks can be several megabytes.
  try { raw = await readLimitedBody(request, 8 * 1024 * 1024) }
  catch { return finish('body_rejected', 413, { error: 'Invalid or oversized payload.' }) }
  if (!verifyMetaWebhookSignature(raw, request.headers.get('x-hub-signature-256'))) {
    return finish('signature_rejected', 401, { error: 'Invalid signature.' })
  }
  outcomes.signature_verified = 1
  let batches
  try { batches = monitoringBatches(JSON.parse(raw)) }
  catch { return finish('payload_rejected', 400, { error: 'Invalid WhatsApp payload.' }) }
  try {
    outcomes.batches = batches.length
    const db = monitoringAdmin()
    const archive = await persistMonitoringBatches(db, batches, event => { outcomes[event] = (outcomes[event] ?? 0) + 1 })
    // Save new media to storage after Meta has its acknowledgement.
    if (archive?.length) {
      const policy = async (accountId: string) => {
        const settings = await readStorageSettings(db, accountId)
        return { kinds: settings.auto_save, maxBytes: AUTO_SAVE_MAX_BYTES }
      }
      // Save new media, then (at most hourly per company) apply storage cleanup.
      const work = async () => {
        await archiveDeliveredMedia(db, archive, 25, policy).catch(() => {})
        for (const accountId of new Set(archive.map(job => job.accountId))) await runStorageCleanup(db, accountId).catch(() => {})
      }
      try { after(work) } catch { /* No request scope (tests): skip archiving. */ }
    }
    return finish('acknowledged', 200, { received: true })
  } catch {
    // Do not return 200 before durable storage: let Meta retry the delivery.
    // Do not log payloads, signatures, credentials or customer content.
    return finish('delivery_failed', 503, { error: 'Delivery could not be stored. Please retry.' })
  }
}
