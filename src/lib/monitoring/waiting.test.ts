import { describe, expect, it, vi } from 'vitest'
import { unanswered, withWaitingCounts } from './waiting'

describe('unanswered customer messages', () => {
  it('counts customer messages until the agent’s last reply', () => {
    expect(unanswered([{ direction: 'inbound' }, { direction: 'inbound' }, { direction: 'outbound' }, { direction: 'inbound' }])).toBe(2)
    expect(unanswered([{ direction: 'outbound' }, { direction: 'inbound' }])).toBe(0)
    expect(unanswered([{ direction: 'inbound', kind: 'reaction' }, { direction: 'inbound', kind: 'text' }])).toBe(1)
    expect(unanswered(undefined)).toBe(0)
  })

  it('adds counts only to chats where the customer spoke last', async () => {
    const calls: string[] = []
    const query = {
      select: (columns: string) => { calls.push(columns); return query },
      eq: () => query, in: (_: string, ids: string[]) => { calls.push(ids.join(',')); return query }, order: () => query,
      limit: () => Promise.resolve({ data: [{ id: 'a', monitoring_messages: [{ direction: 'inbound' }, { direction: 'inbound' }, { direction: 'outbound' }] }], error: null }),
    }
    const db = { from: vi.fn(() => query) }
    const rows = await withWaitingCounts(db as never, 'company', [
      { id: 'a', last_direction: 'inbound', state: 'open' },
      { id: 'b', last_direction: 'outbound', state: 'open' },
      { id: 'c', last_direction: 'inbound', state: 'resolved' },
    ])
    expect(calls).toContain('a')
    expect(rows.map(r => r.waiting_count)).toEqual([2, undefined, undefined])
  })

  it('leaves rows unchanged when counts cannot be read', async () => {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => Promise.resolve({ data: null, error: { message: 'down' } }) }
    const rows = [{ id: 'a', last_direction: 'inbound' }]
    expect(await withWaitingCounts({ from: () => query } as never, 'company', rows)).toBe(rows)
  })
})
