// Per-user CRM preferences, stored in the user's Supabase Auth metadata.

export interface Preferences {
  theme: 'light' | 'dark' | 'system'
  density: 'comfortable' | 'compact'
  defaultTab: 'open' | 'waiting' | 'unread' | 'all'
  defaultSort: 'latest' | 'oldest'
  timeFormat: '12h' | '24h'
  chatSize: 'small' | 'medium' | 'large'
  sound: boolean
  notify: boolean
  contactPanel: boolean
  pinned: string[]
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'light', density: 'comfortable', defaultTab: 'open', defaultSort: 'latest',
  timeFormat: '12h', chatSize: 'medium', sound: true, notify: false, contactPanel: true, pinned: [],
}

const choices: { [K in keyof Preferences]?: readonly Preferences[K][] } = {
  theme: ['light', 'dark', 'system'], density: ['comfortable', 'compact'], defaultTab: ['open', 'waiting', 'unread', 'all'],
  defaultSort: ['latest', 'oldest'], timeFormat: ['12h', '24h'], chatSize: ['small', 'medium', 'large'],
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_PINNED = 30

/** Keeps only known keys and allowed values; anything else falls back to the default. */
export function sanitizePreferences(value: unknown): Preferences {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const out = { ...DEFAULT_PREFERENCES }
  for (const [key, allowed] of Object.entries(choices) as [keyof Preferences, readonly unknown[]][]) {
    if (allowed.includes(input[key])) (out as Record<string, unknown>)[key] = input[key]
  }
  if (typeof input.sound === 'boolean') out.sound = input.sound
  if (typeof input.notify === 'boolean') out.notify = input.notify
  if (typeof input.contactPanel === 'boolean') out.contactPanel = input.contactPanel
  if (Array.isArray(input.pinned)) out.pinned = [...new Set(input.pinned.filter((id): id is string => typeof id === 'string' && uuid.test(id)))].slice(0, MAX_PINNED)
  return out
}
