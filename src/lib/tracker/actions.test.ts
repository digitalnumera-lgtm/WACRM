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

describe('new tracker changes', () => {
  it('lets only non-formula deal columns be edited', () => {
    expect(actionInput('editDeal', { dealId: 'D-0012', fields: { Phone: '03001234567', 'Website Amount': '30,000', 'Date Closed': '2026-10-20' } }).input)
      .toEqual({ dealId: 'D-0012', fields: { Phone: '03001234567', 'Website Amount': '30000', 'Date Closed': '2026-10-20' } })
    expect(() => actionInput('editDeal', { dealId: 'D-0012', fields: { 'Deal Total': '1' } })).toThrow(/cannot be changed/)
    expect(() => actionInput('editDeal', { dealId: 'D-0012', fields: { 'ClickUp Project': 'x' } })).toThrow(/cannot be changed/)
    expect(() => actionInput('editDeal', { dealId: 'D-0012', fields: {} })).toThrow(/Nothing/)
    expect(() => actionInput('editDeal', { dealId: 'D-0012', fields: { Client: '' } })).toThrow(/empty/)
  })
  it('checks payments, payouts and rates', () => {
    expect(() => actionInput('deletePayment', { paymentId: 'D-0001' })).toThrow(/payment/)
    expect(actionInput('editPayment', { paymentId: 'p-0007', amount: '5,000', kind: 'Refund' }).input).toEqual({ paymentId: 'P-0007', amount: '5000', kind: 'Refund' })
    expect(() => actionInput('personRate', { name: 'Ali', rate: '150' })).toThrow(/0 to 100/)
    expect(actionInput('personRate', { name: 'Ali', role: 'PM', rate: '' }).input).toMatchObject({ role: 'PM', rate: '' })
    expect(() => actionInput('addPayout', { name: 'Ali', amount: '0', date: '2026-11-17' })).toThrow(/amount/)
    expect(actionInput('addPayout', { name: 'Ali', amount: '5000', date: '2026-11-17', upTo: '2026-11-16' }).input).toMatchObject({ amount: '5000', role: 'Agent' })
    expect(() => actionInput('deletePayout', { payoutId: 'P-0001' })).toThrow(/payout/)
  })
})
