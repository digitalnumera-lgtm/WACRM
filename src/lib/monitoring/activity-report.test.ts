import { describe, expect, it } from 'vitest'
import { activityReport } from './activity-report'
import { messageFilters } from './message-query'
import { csvCell } from './csv'

describe('activity reports', () => {
  it('counts by original UTC date and number, including empty days', () => {
    const result = activityReport([
      { channel_id: 'a', direction: 'inbound', kind: 'text', sent_at: '2026-10-18T23:59:59Z' },
      { channel_id: 'a', direction: 'outbound', kind: 'audio', sent_at: '2026-10-19T00:00:00Z' },
      { channel_id: 'b', direction: 'inbound', kind: 'image', sent_at: '2026-10-19T10:00:00Z' },
      { channel_id: 'a', direction: 'inbound', kind: 'text', sent_at: '2026-10-01T10:00:00Z' },
    ], '2026-10-17T00:00:00Z', 3)
    expect(result.daily.map(d => [d.inbound, d.outbound])).toEqual([[0, 0], [1, 0], [1, 1]])
    expect(result.numbers).toEqual([{ channel_id: 'a', inbound: 1, outbound: 1 }, { channel_id: 'b', inbound: 1, outbound: 0 }])
    expect(result.formats).toEqual({ text: 1, audio: 1, image: 1 })
  })
})
describe('message filtering', () => {
  it('includes the entire selected final UTC day', () => {
    expect(messageFilters(new URLSearchParams('from=2026-10-18&to=2026-10-19')).until).toBe('2026-10-20T00:00:00.000Z')
  })
  it.each(['from=2026-02-30', 'from=bad', 'from=2026-10-20&to=2026-10-19', 'channel=other-account', 'direction=anything', 'page=-1', 'kind=image,or(id)'])('rejects invalid filter %s', query => {
    expect(() => messageFilters(new URLSearchParams(query))).toThrow()
  })
})
describe('CSV exports', () => {
  it('keeps formula-like customer text inert and quotes embedded characters', () => {
    expect(csvCell('=HYPERLINK("https://example.test")')).toBe('"\'=HYPERLINK(""https://example.test"")"')
    expect(csvCell('+923001234567')).toBe('"\'+923001234567"')
    expect(csvCell('hello, "friend"\n👋')).toBe('"hello, ""friend""\n👋"')
    expect(csvCell(null)).toBe('""')
  })
})
