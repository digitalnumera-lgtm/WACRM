import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertOperationalMode, blockedMonitoringPath, monitoringOnly } from './policy'

afterEach(() => vi.unstubAllEnvs())
describe('monitoring-only policy', () => {
  it('fails closed by default and on malformed configuration', () => {
    for (const value of [undefined, 'true', '', 'FALSE', '0']) {
      vi.stubEnv('NUMERA_MONITORING_ONLY', value)
      expect(monitoringOnly()).toBe(true)
      expect(assertOperationalMode).toThrow('Disabled')
    }
  })
  it('allows explicit legacy mode', () => {
    vi.stubEnv('NUMERA_MONITORING_ONLY', 'false')
    expect(assertOperationalMode).not.toThrow()
  })
  it('blocks sending, configuration, public API, AI, cron and legacy webhook paths', () => {
    for (const path of ['/api/whatsapp/send', '/api/whatsapp/config', '/api/whatsapp/webhook', '/api/whatsapp/broadcast/1/resume', '/api/v1/messages', '/api/automations/cron', '/api/flows/cron', '/api/ai/draft', '/broadcasts/new', '/inbox']) {
      expect(blockedMonitoringPath(path)).toBe(true)
    }
  })
  it('leaves authentication, management and monitoring routes accessible', () => {
    for (const path of ['/login', '/auth/callback', '/api/account', '/api/monitoring/webhook', '/monitoring']) {
      expect(blockedMonitoringPath(path)).toBe(false)
    }
  })
})
