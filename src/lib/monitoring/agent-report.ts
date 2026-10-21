// Agent performance from stored messages. A "customer turn" starts with the
// first inbound message after a business message (or at the start of the
// period); the agent's response time is the gap to the next outbound message.

export interface AgentRow { channel_id: string; thread_id: string; direction: string; sent_at: string }
export interface AgentStats {
  channel_id: string
  conversations: number
  inbound: number
  outbound: number
  customer_turns: number
  answered: number
  unanswered: number
  median_response_seconds: number | null
  average_response_seconds: number | null
  within_5_min: number
  within_1_hour: number
}

const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export function agentReport(rows: AgentRow[], timezoneOffsetMinutes = 300) {
  const threads = new Map<string, AgentRow[]>()
  for (const row of rows) {
    if (row.direction !== 'inbound' && row.direction !== 'outbound') continue
    const list = threads.get(row.thread_id) ?? []
    list.push(row); threads.set(row.thread_id, list)
  }
  const agents = new Map<string, AgentStats & { times: number[] }>()
  // Incoming customer messages by local weekday (0 = Sunday) and hour.
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const messages of threads.values()) {
    messages.sort((a, b) => a.sent_at.localeCompare(b.sent_at))
    const channel = messages[0].channel_id
    const stats = agents.get(channel) ?? { channel_id: channel, conversations: 0, inbound: 0, outbound: 0, customer_turns: 0, answered: 0, unanswered: 0,
      median_response_seconds: null, average_response_seconds: null, within_5_min: 0, within_1_hour: 0, times: [] }
    stats.conversations++
    let waitingSince: number | null = null
    for (const message of messages) {
      const at = Date.parse(message.sent_at)
      if (!Number.isFinite(at)) continue
      if (message.direction === 'inbound') {
        stats.inbound++
        const local = new Date(at + timezoneOffsetMinutes * 60000)
        heatmap[local.getUTCDay()][local.getUTCHours()]++
        if (waitingSince === null) { waitingSince = at; stats.customer_turns++ }
      } else {
        stats.outbound++
        if (waitingSince !== null) {
          const seconds = Math.max(0, Math.round((at - waitingSince) / 1000))
          stats.times.push(seconds); stats.answered++
          if (seconds <= 300) stats.within_5_min++
          if (seconds <= 3600) stats.within_1_hour++
          waitingSince = null
        }
      }
    }
    if (waitingSince !== null) stats.unanswered++
    agents.set(channel, stats)
  }
  const result: AgentStats[] = [...agents.values()].map(({ times, ...stats }) => ({
    ...stats,
    median_response_seconds: median(times),
    average_response_seconds: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
  }))
  return { agents: result.sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound)), heatmap }
}

export function formatDuration(seconds: number | null) {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) { const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h` }
  const d = Math.floor(seconds / 86400), h = Math.round((seconds % 86400) / 3600)
  return h ? `${d}d ${h}h` : `${d}d`
}
