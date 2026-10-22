// Turns the Sheet copy sent by the Apps Script into the Client Tracker's
// data, and removes what a person's access level does not allow.

export type TrackerLevel = 'view' | 'amounts' | 'full' | 'owner'
export const LEVEL_RANK: Record<TrackerLevel, number> = { view: 1, amounts: 2, full: 3, owner: 4 }
export const atLeast = (level: TrackerLevel, min: TrackerLevel) => LEVEL_RANK[level] >= LEVEL_RANK[min]

export interface SheetTable { headers: string[]; rows: string[][]; notes?: string[] }
export interface ClickUpSummary { status: string; teams: Record<string, [number, number]> }
export interface RawSnapshot { generatedAt: string; tabs: Record<string, SheetTable>; clickup?: Record<string, ClickUpSummary> }

export interface TrackerDeal {
  id: string; clientId: string; dateClosed: string; month: string; agent: string; client: string; brand: string; team: string
  phone: string; email: string; country: string; services: string; dealType: string; previousDeal: string
  clientStatus: string; approved: boolean | null; offboardDate: string; offboardReason: string; notes: string
  clickupUrl: string; driveUrl: string; clickup: ClickUpSummary | null
  marketing: { services: string; region: string; days: string; start: string; end: string; status: string } | null
  money?: {
    total: number; advance: number | null; paid: number | null; remaining: number | null; paymentStatus: string
    fullyPaidOn: string; lastPayment: string; website: number; hosting: number; marketing: number; other: number; commissionable: number | null
  }
}
export interface TrackerPayment { id: string; date: string; month: string; dealId: string; client: string; amount: number; collectedBy: string; type: string; method: string; note: string; addedBy: string }
export interface TrackerSummary {
  month: string; deals: number; dealsThisMonth: number; clients: number
  byStatus: Record<string, number>
  byAgent: { agent: string; deals: number; dealsThisMonth: number; sales?: number; salesThisMonth?: number }[]
  money?: { salesThisMonth: number; collectedThisMonth: number; collectedAllTime: number; outstanding: number; unpaidDeals: number }
}
export interface TrackerView {
  level: TrackerLevel; generatedAt: string; fetchedAt: string; stale?: string
  summary: TrackerSummary; deals: TrackerDeal[]
  payments?: TrackerPayment[]
  commission?: { agents: SheetTable | null; pm: SheetTable | null; owner: SheetTable | null }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "31-Aug-2026" (or "31-Aug-2026 14:58") → "2026-08"; anything else → "". */
export function monthOf(value: string): string {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(String(value).trim())
  if (!m) return ''
  const i = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase())
  return i < 0 ? '' : `${m[3]}-${String(i + 1).padStart(2, '0')}`
}
/** Sortable key for "31-Aug-2026". */
export function dayKey(value: string): string {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(String(value).trim())
  const month = monthOf(value)
  return m && month ? `${month}-${m[1].padStart(2, '0')}` : ''
}
/** "30,000" → 30000; blanks → 0. */
export function amount(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
/** Refunds count against what was collected. */
export const signed = (p: Pick<TrackerPayment, 'amount' | 'type'>) => /refund/i.test(p.type) && p.amount > 0 ? -p.amount : p.amount
const blankOr = (value: unknown) => String(value ?? '').trim() === '' ? null : amount(value)

function records(table: SheetTable | undefined): Record<string, string>[] {
  if (!table) return []
  return table.rows.map(row => Object.fromEntries(table.headers.map((h, i) => [h, String(row[i] ?? '').trim()])))
}
const taskId = (url: string) => /\/t\/(?:\d+\/)?([a-z0-9]+)/i.exec(url)?.[1] ?? ''
const safeLink = (url: string, hosts: RegExp) => { try { const u = new URL(url); return u.protocol === 'https:' && hosts.test(u.hostname) ? u.toString() : '' } catch { return '' } }

/** Checks the shape of what the script sent. */
export function isRawSnapshot(value: unknown): value is RawSnapshot {
  const v = value as RawSnapshot
  return !!v && typeof v === 'object' && typeof v.tabs === 'object' && v.tabs !== null &&
    Object.values(v.tabs).every(t => Array.isArray(t?.headers) && Array.isArray(t?.rows))
}

export function buildView(raw: RawSnapshot, level: TrackerLevel, fetchedAt: string, now = new Date()): TrackerView {
  const money = atLeast(level, 'amounts')
  const balances = new Map(records(raw.tabs['Client Balances']).map(r => [r['Deal ID'], r]))
  const approvals = new Map(records(raw.tabs['Approvals']).map(r => [r['Deal ID'], r]))
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const deals: TrackerDeal[] = records(raw.tabs['Deals']).filter(r => /^D-\d+/.test(r['Deal ID'])).map(r => {
    const bal = balances.get(r['Deal ID']), appr = approvals.get(r['Deal ID'])
    const clickupUrl = safeLink(r['ClickUp Project'] ?? '', /(^|\.)clickup\.com$/)
    const deal: TrackerDeal = {
      id: r['Deal ID'], clientId: r['Client ID'] ?? '', dateClosed: r['Date Closed'] ?? '', month: monthOf(r['Date Closed'] ?? ''),
      agent: r['Sales Agent'] ?? '', client: r['Client'] ?? '', brand: r['Business / Brand'] ?? '', team: r['Team'] ?? '',
      phone: r['Phone'] ?? '', email: r['Email'] ?? '', country: r['Country'] ?? '', services: r['Services'] ?? '',
      dealType: r['Deal Type'] ?? '', previousDeal: r['Previous Deal'] ?? '',
      clientStatus: r['Client Status'] || appr?.['Client Status'] || bal?.['Client Status'] || '',
      approved: appr ? appr['Approved'] === 'TRUE' : null, offboardDate: appr?.['Offboard Date'] ?? '', offboardReason: appr?.['Offboard Reason'] ?? '',
      notes: r['Notes'] ?? '', clickupUrl, driveUrl: safeLink(r['Drive Folder'] ?? '', /^drive\.google\.com$/),
      clickup: raw.clickup?.[taskId(clickupUrl)] ?? null,
      marketing: r['Marketing Services'] ? { services: r['Marketing Services'], region: r['Marketing Region'] ?? '', days: r['Marketing Days'] ?? '', start: r['Marketing Start'] ?? '', end: r['Marketing End'] ?? '', status: r['Marketing Status'] ?? '' } : null,
    }
    if (money) deal.money = {
      total: amount(r['Deal Total']), advance: blankOr(appr?.['Advance']), paid: bal ? amount(bal['Paid']) : null, remaining: bal ? amount(bal['Remaining']) : null,
      paymentStatus: bal?.['Payment Status'] ?? '', fullyPaidOn: bal?.['Fully Paid On'] ?? '', lastPayment: bal?.['Last Payment'] ?? '',
      website: amount(r['Website Amount']), hosting: amount(r['Hosting Amount']), marketing: amount(r['Marketing Amount']), other: amount(r['Other Amount']),
      commissionable: blankOr(r['Commission Amount']),
    }
    return deal
  }).sort((a, b) => dayKey(b.dateClosed).localeCompare(dayKey(a.dateClosed)) || b.id.localeCompare(a.id))

  const payments: TrackerPayment[] = records(raw.tabs['Payment Log']).filter(r => /^P-\d+/.test(r['Payment ID'])).map(r => ({
    id: r['Payment ID'], date: r['Date'] ?? '', month: monthOf(r['Date'] ?? ''), dealId: r['Deal ID'] ?? '', client: r['Client'] ?? '',
    amount: amount(r['Amount']), collectedBy: r['Collected By'] ?? '', type: r['Type'] ?? '', method: r['Method'] ?? '', note: r['Note'] ?? '', addedBy: r['Added By'] ?? '',
  })).sort((a, b) => dayKey(b.date).localeCompare(dayKey(a.date)) || b.id.localeCompare(a.id))

  const byStatus: Record<string, number> = {}
  const agents = new Map<string, TrackerSummary['byAgent'][number]>()
  for (const d of deals) {
    const status = d.clientStatus || 'Not set'
    byStatus[status] = (byStatus[status] ?? 0) + 1
    const a = agents.get(d.agent) ?? { agent: d.agent || 'Unknown', deals: 0, dealsThisMonth: 0, ...(money ? { sales: 0, salesThisMonth: 0 } : {}) }
    a.deals++
    if (d.month === month) a.dealsThisMonth++
    if (money && d.money) { a.sales! += d.money.total; if (d.month === month) a.salesThisMonth! += d.money.total }
    agents.set(d.agent, a)
  }
  const summary: TrackerSummary = {
    month, deals: deals.length, dealsThisMonth: deals.filter(d => d.month === month).length,
    clients: new Set(deals.map(d => d.clientId || d.client)).size, byStatus,
    byAgent: [...agents.values()].sort((a, b) => b.dealsThisMonth - a.dealsThisMonth || b.deals - a.deals),
  }
  if (money) summary.money = {
    salesThisMonth: deals.filter(d => d.month === month).reduce((s, d) => s + (d.money?.total ?? 0), 0),
    collectedThisMonth: payments.filter(p => p.month === month).reduce((s, p) => s + signed(p), 0),
    collectedAllTime: payments.reduce((s, p) => s + signed(p), 0),
    outstanding: deals.reduce((s, d) => s + Math.max(0, d.money?.remaining ?? 0), 0),
    unpaidDeals: deals.filter(d => (d.money?.remaining ?? 0) > 0).length,
  }

  const view: TrackerView = { level, generatedAt: raw.generatedAt, fetchedAt, summary, deals }
  if (money) view.payments = payments
  if (atLeast(level, 'full')) view.commission = { agents: raw.tabs['Agents'] ?? null, pm: raw.tabs['PM Commission'] ?? null, owner: raw.tabs['Owner Deals'] ?? null }
  return view
}
