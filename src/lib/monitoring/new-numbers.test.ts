import { describe, expect, it, vi } from 'vitest'
const rows = vi.hoisted(() => ({ recent: [] as unknown[], prior: [] as unknown[] }))
vi.mock('./admin', () => ({ monitoringAdmin: () => ({ from: () => {
  let isPrior = false
  const q: Record<string, unknown> = {
    select: (cols: string) => { isPrior = !cols.includes('monitoring_messages'); return q },
    eq: () => q, gte: () => q, lt: () => q, in: () => q, order: () => q, not: () => q,
    limit: () => q,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: isPrior ? rows.prior : rows.recent, error: null }).then(resolve),
  }
  return q
} }) }))
import { newNumbers } from './new-numbers'

const today = new Date('2026-10-22T00:00:00+05:00')
const at = (hours: number) => new Date(today.getTime() + hours * 3600000).toISOString()

describe('new numbers today', () => {
  it('counts first-time customers today, per agent, and yesterday for comparison', async () => {
    rows.recent = [
      { id: 't1', customer: '111', channel_id: 'a', created_at: at(2), monitoring_messages: [{ sent_at: at(2) }] },
      { id: 't2', customer: '222', channel_id: 'b', created_at: at(3), monitoring_messages: [{ sent_at: at(3) }] },
      { id: 't3', customer: '111', channel_id: 'b', created_at: at(4), monitoring_messages: [{ sent_at: at(4) }] }, // same person, second agent
      { id: 't4', customer: '333', channel_id: 'a', created_at: at(5), monitoring_messages: [{ sent_at: at(-400) }] }, // history imported today
      { id: 't5', customer: '444', channel_id: 'a', created_at: at(6), monitoring_messages: [{ sent_at: at(6) }] }, // talked before
      { id: 't6', customer: '555', channel_id: 'a', created_at: at(-5), monitoring_messages: [{ sent_at: at(-5) }] }, // new yesterday
    ]
    rows.prior = [{ customer: '444', created_at: at(-200) }, { customer: '555', created_at: at(-5) }]
    expect(await newNumbers({ channelIds: null, hiddenIds: [] }, 'acct', today)).toEqual({ today: 2, yesterday: 1, byChannel: { a: 1, b: 1 } })
  })
})
