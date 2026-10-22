import { monitoringAdmin } from '@/lib/monitoring/admin'
import { monitoringError, privateJson } from '@/lib/monitoring/http'
import { requireMonitoring } from '@/lib/monitoring/team-access'
import { allowedTeamDomain } from '@/lib/monitoring/team'

export const runtime = 'nodejs'

type AccessRow = { user_id: string; role_id: string; channel_ids: string[] | null }
type InviteRow = { invitation_id: string; email: string; role_id: string | null; channel_ids: string[] | null; account_invitations: { expires_at: string; accepted_at: string | null; created_at: string } | { expires_at: string; accepted_at: string | null; created_at: string }[] | null }

/** Team & roles overview (owners and admins only). */
export async function GET() {
  try {
    const { accountId, userId } = await requireMonitoring('full')
    const db = monitoringAdmin()
    const [roles, profiles, access, invites] = await Promise.all([
      db.from('monitoring_roles').select('id,name,description,permissions,created_at').eq('account_id', accountId).order('name'),
      db.from('profiles').select('user_id,full_name,email,account_role').eq('account_id', accountId),
      db.from('monitoring_member_access').select('user_id,role_id,channel_ids').eq('account_id', accountId),
      db.from('monitoring_invites').select('invitation_id,email,role_id,channel_ids,account_invitations(expires_at,accepted_at,created_at)').eq('account_id', accountId),
    ])
    if (roles.error && ['PGRST205', '42P01'].includes(roles.error.code)) return privateJson({ ready: false, roles: [], members: [], invites: [], domain: allowedTeamDomain() })
    for (const result of [roles, profiles, access, invites]) if (result.error) throw result.error
    const grants = new Map((access.data as AccessRow[]).map(row => [row.user_id, row]))
    const rank: Record<string, number> = { owner: 0, admin: 1, agent: 2, viewer: 3 }
    const members = (profiles.data ?? []).map(p => {
      const grant = grants.get(p.user_id)
      const full = p.account_role === 'owner' || p.account_role === 'admin'
      return { user_id: p.user_id, name: p.full_name || p.email || 'Team member', email: p.email, account_role: p.account_role, full, role_id: full ? null : grant?.role_id ?? null, channel_ids: full ? null : grant?.channel_ids ?? null, you: p.user_id === userId }
    }).sort((a, b) => (rank[a.account_role] ?? 9) - (rank[b.account_role] ?? 9) || a.name.localeCompare(b.name))
    const now = Date.now()
    const pending = (invites.data as InviteRow[]).flatMap(row => {
      const inv = Array.isArray(row.account_invitations) ? row.account_invitations[0] : row.account_invitations
      if (!inv || inv.accepted_at || Date.parse(inv.expires_at) <= now) return []
      return [{ id: row.invitation_id, email: row.email, role_id: row.role_id, channel_ids: row.channel_ids, expires_at: inv.expires_at, created_at: inv.created_at }]
    })
    const counts = new Map<string, number>()
    for (const m of members) if (m.role_id) counts.set(m.role_id, (counts.get(m.role_id) ?? 0) + 1)
    return privateJson({ ready: true, domain: allowedTeamDomain(), roles: (roles.data ?? []).map(r => ({ ...r, members: counts.get(r.id) ?? 0 })), members, invites: pending })
  } catch (error) { return monitoringError(error) }
}
