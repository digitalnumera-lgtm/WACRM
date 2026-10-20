import { expect, it } from 'vitest'
import { cursorFilter, makeCursor, readCursor } from './scroll'

it('retains database timestamp precision and a stable ID tie-breaker', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const time = '2026-10-20T08:12:30.123456+00:00'
  const cursor = readCursor(makeCursor({ id, sent_at: time }))!
  expect(cursor.time).toBe(time)
  expect(cursorFilter('sent_at', cursor)).toBe(`sent_at.lt."${time}",and(sent_at.eq."${time}",id.lt.${id})`)
  expect(cursorFilter('sent_at', cursor, true)).toContain(`id.gt.${id}`)
})
it('rejects malformed cursors before they can become database predicates', () => {
  expect(readCursor(null)).toBeNull()
  for (const value of ['bad', '2026-10-20T01:00:00Z|bad', '2026-10-20T01:00:00Z),id.neq.0|11111111-1111-4111-8111-111111111111']) expect(() => readCursor(value)).toThrow()
})
