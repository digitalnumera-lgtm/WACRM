// Which panel (WhatsApp CRM or Client Tracker) and which page was open.
const PANEL_KEY = 'numera-panel'
/** After this long away, the next visit starts on the dashboard again. */
export const SESSION_IDLE_MS = 30 * 60 * 1000

export function rememberPanel(panel: 'crm' | 'tracker') { try { window.localStorage.setItem(PANEL_KEY, panel) } catch { /* Private mode. */ } }
export function lastPanel(): 'crm' | 'tracker' | null { try { const v = window.localStorage.getItem(PANEL_KEY); return v === 'crm' || v === 'tracker' ? v : null } catch { return null } }

/**
 * The page to open: the one open before a refresh in this tab, unless the tab
 * is new or the person was away for SESSION_IDLE_MS; then `fallback`.
 */
export function restorePage<T extends string>(scope: string, allowed: readonly T[], fallback: T, now = Date.now()): T {
  try {
    const raw = window.sessionStorage.getItem(`numera-page:${scope}`)
    if (!raw) return fallback
    const saved = JSON.parse(raw) as { page?: string; at?: number }
    if (!saved.page || !allowed.includes(saved.page as T) || !saved.at || now - saved.at > SESSION_IDLE_MS) return fallback
    return saved.page as T
  } catch { return fallback }
}
export function savePage(scope: string, page: string, now = Date.now()) {
  try { window.sessionStorage.setItem(`numera-page:${scope}`, JSON.stringify({ page, at: now })) } catch { /* Private mode. */ }
}
