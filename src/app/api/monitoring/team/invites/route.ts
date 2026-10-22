import { generateInviteToken, inviteExpiresAt, inviteUrl } from '@/lib/auth/invitations'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { requireMonitoring } from '@/lib/monitoring/team-access'
import { accessInput, channelInput, ownRole, teamEmail } from '@/lib/monitoring/team'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export const runtime = 'nodejs'
const INVITE_DAYS = 7

/**
 * Invite a colleague by email (@digitalnumera.com only). Returns a one-time
 * join link to send them; it works only when they sign in with that email.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireMonitoring('full')
    const limit = checkRateLimit(`team-invite:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await readJson(request)
    const email = teamEmail(body.email)
    const access = accessInput(body.access)
    const db = monitoringAdmin()
    const role = access === 'admin' ? null : await ownRole(db, accountId, access)
    const channels = access === 'admin' ? null : await channelInput(db, accountId, body.channel_ids)

    const member = await db.from('profiles').select('user_id').eq('account_id', accountId).ilike('email', email.replace(/[\\%_]/g, '\\$&')).limit(1)
    if (member.error) throw member.error
    if (member.data?.length) return privateJson({ error: 'This person is already on your team. Change their access in the members list instead.' }, 409)

    // One live invitation per email: a new invite replaces the previous link.
    const previous = await db.from('monitoring_invites').select('invitation_id').eq('account_id', accountId).eq('email', email)
    if (previous.error) throw previous.error
    if (previous.data?.length) {
      const removed = await db.from('account_invitations').delete().eq('account_id', accountId).is('accepted_at', null).in('id', previous.data.map(p => p.invitation_id))
      if (removed.error) throw removed.error
    }

    const { token, hash } = generateInviteToken()
    const expires = inviteExpiresAt(INVITE_DAYS)
    const invitation = await db.from('account_invitations').insert({
      account_id: accountId, token_hash: hash, role: access === 'admin' ? 'admin' : 'viewer',
      created_by_user_id: userId, label: email, expires_at: expires.toISOString(),
    }).select('id,expires_at').single()
    if (invitation.error) throw invitation.error
    const bound = await db.from('monitoring_invites').insert({ invitation_id: invitation.data.id, account_id: accountId, email, role_id: role?.id ?? null, channel_ids: channels })
    if (bound.error) {
      await db.from('account_invitations').delete().eq('id', invitation.data.id)
      throw bound.error
    }
    const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || request.headers.get('origin') || new URL(request.url).origin
    return privateJson({ invite: { id: invitation.data.id, email, role_id: role?.id ?? null, channel_ids: channels, expires_at: invitation.data.expires_at }, url: inviteUrl(token, base) }, 201)
  } catch (error) { return monitoringError(error) }
}
