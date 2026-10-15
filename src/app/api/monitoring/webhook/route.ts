import { timingSafeEqual } from 'node:crypto'
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
  if (!process.env.META_APP_SECRET?.trim()) return privateJson({ error: 'Webhook signature verification is not configured.' }, 503)
  let raw: string
  try { raw = await readLimitedBody(request, 1024 * 1024) }
  catch { return privateJson({ error: 'Invalid or oversized payload.' }, 413) }
  if (!verifyMetaWebhookSignature(raw, request.headers.get('x-hub-signature-256'))) {
    return privateJson({ error: 'Invalid signature.' }, 401)
  }
  let batches
  try { batches = monitoringBatches(JSON.parse(raw)) }
  catch { return privateJson({ error: 'Invalid WhatsApp payload.' }, 400) }
  try {
    await persistMonitoringBatches(monitoringAdmin(), batches)
    return privateJson({ received: true })
  } catch {
    // Do not return 200 before durable storage: let Meta retry the delivery.
    // Do not log payloads, signatures, credentials or customer content.
    return privateJson({ error: 'Delivery could not be stored. Please retry.' }, 503)
  }
}
