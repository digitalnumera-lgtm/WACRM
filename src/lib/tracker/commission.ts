// Commission statements by date (no cut-off day): a deal earns commission on
// the day its client finished paying; refunds take it back on the refund day.
// Everything earned up to the statement date minus everything already paid
// is what is still owed, so over- and under-payments carry forward by themselves.
import { dayKey, signed, type CommissionDefaults, type Payout, type PersonRate, type TrackerDeal, type TrackerPayment } from './model'

export interface StatementLine { dealId: string; client: string; day: string; base: number; rate: number; amount: number; kind: 'earned' | 'refund' }
export interface StatementRow {
  person: string; role: 'Agent' | 'PM'; rate: string; ownRate: number | null
  earned: number; paid: number; due: number; lines: StatementLine[]; payouts: Payout[]
}

const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const round = (n: number) => Math.round(n)
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`

/**
 * One row per agent and per PM. `upTo` is YYYY-MM-DD; with `includeDay` false
 * the statement stops the day before.
 */
export function commissionStatement(input: {
  deals: TrackerDeal[]; payments: TrackerPayment[]; defaults: CommissionDefaults; rates: PersonRate[]; payouts: Payout[]; upTo: string; includeDay: boolean
}): StatementRow[] {
  const { deals, payments, defaults, rates, payouts } = input
  const last = input.includeDay ? input.upTo : addDays(input.upTo, -1)
  const teams = new Set(defaults.teams.map(t => t.trim()))
  const noPm = new Set(defaults.noPmTeams.map(t => t.trim()))
  const own = (person: string, role: 'Agent' | 'PM') => rates.find(r => r.person.trim() === person.trim() && r.role === role)?.rate ?? null

  // Monthly sales per agent (hosting not counted) decide the default tier.
  const monthSales = new Map<string, number>()
  for (const d of deals) monthSales.set(`${d.agent}|${d.month}`, (monthSales.get(`${d.agent}|${d.month}`) ?? 0) + (d.money?.commissionable ?? 0))

  const rows = new Map<string, StatementRow>()
  const row = (person: string, role: 'Agent' | 'PM') => {
    const key = `${role}|${person}`
    let r = rows.get(key)
    if (!r) {
      const mine = own(person, role)
      const rate = mine != null ? pct(mine) : role === 'PM' ? pct(defaults.pmRate) : `${pct(defaults.rateBelow)} / ${pct(defaults.rateAbove)}`
      r = { person, role, rate, ownRate: mine, earned: 0, paid: 0, due: 0, lines: [], payouts: [] }
      rows.set(key, r)
    }
    return r
  }
  const refundsByDeal = new Map<string, TrackerPayment[]>()
  for (const p of payments) if (signed(p) < 0) refundsByDeal.set(p.dealId, [...(refundsByDeal.get(p.dealId) ?? []), p])

  for (const d of deals) {
    const base = d.money?.commissionable ?? 0
    const paidDay = dayKey(d.money?.fullyPaidOn ?? '')
    if (!base || !paidDay || paidDay > last) continue
    const earners: [string, 'Agent' | 'PM', number][] = []
    if (d.agent && !teams.has(d.agent.trim())) {
      const mine = own(d.agent, 'Agent')
      const tier = (monthSales.get(`${d.agent}|${d.month}`) ?? 0) >= defaults.target ? defaults.rateAbove : defaults.rateBelow
      earners.push([d.agent.trim(), 'Agent', mine ?? tier])
    }
    if (d.team && !noPm.has(d.team.trim())) earners.push([d.team.trim(), 'PM', own(d.team, 'PM') ?? defaults.pmRate])
    for (const [person, role, rate] of earners) {
      const r = row(person, role)
      r.lines.push({ dealId: d.id, client: d.brand || d.client, day: paidDay, base, rate, amount: round(base * rate), kind: 'earned' })
      for (const refund of refundsByDeal.get(d.id) ?? []) {
        const day = dayKey(refund.date)
        if (!day || day > last || day < paidDay) continue
        const back = Math.min(Math.abs(signed(refund)), base)
        r.lines.push({ dealId: d.id, client: d.brand || d.client, day, base: back, rate, amount: -round(back * rate), kind: 'refund' })
      }
    }
  }
  // Everyone who was ever paid shows up, even with nothing earned yet.
  for (const p of payouts) row(p.person.trim(), p.role)
  for (const r of rows.values()) {
    r.payouts = payouts.filter(p => p.person.trim() === r.person && p.role === r.role)
    r.earned = r.lines.reduce((s, l) => s + l.amount, 0)
    r.paid = r.payouts.reduce((s, p) => s + p.amount, 0)
    r.due = r.earned - r.paid
    r.lines.sort((a, b) => a.day.localeCompare(b.day))
  }
  return [...rows.values()].sort((a, b) => a.role.localeCompare(b.role) || b.due - a.due || a.person.localeCompare(b.person))
}

/** People who can have their own rate: every agent and PM found in the deals. */
export function commissionPeople(deals: TrackerDeal[], defaults: CommissionDefaults): { person: string; role: 'Agent' | 'PM' }[] {
  const teams = new Set(defaults.teams.map(t => t.trim())), noPm = new Set(defaults.noPmTeams.map(t => t.trim()))
  const out = new Map<string, { person: string; role: 'Agent' | 'PM' }>()
  for (const d of deals) {
    if (d.agent && !teams.has(d.agent.trim())) out.set(`Agent|${d.agent.trim()}`, { person: d.agent.trim(), role: 'Agent' })
    if (d.team && !noPm.has(d.team.trim())) out.set(`PM|${d.team.trim()}`, { person: d.team.trim(), role: 'PM' })
  }
  return [...out.values()].sort((a, b) => a.role.localeCompare(b.role) || a.person.localeCompare(b.person))
}
