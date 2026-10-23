// A copy of the last screen data in this browser tab, so a reload shows it at once
// while fresh data loads. sessionStorage only: it ends with the tab and is cleared
// on sign-out, so finance or chat data never stays on a shared computer.
const PREFIX = 'numera-cache:'
const MAX_AGE = 12 * 60 * 60_000
const MAX_SIZE = 1_500_000

export function readCache<T>(key: string, maxAge = MAX_AGE): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (!raw) return null
    const { at, value } = JSON.parse(raw) as { at: number; value: T }
    return Date.now() - at < maxAge ? value : null
  } catch { return null }
}

export function writeCache(key: string, value: unknown) {
  try {
    const raw = JSON.stringify({ at: Date.now(), value })
    if (raw.length <= MAX_SIZE) sessionStorage.setItem(PREFIX + key, raw)
  } catch { /* Storage full or blocked: the page still loads normally. */ }
}

export function clearCaches() {
  try { Object.keys(sessionStorage).filter(k => k.startsWith(PREFIX)).forEach(k => sessionStorage.removeItem(k)) } catch { /* nothing to clear */ }
}
