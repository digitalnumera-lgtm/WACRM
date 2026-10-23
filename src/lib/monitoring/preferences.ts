// Per-user CRM preferences, stored in the user's Supabase Auth metadata.

export const STYLES = ['numera', 'lavender', 'blue', 'glass', 'ios', 'mono', 'sky'] as const
export type CrmStyle = typeof STYLES[number]

export interface Preferences {
  theme: 'light' | 'dark' | 'system'
  style: CrmStyle
  density: 'comfortable' | 'compact'
  defaultTab: 'open' | 'waiting' | 'unread' | 'all'
  defaultSort: 'latest' | 'oldest'
  timeFormat: '12h' | '24h'
  chatSize: 'small' | 'medium' | 'large'
  sound: boolean
  notify: boolean
  contactPanel: boolean
  pinned: string[]
  /** Sidebar order chosen by dragging; unknown or missing pages keep their default place. */
  navOrder: string[]
  /** Width of the conversation list in pixels (dragged by its edge). */
  listWidth: number
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'light', style: 'numera', density: 'comfortable', defaultTab: 'open', defaultSort: 'latest',
  timeFormat: '12h', chatSize: 'medium', sound: true, notify: false, contactPanel: true, pinned: [], navOrder: [], listWidth: 360,
}

const choices: { [K in keyof Preferences]?: readonly Preferences[K][] } = {
  theme: ['light', 'dark', 'system'], style: STYLES, density: ['comfortable', 'compact'], defaultTab: ['open', 'waiting', 'unread', 'all'],
  defaultSort: ['latest', 'oldest'], timeFormat: ['12h', '24h'], chatSize: ['small', 'medium', 'large'],
}
export const LIST_WIDTH = { min: 280, max: 560 } as const
export const NAV_PAGES = ['Inbox', 'Dashboard', 'Leads', 'Contacts', 'Media', 'Reports'] as const
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
  if (typeof input.listWidth === 'number' && Number.isFinite(input.listWidth)) out.listWidth = Math.round(Math.min(LIST_WIDTH.max, Math.max(LIST_WIDTH.min, input.listWidth)))
  if (Array.isArray(input.navOrder)) out.navOrder = [...new Set(input.navOrder.filter((n): n is string => typeof n === 'string' && (NAV_PAGES as readonly string[]).includes(n)))]
  return out
}
