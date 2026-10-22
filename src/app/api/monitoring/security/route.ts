import { UnauthorizedError, verifiedIdentity } from '@/lib/auth/account'
import { createClient } from '@/lib/supabase/server'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { assertSameOrigin, monitoringError, privateJson } from '@/lib/monitoring/http'

/**
 * Records whether the caller has two-step sign-in turned on, from Supabase's
 * own factor list. The flag lives in app_metadata (server-only) and is checked
 * on every request, so a password alone is not enough once it is on. Works
 * mid-sign-in too, so turning it off never locks anyone out.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const identity = await verifiedIdentity(await createClient())
    if (!identity) throw new UnauthorizedError()
    const admin = monitoringAdmin()
    const factors = await admin.auth.admin.mfa.listFactors({ userId: identity.userId })
    if (factors.error) throw factors.error
    const enabled = (factors.data?.factors ?? []).some(f => f.status === 'verified')
    const saved = await admin.auth.admin.updateUserById(identity.userId, { app_metadata: { mfa_enabled: enabled } })
    if (saved.error) throw saved.error
    return privateJson({ enabled })
  } catch (error) { return monitoringError(error) }
}
