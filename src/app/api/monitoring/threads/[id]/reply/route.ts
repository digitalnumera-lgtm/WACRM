import { requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { checkedId, monitoringError, privateJson, readJson, requiredText } from '@/lib/monitoring/http'
import { managementReplyTarget, managementReplyWindow, readReplyAttempt, replyAttemptResult, sendManagementReply } from '@/lib/monitoring/management-reply'
import { checkRateLimit } from '@/lib/rate-limit'
import { managementRepliesEnabled } from '@/lib/monitoring/settings'

type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  try {
    const { supabase, accountId } = await requireMonitoring('full')
    const id = checkedId((await context.params).id)
    const target = await managementReplyTarget(supabase, accountId, id)
    if (!target) return privateJson({ error: 'Conversation not found.' }, 404)
    const enabled = await managementRepliesEnabled(monitoringAdmin(), accountId)
    const window = enabled ? await managementReplyWindow(supabase, accountId, id) : { open: false, expires_at: null }
    const requestId = new URL(request.url).searchParams.get('request_id')
    const attempt = requestId ? await readReplyAttempt(monitoringAdmin(), accountId, id, checkedId(requestId)) : null
    return privateJson({ ...window, enabled, active: target.channel.active, attempt: attempt ? replyAttemptResult(attempt) : null })
  } catch (error) { return monitoringError(error) }
}
export async function POST(request: Request, context: Context) {
  try {
    const { supabase, accountId, userId } = await requireMonitoring('full')
    const id = checkedId((await context.params).id)
    const body = await readJson(request, 32768)
    const requestId = checkedId(String(body.request_id ?? ''))
    const text = requiredText(body, 'text', 8192)
    if ([...text].length > 4096) return privateJson({ error: 'Replies must contain at most 4096 characters.' }, 400)
    const target = await managementReplyTarget(supabase, accountId, id)
    if (!target) return privateJson({ error: 'Conversation not found.' }, 404)
    if (!checkRateLimit(`management-reply:${accountId}:${userId}`, { limit: 30, windowMs: 60000 }).success) return privateJson({ error: 'Too many replies. Wait a minute and try again.' }, 429)
    const result = await sendManagementReply(monitoringAdmin(), accountId, userId, target, requestId, text)
    return privateJson(result.body, result.status)
  } catch (error) { return monitoringError(error) }
}
