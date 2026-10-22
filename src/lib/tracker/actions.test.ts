import { describe, expect, it } from 'vitest'
import { actionInput } from './actions'

describe('tracker change checks', () => {
  it('accepts a closed deal with form question titles only', () => {
    const ok = actionInput('addDeal', { answers: { 'Client Name': 'Ali', 'Sales Agent': 'Somia', Phone: '03001234567', 'Date Closed': '2026-10-22', 'Website taken?': 'Yes', 'Website Amount (PKR)': '30,000' } })
    expect(ok.input.answers).toMatchObject({ 'Website Amount (PKR)': '30000' })
    expect(() => actionInput('addDeal', { answers: { 'Client Name': 'Ali', 'Sales Agent': 'S', Phone: '1', 'Date Closed': '2026-10-22', CLICKUP_TOKEN: 'x' } })).toThrow(/Unknown question/)
    expect(() => actionInput('addDeal', { answers: { 'Client Name': 'Ali' } })).toThrow()
    expect(() => actionInput('addDeal', { answers: { 'Client Name': 'Ali', 'Sales Agent': 'S', Phone: '1', 'Date Closed': 'tomorrow' } })).toThrow(/date/)
  })
  it('rejects unknown actions, bad deal IDs and bad amounts', () => {
    expect(() => actionInput('runScript', {})).toThrow(/Unknown change/)
    expect(() => actionInput('approve', { dealId: "D-1' or 1=1" })).toThrow()
    expect(() => actionInput('approve', { dealId: 'D-12' })).toThrow(/deal/)
    expect(actionInput('approve', { dealId: 'd-0012' }).input).toEqual({ dealId: 'D-0012' })
    expect(() => actionInput('payment', { dealId: 'D-0012', amount: '-5', date: '2026-10-22' })).toThrow(/number/)
    expect(actionInput('payment', { dealId: 'D-0012', amount: '5,000', date: '2026-10-22', kind: 'Refund' }).input).toMatchObject({ amount: '5000', kind: 'Refund' })
  })
  it('limits payout edits to Agents and PM Commission', () => {
    expect(() => actionInput('payout', { tab: 'Deals', month: '2026-09', name: 'Ali' })).toThrow()
    expect(actionInput('payout', { tab: 'pm', month: '2026-09', name: 'Usman', status: 'Paid', paidOn: '2026-10-15', amountPaid: '3000' }).input).toMatchObject({ tab: 'pm', amountPaid: '3000' })
  })
})
