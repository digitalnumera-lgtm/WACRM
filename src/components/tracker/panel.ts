// Which panel (WhatsApp CRM or Client Tracker) this browser used last.
const PANEL_KEY = 'numera-panel'
export function rememberPanel(panel: 'crm' | 'tracker') { try { window.localStorage.setItem(PANEL_KEY, panel) } catch { /* Private mode. */ } }
export function lastPanel(): 'crm' | 'tracker' | null { try { const v = window.localStorage.getItem(PANEL_KEY); return v === 'crm' || v === 'tracker' ? v : null } catch { return null } }
