import { describe, expect, it } from 'vitest'
import { commissionStatement, commissionPeople } from './commission'
import type { CommissionDefaults, Payout, TrackerDeal, TrackerPayment } from './model'

const defaults: CommissionDefaults = { target: 150000, rateBelow: 0.05, rateAbove: 0.1, pmRate: 0.1, teams: ['Usman', 'Umair', 'Company'], noPmTeams: ['Company'] }
const deal = (id: string, agent: string, team: string, closed: string, base: number, fullyPaidOn: string): TrackerDeal => ({
  id, clientId: '', dateClosed: closed, month: `2026-${closed.slice(3, 6) === 'Oct' ? '10' : '11'}`, agent, client: id, brand: id, team, phone: '', email: '', country: '',
  services: '', dealType: '', previousDeal: '', clientStatus: '', approved: true, offboardDate: '', offboardReason: '', notes: '', clickupUrl: '', driveUrl: '', clickup: null, marketing: null,
  money: { total: base, advance: null, advanceProof: [], paid: base, remaining: 0, paymentStatus: 'Fully Paid', fullyPaidOn, refundedOn: '', lastPayment: fullyPaidOn, website: base, hosting: 0, marketing: 0, other: 0, commissionable: base },
})
const deals = [
  deal('D-0001', 'Ali Anwar', 'Usman', '02-Oct-2026', 86420, '10-Oct-2026'),  // 5% → 4,321
  deal('D-0002', 'Ali Anwar', 'Usman', '03-Nov-2026', 100000, '17-Nov-2026'), // 5% → 5,000 (counts only if 17 Nov is included)
  deal('D-0003', 'Usman', 'Usman', '04-Nov-2026', 20000, '05-Nov-2026'),     // PM's own deal: PM commission only
  deal('D-0004', 'Company', 'Company', '05-Nov-2026', 50000, '06-Nov-2026'), // owners: nobody
  deal('D-0005', 'Somia', 'Umair', '06-Nov-2026', 30000, ''),                // not fully paid yet
]
const run = (upTo: string, includeDay: boolean, payouts: Payout[] = [], payments: TrackerPayment[] = [], rates = []) =>
  commissionStatement({ deals, payments, defaults, rates, payouts, upTo, includeDay })
const paid = (amount: number): Payout => ({ id: 'CP-0001', date: '12-Nov-2026', person: 'Ali Anwar', role: 'Agent', amount, upTo: '', note: '', addedBy: '' })

describe('commission statement by date', () => {
  it('counts deals fully paid up to the date, with or without that day', () => {
    const before = run('2026-11-17', false).find(r => r.person === 'Ali Anwar')!
    expect(before.earned).toBe(4321)
    const withDay = run('2026-11-17', true).find(r => r.person === 'Ali Anwar')!
    expect(withDay.earned).toBe(9321)
  })
  it('carries an overpayment forward and takes it off the next commission', () => {
    const after = run('2026-11-16', true, [paid(5000)]).find(r => r.person === 'Ali Anwar')!
    expect(after.due).toBe(-679)
    const next = run('2026-11-17', true, [paid(5000)]).find(r => r.person === 'Ali Anwar')!
    expect(next.due).toBe(4321)
  })
  it('pays the PM on every team deal, never on Company deals, and uses own rates', () => {
    const rows = run('2026-11-30', true, [], [], [{ person: 'Usman', role: 'PM', rate: 0.12, note: '' }] as never)
    const usman = rows.find(r => r.person === 'Usman' && r.role === 'PM')!
    expect(usman.earned).toBe(Math.round(86420 * 0.12) + 100000 * 0.12 + 20000 * 0.12)
    expect(rows.find(r => r.person === 'Usman' && r.role === 'Agent')).toBeUndefined()
    expect(rows.find(r => r.person === 'Company')).toBeUndefined()
    expect(rows.find(r => r.person === 'Somia')).toBeUndefined()
  })
  it('takes commission back on a refund after full payment', () => {
    const refund: TrackerPayment = { id: 'P-9', date: '20-Oct-2026', month: '2026-10', dealId: 'D-0001', client: '', amount: -20000, collectedBy: '', type: 'Refund', method: '', note: '', addedBy: '', proof: [] }
    const ali = run('2026-10-31', true, [], [refund]).find(r => r.person === 'Ali Anwar')!
    expect(ali.earned).toBe(4321 - 1000)
  })
  it('uses the higher tier once monthly sales reach the target', () => {
    const big = [...deals, deal('D-0006', 'Ali Anwar', 'Usman', '08-Nov-2026', 60000, '09-Nov-2026')]
    const ali = commissionStatement({ deals: big, payments: [], defaults, rates: [], payouts: [], upTo: '2026-11-30', includeDay: true }).find(r => r.person === 'Ali Anwar')!
    expect(ali.lines.filter(l => l.day.startsWith('2026-11')).every(l => l.rate === 0.1)).toBe(true)
  })
  it('lists the people who can get their own rate', () => {
    expect(commissionPeople(deals, defaults)).toEqual([{ person: 'Ali Anwar', role: 'Agent' }, { person: 'Somia', role: 'Agent' }, { person: 'Umair', role: 'PM' }, { person: 'Usman', role: 'PM' }])
  })
})
