import { checkedId, MonitoringInputError } from './http'

export function readCursor(value: string | null) {
  if (!value) return null
  const parts = value.split('|')
  if (parts.length !== 2 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(parts[0]) || !Number.isFinite(Date.parse(parts[0]))) throw new MonitoringInputError('Invalid scroll cursor')
  return { time: parts[0], id: checkedId(parts[1]) }
}

export function cursorFilter(column: 'sent_at' | 'last_message_at', cursor: NonNullable<ReturnType<typeof readCursor>>, newer = false) {
  const op = newer ? 'gt' : 'lt'
  return `${column}.${op}."${cursor.time}",and(${column}.eq."${cursor.time}",id.${op}.${cursor.id})`
}

export function makeCursor(row: { id: string; sent_at?: string; last_message_at?: string }) {
  return `${row.sent_at ?? row.last_message_at}|${row.id}`
}
