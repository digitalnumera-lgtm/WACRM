import { NextResponse } from 'next/server'
import { ForbiddenError, MfaRequiredError, UnauthorizedError } from '@/lib/auth/account'

export class MonitoringInputError extends Error {}
/** The optional inbox workflow schema (supabase/numera/001_inbox_workflow.sql) is not installed. */
export class WorkflowSchemaMissing extends Error {
  constructor() { super('This feature needs the inbox database update. Run supabase/numera/001_inbox_workflow.sql in Supabase.') }
}
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const channelColumns = 'id,account_id,phone_number_id,waba_id,label,display_number,active,last_event_at,created_at'
export const threadColumns = 'id,account_id,channel_id,customer,customer_name,lead_status,last_message_at,last_preview,last_direction,message_count'

export function pageNumber(value: string | null): number {
  const page = Number(value ?? '0')
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new MonitoringInputError('Invalid page')
  return page
}

export function checkedId(value: string): string {
  if (!uuid.test(value)) throw new MonitoringInputError('Invalid identifier')
  return value
}

export function privateJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export function monitoringError(error: unknown) {
  if (error instanceof MfaRequiredError) return privateJson({ error: error.message, code: error.code }, 401)
  if (error instanceof UnauthorizedError) return privateJson({ error: 'Sign in to continue.' }, 401)
  if (error instanceof ForbiddenError) return privateJson({ error: 'Your role does not allow this. Ask your company owner for access.' }, 403)
  if (error instanceof MonitoringInputError) return privateJson({ error: error.message }, 400)
  if (error instanceof WorkflowSchemaMissing) return privateJson({ error: error.message, code: 'workflow_schema_missing' }, 409)
  // Supabase errors can contain row values. Do not log or return them.
  return privateJson({ error: 'Monitoring is temporarily unavailable. Please try again.' }, 503)
}

export async function readJson(request: Request, limit = 16384): Promise<Record<string, unknown>> {
  assertSameOrigin(request)
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new MonitoringInputError('JSON is required')
  const text = await readLimitedBody(request, limit)
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new MonitoringInputError('Invalid JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MonitoringInputError('Invalid JSON object')
  return value as Record<string, unknown>
}

/** Rejects cross-site state changes (also used by body-less DELETE requests). */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  // Next's standalone server can construct request.url with its internal
  // hostname. The browser's Host header identifies the actual destination;
  // do not trust arbitrary X-Forwarded-Host values for this check.
  let sameHost = false
  if (origin) {
    try {
      const parsed = new URL(origin)
      sameHost = ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin && parsed.host === request.headers.get('host')
    } catch { /* Invalid/null origins are rejected below. */ }
  }
  if (origin && !sameHost && origin !== new URL(request.url).origin && origin !== process.env.NEXT_PUBLIC_SITE_URL) {
    throw new ForbiddenError()
  }
}

export async function readLimitedBody(request: Request, limit: number): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); throw new MonitoringInputError('Request is too large') }
    chunks.push(value)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
}

export function requiredText(body: Record<string, unknown>, key: string, max = 120): string {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new MonitoringInputError(`Invalid ${key.replaceAll('_', ' ')}`)
  return value.trim()
}
