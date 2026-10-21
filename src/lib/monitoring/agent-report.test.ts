import { describe, expect, it } from 'vitest'
import { agentReport, formatDuration } from './agent-report'

const row = (thread: string, direction: string, sent_at: string, channel_id = 'tahir') => ({ channel_id, thread_id: thread, direction, sent_at })

describe('agent performance report', () => {
  it('measures response time from the first unanswered customer message', () => {
    const { agents } = agentReport([
      row('a', 'inbound', '2026-10-20T10:00:00Z'),
      row('a', 'inbound', '2026-10-20T10:01:00Z'),
      row('a', 'outbound', '2026-10-20T10:04:00Z'),
      row('a', 'outbound', '2026-10-20T10:05:00Z'),
      row('a', 'inbound', '2026-10-20T11:00:00Z'),
      row('a', 'outbound', '2026-10-20T13:00:00Z'),
    ])
    expect(agents[0]).toMatchObject({ customer_turns: 2, answered: 2, unanswered: 0, inbound: 3, outbound: 3, within_5_min: 1, within_1_hour: 1 })
    expect(agents[0].median_response_seconds).toBe(Math.round((240 + 7200) / 2))
  })
  it('counts a customer turn still waiting at the end as unanswered', () => {
    const { agents } = agentReport([row('a', 'outbound', '2026-10-20T09:00:00Z'), row('a', 'inbound', '2026-10-20T10:00:00Z'), row('b', 'inbound', '2026-10-20T10:00:00Z', 'ali')])
    expect(agents.find(a => a.channel_id === 'tahir')).toMatchObject({ customer_turns: 1, answered: 0, unanswered: 1, median_response_seconds: null })
    expect(agents.find(a => a.channel_id === 'ali')?.unanswered).toBe(1)
  })
  it('accepts unordered rows and builds a Pakistan-time heatmap', () => {
    const { agents, heatmap } = agentReport([row('a', 'outbound', '2026-10-20T10:10:00Z'), row('a', 'inbound', '2026-10-20T10:00:00Z')])
    expect(agents[0].median_response_seconds).toBe(600)
    // 10:00 UTC on Tuesday is 15:00 in Pakistan.
    expect(heatmap[2][15]).toBe(1)
  })
  it('formats durations compactly', () => {
    expect([formatDuration(null), formatDuration(42), formatDuration(600), formatDuration(5400), formatDuration(90000)]).toEqual(['—', '42s', '10m', '1h 30m', '1d 1h'])
  })
})
