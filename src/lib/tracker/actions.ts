// Checks what the CRM asks the Apps Script to change. Only these actions and
// fields reach the script; everything else is rejected here.
import { MonitoringInputError } from '@/lib/monitoring/http'

export const TRACKER_ACTIONS = ['addDeal', 'approve', 'status', 'payment', 'payout', 'deleteDeal'] as const
export type TrackerAction = typeof TRACKER_ACTIONS[number]

/** Closed Deal form question titles the CRM may send (they must match the form exactly). */
export const DEAL_QUESTIONS = [
  'Sales Agent', 'Team', 'Deal type', 'Previous Deal ID', 'Client Name', 'Business / Brand', 'Phone', 'Email', 'Client Country', 'Date Closed',
  'Website taken?', 'Website Type', 'Shopify Store Model', 'Custom Website - What is being built', 'WordPress - Site purpose', 'WordPress Store Model',
  'Hosting provided by', 'Hosting Amount (PKR)', 'Website Region', 'Website Amount (PKR)',
  'Marketing taken?', 'Marketing Services', 'Marketing Region', 'Marketing Start Date', 'Marketing Days', 'Marketing Amount (PKR)',
  'Other service taken?', 'Other - What was sold', 'Other Amount (PKR)', 'Advance Received (PKR)', 'Notes',
] as const

const DEAL_ID = /^D-\d{4}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const text = (v: unknown, max = 300) => {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string' && typeof v !== 'number') throw new MonitoringInputError('Invalid value.')
  const s = String(v).trim()
  if (s.length > max) throw new MonitoringInputError('A value is too long.')
  return s
}
const money = (v: unknown, label: string) => {
  const s = text(v, 20).replace(/,/g, '')
  if (!s) return ''
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) > 100_000_000) throw new MonitoringInputError(`${label} must be a number.`)
  return s
}
const date = (v: unknown, label: string, required = false) => {
  const s = text(v, 10)
  if (!s && !required) return ''
  if (!DATE.test(s) || Number.isNaN(Date.parse(s))) throw new MonitoringInputError(`${label} must be a date.`)
  return s
}
const dealId = (v: unknown) => { const s = text(v, 10).toUpperCase(); if (!DEAL_ID.test(s)) throw new MonitoringInputError('Pick a deal.'); return s }

export function actionInput(action: unknown, input: unknown): { action: TrackerAction; input: Record<string, unknown> } {
  if (!TRACKER_ACTIONS.includes(action as TrackerAction)) throw new MonitoringInputError('Unknown change.')
  const i = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  switch (action as TrackerAction) {
    case 'addDeal': {
      const raw = (i.answers && typeof i.answers === 'object' && !Array.isArray(i.answers) ? i.answers : {}) as Record<string, unknown>
      const answers: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (!(DEAL_QUESTIONS as readonly string[]).includes(k)) throw new MonitoringInputError(`Unknown question: ${k.slice(0, 40)}`)
        answers[k] = /Amount|Received/.test(k) ? money(v, k) : /Date/.test(k) ? date(v, k) : k === 'Marketing Days' ? money(v, k) : text(v, k === 'Notes' ? 2000 : 300)
      }
      if (!answers['Client Name']) throw new MonitoringInputError('Enter the client name.')
      if (!answers['Sales Agent']) throw new MonitoringInputError('Pick the sales agent.')
      if (!answers['Phone']) throw new MonitoringInputError('Enter the phone number.')
      if (!answers['Date Closed']) throw new MonitoringInputError('Enter the date closed.')
      if (answers['Previous Deal ID'] && !DEAL_ID.test(answers['Previous Deal ID'].toUpperCase())) throw new MonitoringInputError('Previous Deal ID looks like D-0012.')
      return { action: 'addDeal', input: { answers } }
    }
    case 'approve': return { action: 'approve', input: { dealId: dealId(i.dealId) } }
    case 'deleteDeal': return { action: 'deleteDeal', input: { dealId: dealId(i.dealId) } }
    case 'status': {
      const status = text(i.status, 40)
      if (!status) throw new MonitoringInputError('Pick a status.')
      return { action: 'status', input: { dealId: dealId(i.dealId), status, offboardDate: date(i.offboardDate, 'Offboard date'), offboardReason: text(i.offboardReason, 300) } }
    }
    case 'payment': {
      const kind = i.kind === 'Refund' ? 'Refund' : 'Payment'
      const amount = money(i.amount, 'Amount')
      if (!amount || Number(amount) <= 0) throw new MonitoringInputError('Enter an amount.')
      return { action: 'payment', input: { dealId: dealId(i.dealId), kind, amount, date: date(i.date, 'Payment date', true), method: text(i.method, 60), note: text(i.note, 500) } }
    }
    case 'payout': {
      if (i.tab !== 'agents' && i.tab !== 'pm') throw new MonitoringInputError('Pick Agents or PM commission.')
      const month = text(i.month, 7)
      if (!/^\d{4}-\d{2}$/.test(month)) throw new MonitoringInputError('Pick a pay month.')
      const name = text(i.name, 60)
      if (!name) throw new MonitoringInputError('Pick a person.')
      return { action: 'payout', input: { tab: i.tab, month, name, status: text(i.status, 30), paidOn: date(i.paidOn, 'Paid on'), amountPaid: money(i.amountPaid, 'Amount paid'), note: text(i.note, 300) } }
    }
  }
}
