export interface ActivityRow { channel_id: string; direction: string; sent_at: string; kind: string }
export function activityReport(rows: ActivityRow[], start: string, days: number) {
  const daily = Array.from({ length: days }, (_, i) => ({ date: new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10), inbound: 0, outbound: 0 }))
  const dates = new Map(daily.map(d => [d.date, d]))
  const numbers = new Map<string, { channel_id: string; inbound: number; outbound: number }>()
  const formats: Record<string, number> = {}
  let inbound = 0, outbound = 0
  for (const row of rows) {
    const day = dates.get(row.sent_at.slice(0, 10))
    if (!day || (row.direction !== 'inbound' && row.direction !== 'outbound')) continue
    const number = numbers.get(row.channel_id) ?? { channel_id: row.channel_id, inbound: 0, outbound: 0 }
    day[row.direction]++; number[row.direction]++
    numbers.set(row.channel_id, number)
    if (row.direction === 'inbound') inbound++; else outbound++
    formats[row.kind] = (formats[row.kind] ?? 0) + 1
  }
  return { daily, numbers: [...numbers.values()], formats, inbound, outbound }
}
