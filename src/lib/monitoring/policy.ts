/** Numera is monitoring-only by default. Legacy operation is explicit opt-in. */
export function monitoringOnly(): boolean {
  return process.env.NUMERA_MONITORING_ONLY !== 'false'
}

const disabledPages = ['/inbox', '/broadcasts', '/automations', '/flows', '/agents']
const disabledApis = ['/api/whatsapp', '/api/ai', '/api/automations', '/api/flows', '/api/v1']

export function blockedMonitoringPath(pathname: string): boolean {
  return [...disabledPages, ...disabledApis].some(path => pathname === path || pathname.startsWith(`${path}/`))
}

export function assertOperationalMode(): void {
  if (monitoringOnly()) throw new Error('Disabled in monitoring-only mode')
}
