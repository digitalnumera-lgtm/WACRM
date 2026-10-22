// Media storage housekeeping for the Supabase free plan.
//
// WhatsApp deletes incoming media from its servers 7 days after delivery, so
// the CRM saves small, high-value media (photos, voice notes, stickers) as it
// arrives; larger files (videos, documents) are saved when someone opens them.
// Saved copies behave like a cache: opening a chat refreshes its media, and
// cleanup removes the least recently used files first, only when usage passes
// the cap, plus (optionally) files from chats nobody opened for N days.
// Files are always removed through the Storage API, never with SQL.
import type { SupabaseClient } from '@supabase/supabase-js'
import { monitoringAdmin } from './admin'
import { MEDIA_BUCKET } from './media-archive'

export const AUTO_SAVE_KINDS = ['image', 'audio', 'sticker', 'video', 'document'] as const
export type AutoSaveKind = typeof AUTO_SAVE_KINDS[number]

export interface StorageSettings {
  cap_mb: number
  /** null = off. */
  idle_days: number | null
  auto_save: AutoSaveKind[]
  last_cleanup_at: string | null
  last_cleanup: { removed: number; bytes: number; idle: number; cap: number; at: string } | null
}

export const DEFAULT_STORAGE: StorageSettings = { cap_mb: 800, idle_days: null, auto_save: ['image', 'audio', 'sticker'], last_cleanup_at: null, last_cleanup: null }
/** Cleanup runs at most this often per company when triggered by new messages. */
export const CLEANUP_INTERVAL_MINUTES = 60
/** Auto-saved files above this size are left for on-open saving. */
export const AUTO_SAVE_MAX_BYTES = 16 * 1024 * 1024

export async function readStorageSettings(db: SupabaseClient, accountId: string): Promise<StorageSettings> {
  const result = await db.from('monitoring_storage_settings').select('cap_mb,idle_days,auto_save,last_cleanup_at,last_cleanup').eq('account_id', accountId).maybeSingle()
  // Not installed yet or no row: the defaults apply.
  if (result.error || !result.data) return { ...DEFAULT_STORAGE }
  const row = result.data as Partial<StorageSettings>
  return {
    cap_mb: typeof row.cap_mb === 'number' ? row.cap_mb : DEFAULT_STORAGE.cap_mb,
    idle_days: typeof row.idle_days === 'number' ? row.idle_days : null,
    auto_save: Array.isArray(row.auto_save) ? row.auto_save.filter((k): k is AutoSaveKind => (AUTO_SAVE_KINDS as readonly string[]).includes(k)) : DEFAULT_STORAGE.auto_save,
    last_cleanup_at: row.last_cleanup_at ?? null,
    last_cleanup: row.last_cleanup ?? null,
  }
}

export async function mediaUsage(db: SupabaseClient, accountId: string): Promise<{ objects: number; bytes: number } | null> {
  const result = await db.rpc('monitoring_media_usage', { p_account: accountId })
  if (result.error) return null
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as { objects?: number | string; bytes?: number | string } | null
  return { objects: Number(row?.objects ?? 0), bytes: Number(row?.bytes ?? 0) }
}

/** Records that a conversation was opened (keeps its saved media). Best-effort. */
export async function touchThread(accountId: string, threadId: string): Promise<void> {
  try { await monitoringAdmin().rpc('monitoring_touch_thread', { p_account: accountId, p_thread: threadId }) } catch { /* Best-effort. */ }
}

export interface CleanupResult { ran: boolean; removed: number; bytes: number; idle: number; cap: number }

/**
 * Removes saved media according to the company's storage settings.
 * Without `force`, runs at most once per CLEANUP_INTERVAL_MINUTES.
 */
export async function runStorageCleanup(db: SupabaseClient, accountId: string, { force = false, maxFiles = 2000 } = {}): Promise<CleanupResult> {
  const none = { ran: false, removed: 0, bytes: 0, idle: 0, cap: 0 }
  const claim = await db.rpc('monitoring_claim_cleanup', { p_account: accountId, p_min_minutes: force ? 0 : CLEANUP_INTERVAL_MINUTES })
  if (claim.error || claim.data !== true) return none
  const settings = await readStorageSettings(db, accountId)
  const totals = { ran: true, removed: 0, bytes: 0, idle: 0, cap: 0 }
  // Each pass returns up to 500 files; repeat until nothing is left to remove.
  while (totals.removed < maxFiles) {
    const candidates = await db.rpc('monitoring_media_cleanup_candidates', {
      p_account: accountId, p_idle_days: settings.idle_days, p_cap_bytes: settings.cap_mb * 1024 * 1024, p_limit: 500,
    })
    const rows = (candidates.error ? [] : candidates.data ?? []) as { name: string; bytes: number | string; reason: 'idle' | 'cap' }[]
    // Defence in depth: only ever remove this company's files.
    const own = rows.filter(row => typeof row.name === 'string' && row.name.startsWith(`${accountId}/`))
    if (!own.length) break
    let removedThisPass = 0
    for (let i = 0; i < own.length; i += 100) {
      const chunk = own.slice(i, i + 100)
      const result = await db.storage.from(MEDIA_BUCKET).remove(chunk.map(row => row.name))
      if (result.error) break
      // The API returns the removed objects; match full paths or bare names.
      const removed = new Set((result.data ?? []).map(file => file.name))
      for (const row of chunk) {
        if (!removed.has(row.name) && !removed.has(row.name.slice(accountId.length + 1))) continue
        removedThisPass++
        totals.removed++
        totals.bytes += Number(row.bytes) || 0
        totals[row.reason === 'idle' ? 'idle' : 'cap']++
      }
    }
    if (!removedThisPass) break
  }
  await db.from('monitoring_storage_settings').update({ last_cleanup: { removed: totals.removed, bytes: totals.bytes, idle: totals.idle, cap: totals.cap, at: new Date().toISOString() } }).eq('account_id', accountId)
  return totals
}
