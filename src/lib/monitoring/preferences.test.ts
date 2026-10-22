import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, MAX_PINNED, sanitizePreferences } from './preferences'

describe('sanitizePreferences', () => {
  it('falls back to defaults for missing or unknown values', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(sanitizePreferences({ theme: 'neon', density: 'compact', sound: 'yes', notify: 1, admin: true })).toEqual({ ...DEFAULT_PREFERENCES, density: 'compact' })
  })
  it('accepts only known styles', () => {
    expect(sanitizePreferences({ style: 'lavender' }).style).toBe('lavender')
    expect(sanitizePreferences({ style: 'url(javascript:alert(1))' }).style).toBe('numera')
  })
  it('keeps valid choices and de-duplicates pinned conversation IDs', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const prefs = sanitizePreferences({ theme: 'dark', timeFormat: '24h', chatSize: 'large', sound: false, notify: true, contactPanel: false, pinned: [id, id, 'not-an-id'] })
    expect(prefs).toMatchObject({ theme: 'dark', timeFormat: '24h', chatSize: 'large', sound: false, notify: true, contactPanel: false, pinned: [id] })
  })
  it('caps the number of pinned conversations', () => {
    const ids = Array.from({ length: MAX_PINNED + 5 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`)
    expect(sanitizePreferences({ pinned: ids }).pinned).toHaveLength(MAX_PINNED)
  })
})
