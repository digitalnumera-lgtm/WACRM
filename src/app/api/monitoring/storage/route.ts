import { monitoringAdmin } from '@/lib/monitoring/admin'
import { MonitoringInputError, monitoringError, privateJson, readJson } from '@/lib/monitoring/http'
import { requireMonitoring } from '@/lib/monitoring/team-access'
import { AUTO_SAVE_KINDS, mediaUsage, readStorageSettings, runStorageCleanup, type AutoSaveKind } from '@/lib/monitoring/storage'

export const runtime = 'nodejs'

// Supabase free plan: about 1 GB of file storage per project.
const PLAN_BYTES = 1024 * 1024 * 1024

async function snapshot(accountId: string) {
  const db = monitoringAdmin()
  const [settings, usage] = await Promise.all([readStorageSettings(db, accountId), mediaUsage(db, accountId)])
  return { settings, usage, plan_bytes: PLAN_BYTES, ready: usage !== null }
}

/** Saved-media usage and storage settings. */
export async function GET() {
  try {
    const { accountId } = await requireMonitoring('manage_settings')
    return privateJson(await snapshot(accountId))
  } catch (error) { return monitoringError(error) }
}

/** Updates storage settings and applies them straight away. */
export async function PATCH(request: Request) {
  try {
    const { accountId, userId } = await requireMonitoring('manage_settings')
    const body = await readJson(request)
    const cap = Number(body.cap_mb)
    if (!Number.isInteger(cap) || cap < 50 || cap > 100000) throw new MonitoringInputError('Choose a storage limit between 50 MB and 100,000 MB.')
    let idle: number | null = null
    if (body.idle_days !== null && body.idle_days !== undefined) {
      idle = Number(body.idle_days)
      if (!Number.isInteger(idle) || idle < 1 || idle > 365) throw new MonitoringInputError('Choose between 1 and 365 days, or turn the rule off.')
    }
    if (!Array.isArray(body.auto_save) || body.auto_save.some(kind => !(AUTO_SAVE_KINDS as readonly unknown[]).includes(kind))) throw new MonitoringInputError('Choose which media to save automatically.')
    const autoSave = [...new Set(body.auto_save as AutoSaveKind[])]
    const db = monitoringAdmin()
    const saved = await db.from('monitoring_storage_settings').upsert({ account_id: accountId, cap_mb: cap, idle_days: idle, auto_save: autoSave, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'account_id' })
    if (saved.error) throw saved.error
    const cleanup = await runStorageCleanup(db, accountId, { force: true })
    return privateJson({ ...(await snapshot(accountId)), cleanup })
  } catch (error) { return monitoringError(error) }
}

/** "Clean up now". */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireMonitoring('manage_settings')
    await readJson(request)
    const cleanup = await runStorageCleanup(monitoringAdmin(), accountId, { force: true })
    return privateJson({ ...(await snapshot(accountId)), cleanup })
  } catch (error) { return monitoringError(error) }
}
