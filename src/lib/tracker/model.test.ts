import { describe, expect, it } from 'vitest'
import { Script } from 'node:vm'
import { buildView, monthOf, amount, type RawSnapshot } from './model'
import { TRACKER_APPS_SCRIPT } from './apps-script'

const raw: RawSnapshot = {
  generatedAt: '2026-10-22T10:00:00Z',
  tabs: {
    Deals: {
      headers: ['Deal ID', 'Client ID', 'Date Closed', 'Sales Agent', 'Client', 'Business / Brand', 'Team', 'Phone', 'Services', 'Deal Total', 'Website Amount', 'Client Status', 'ClickUp Project', 'Drive Folder'],
      rows: [
        ['D-0007', 'C-004', '15-Sep-2026', 'Ali Anwar', 'Sonia Farid', 'Today mart', 'Usman', '+92 331 4115200', 'Website: Shopify Store', '35,000', '35,000', 'On Hold', 'https://app.clickup.com/t/z8r3fdkfav', 'https://drive.google.com/drive/folders/abc'],
        ['D-0029', 'C-021', '21-Oct-2026', 'Somia', 'M.Rehan', 'Sell Bone', 'Umair', '03268781099', 'Website', '15,000', '15,000', 'Onboarding', 'javascript:alert(1)', 'https://evil.example/x'],
        ['D-0025', 'C-018', '14-Oct-2026', 'Ali Anwar', 'Husnain', "Aria's Collection", 'Usman', '03012772779', 'Website', '30,000', '30,000', 'On Hold', '', ''],
      ],
    },
    'Client Balances': {
      headers: ['Deal ID', 'Paid', 'Remaining', 'Payment Status'],
      rows: [['D-0007', '35,000', '0', 'Fully Paid'], ['D-0029', '15,000', '0', 'Fully Paid'], ['D-0025', '15,000', '15,000', 'Partially Paid']],
    },
    Approvals: { headers: ['Deal ID', 'Advance', 'Approved'], rows: [['D-0007', '15,000', 'TRUE'], ['D-0029', '15,000', 'FALSE']] },
    'Payment Log': {
      headers: ['Payment ID', 'Date', 'Deal ID', 'Client', 'Amount', 'Collected By', 'Type'],
      rows: [['P-0030', '21-Oct-2026', 'D-0029', 'M.Rehan', '15,000', 'Somia', 'Advance + Final'], ['P-0031', '22-Oct-2026', 'D-0025', 'Husnain', '5,000', 'Usman', 'Refund'], ['P-0010', '15-Sep-2026', 'D-0007', 'Sonia', '15,000', 'Ali Anwar', 'Advance']],
    },
    Agents: { headers: ['Pay Month', 'Sales Agent'], rows: [['Oct 2026', 'Somia']] },
  },
  clickup: { z8r3fdkfav: { status: 'Closed', teams: { web: [2, 2], design: [1, 1] } } },
}
const now = new Date(2026, 9, 22)

describe('client tracker view', () => {
  it('reads dates and amounts as the Sheet shows them', () => {
    expect(monthOf('31-Aug-2026')).toBe('2026-08')
    expect(monthOf('29-Sep-2026 14:58')).toBe('2026-09')
    expect(monthOf('')).toBe('')
    expect(amount('30,000')).toBe(30000)
  })

  it('hides every amount at the view level', () => {
    const view = buildView(raw, 'view', 'x', now)
    expect(view.deals.every(d => d.money === undefined)).toBe(true)
    expect(view.payments).toBeUndefined()
    expect(view.commission).toBeUndefined()
    expect(view.summary.money).toBeUndefined()
    expect(JSON.stringify(view)).not.toMatch(/35,000|35000/)
  })

  it('adds amounts and payments, but not commission, at the amounts level', () => {
    const view = buildView(raw, 'amounts', 'x', now)
    expect(view.deals.find(d => d.id === 'D-0025')?.money?.remaining).toBe(15000)
    expect(view.summary.money).toMatchObject({ collectedThisMonth: 10000, outstanding: 15000, unpaidDeals: 1, salesThisMonth: 45000 })
    expect(view.payments).toHaveLength(3)
    expect(view.commission).toBeUndefined()
  })

  it('shows commission at full and owner level', () => {
    expect(buildView(raw, 'full', 'x', now).commission?.agents?.rows).toHaveLength(1)
    expect(buildView(raw, 'owner', 'x', now).commission).toBeDefined()
  })

  it('keeps only safe ClickUp and Drive links and attaches ClickUp progress', () => {
    const view = buildView(raw, 'view', 'x', now)
    const today = view.deals.find(d => d.id === 'D-0007')!
    expect(today.clickup?.teams.web).toEqual([2, 2])
    expect(today.driveUrl).toContain('drive.google.com')
    const rehan = view.deals.find(d => d.id === 'D-0029')!
    expect(rehan.clickupUrl).toBe('')
    expect(rehan.driveUrl).toBe('')
    expect(rehan.approved).toBe(false)
  })

  it('counts deals per agent for this month, newest deals first', () => {
    const view = buildView(raw, 'view', 'x', now)
    expect(view.deals.map(d => d.id)).toEqual(['D-0029', 'D-0025', 'D-0007'])
    expect(view.summary.dealsThisMonth).toBe(2)
    expect(view.summary.byAgent.find(a => a.agent === 'Ali Anwar')).toMatchObject({ deals: 2, dealsThisMonth: 1 })
  })
})

describe('apps script file', () => {
  it('is valid JavaScript and checks the key before anything else', () => {
    expect(() => new Script(TRACKER_APPS_SCRIPT)).not.toThrow()
    const post = TRACKER_APPS_SCRIPT.slice(TRACKER_APPS_SCRIPT.indexOf('function doPost'))
    expect(post.indexOf('crmKeyMatches_(body.key)')).toBeLessThan(post.indexOf('crmSnapshot_()'))
    expect(post.indexOf('crmKeyMatches_(body.key)')).toBeLessThan(post.indexOf('CRM_ACTIONS[body.action]'))
    expect(TRACKER_APPS_SCRIPT).toContain("const CRM_KEY = 'PASTE-KEY-HERE'")
  })
  it('changes the Sheet only through the main script functions the forms and tabs use', () => {
    for (const fn of ['dealFromRaw_(', 'addDeal_(', 'addPayment_(', 'createProject_(', 'syncClickUpStatus_(', 'deleteDeal_(', 'recalc_()', 'refreshServices_(', 'healthCheck_()']) expect(TRACKER_APPS_SCRIPT).toContain(fn)
    // Rows are only removed for a single payment or payout the CRM asked to remove; nothing is ever trashed.
    expect(TRACKER_APPS_SCRIPT.match(/deleteRow\(/g)).toHaveLength(2)
    expect(TRACKER_APPS_SCRIPT).not.toMatch(/appendRow|insertRow|setFormula|setTrashed/)
    // The only outgoing call besides ClickUp reads is the change alert to this CRM, carrying just the key.
    expect(TRACKER_APPS_SCRIPT).toContain("payload: JSON.stringify({ key: CRM_KEY })")
    expect(TRACKER_APPS_SCRIPT).toContain("const CRM_URL = 'PASTE-CRM-ADDRESS'")
  })
  it('never writes formula columns when a deal is edited', () => {
    expect(TRACKER_APPS_SCRIPT).toContain('formulas[name] || CRM_EDITABLE.indexOf(name) < 0')
  })
})
