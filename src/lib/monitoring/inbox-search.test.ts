import { describe, expect, it, vi } from 'vitest'
import { numberVariants, searchFilter } from './inbox'
import { threadsWithText } from './message-search'

describe('inbox search', () => {
  it('treats local, international and spaced numbers as the same', () => {
    expect(numberVariants('030141')).toEqual(['030141', '9230141'])
    expect(numberVariants('0301-41')).toEqual(['030141', '9230141'])
    expect(numberVariants('+92 301 41')).toEqual(['9230141'])
    expect(numberVariants('0092 30141')).toEqual(['009230141', '9230141'])
    expect(numberVariants('9230141')).toEqual(['9230141'])
    expect(numberVariants('Ali 0301')).toEqual([])
    expect(numberVariants('12')).toEqual([])
  })

  it('searches numbers, names, the last message and matching messages', () => {
    expect(searchFilter('030141')).toBe('customer.ilike."%030141%",customer.ilike."%9230141%",customer_name.ilike."%030141%",last_preview.ilike."%030141%"')
    expect(searchFilter('price', ['a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'])).toContain('id.in.(a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1)')
    // A quote in the search stays inside the quoted value (escaped), so it can't add filters.
    expect(searchFilter('a"),or(id.neq.0')).toContain('customer_name.ilike."%a\\"),or(id.neq.0%"')
  })

  it('finds conversations from any matching message, within the person’s numbers', async () => {
    const calls: unknown[][] = []
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'not', 'order']) q[m] = (...args: unknown[]) => { calls.push([m, ...args]); return q }
    q.ilike = (...args: unknown[]) => { calls.push(['ilike', ...args]); return q }
    q.limit = () => Promise.resolve({ data: [{ thread_id: 't1' }, { thread_id: 't2' }, { thread_id: 't1' }], error: null })
    const ids = await threadsWithText({ db: { from: vi.fn(() => q) } as never, accountId: 'acct', channelIds: ['c1'], hiddenIds: [] }, '50% off')
    expect(ids).toEqual(['t1', 't2'])
    expect(calls).toContainEqual(['ilike', 'content', '%50\\% off%'])
    expect(calls).toContainEqual(['in', 'channel_id', ['c1']])
  })
})
