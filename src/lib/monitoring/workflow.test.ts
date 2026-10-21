import { describe, expect, it } from 'vitest'
import { deriveWorkflow, workflowChange, workflowId } from './workflow'
import { expandQuickReply } from './workflow-types'

const now = Date.parse('2026-10-20T12:00:00Z')
describe('management conversation workflow', () => {
  it('counts both customer and agent messages without treating notes as messages', () => {
    expect(deriveWorkflow(12, undefined, { seen_count: 10 })).toEqual({ status: 'open', snoozed_until: null, unread_count: 2, marked_unread: false })
    expect(deriveWorkflow(12, undefined, { seen_count: 12, marked_unread: true }).marked_unread).toBe(true)
    expect(deriveWorkflow(12, undefined, { seen_count: 12 }).unread_count).toBe(0)
  })
  it('reopens resolved conversations on new activity and preserves read markers', () => {
    const status = { status: 'resolved', at_count: 12 }
    expect(deriveWorkflow(12, status, { seen_count: 10 }).status).toBe('resolved')
    expect(deriveWorkflow(13, status, { seen_count: 10 }).status).toBe('open')
    expect(deriveWorkflow(13, status, { seen_count: 10 }).unread_count).toBe(3)
  })
  it('expires snoozes and reopens early on new messages', () => {
    const state = { status: 'snoozed', at_count: 12, until: '2026-10-20T13:00:00Z' }
    expect(deriveWorkflow(12, state, undefined, now).status).toBe('snoozed')
    expect(deriveWorkflow(13, state, undefined, now).status).toBe('open')
    expect(deriveWorkflow(12, state, undefined, now + 3600000).status).toBe('open')
    expect(deriveWorkflow(12, { ...state, until: 'broken' }, undefined, now).status).toBe('open')
  })
  it('never marks unseen future messages read or resolves against a future count', () => {
    for (const observed_count of [-1, 11, 1.5, '3', null]) {
      expect(() => workflowChange({ action: 'read', observed_count }, 10, now)).toThrow()
    }
    expect(workflowChange({ action: 'read', observed_count: 8 }, 10, now).payload).toEqual({ seen_count: 8, marked_unread: false })
    const change = workflowChange({ action: 'status', status: 'resolved', observed_count: 8 }, 10, now)
    expect(deriveWorkflow(10, change.payload).status).toBe('open')
  })
  it('validates snooze boundaries and actions', () => {
    for (const until of ['bad', '2026-10-20T11:00:00Z', '2027-01-01T00:00:00Z']) {
      expect(() => workflowChange({ action: 'status', status: 'snoozed', observed_count: 1, until }, 1, now)).toThrow()
    }
    expect(() => workflowChange({ action: 'send', observed_count: 1 }, 1, now)).toThrow()
    expect(() => workflowChange({ action: 'status', status: 'deleted', observed_count: 1 }, 1, now)).toThrow()
  })
  it('keeps singleton keys distinct across companies, threads and status/read fields', () => {
    const id = workflowId('company-a', 'thread:status')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(workflowId('company-a', 'thread:status')).toBe(id)
    expect(new Set([id, workflowId('company-b', 'thread:status'), workflowId('company-a', 'thread:read'), workflowId('company-a', 'other:status')]).size).toBe(4)
  })
  it('inserts supported variables literally without recursively interpreting customer text', () => {
    expect(expandQuickReply('Hello {{name}} / {{phone}} / {{agent}} / {{unknown}}', { name: '{{agent}} 😀', phone: '+92300', agent: '$&' }))
      .toBe('Hello {{agent}} 😀 / +92300 / $& / {{unknown}}')
  })
})
