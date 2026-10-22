'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { can, type MonitoringMe, type Permission } from '@/lib/monitoring/permissions'

// The signed-in user's CRM access, so any panel can hide what the user's role
// does not allow. The server enforces the same rules on every request.
const AccessContext = createContext<MonitoringMe | null>(null)

export function AccessProvider({ me, children }: { me: MonitoringMe; children: ReactNode }) {
  return <AccessContext.Provider value={me}>{children}</AccessContext.Provider>
}

/** Owners/admins get everything; outside a provider (tests, previews) everything is allowed. */
export function useCan(permission: Permission | 'full'): boolean {
  const me = useContext(AccessContext)
  if (!me) return true
  return permission === 'full' ? me.full : can(me, permission)
}

export function useMe(): MonitoringMe | null {
  return useContext(AccessContext)
}
