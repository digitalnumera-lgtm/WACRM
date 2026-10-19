import { checkedId, MonitoringInputError, pageNumber } from './http'

export const mediaKinds = ['image', 'audio', 'video', 'document', 'sticker'] as const
export function messageFilters(params: URLSearchParams) {
  const page = pageNumber(params.get('page'))
  const channel = params.get('channel') ? checkedId(params.get('channel')!) : null
  const thread = params.get('thread') ? checkedId(params.get('thread')!) : null
  const direction = params.get('direction') || null
  if (direction && !['inbound', 'outbound'].includes(direction)) throw new MonitoringInputError('Invalid direction')
  const kind = params.get('kind') || null
  if (kind && !/^[a-z_]{1,40}$/.test(kind)) throw new MonitoringInputError('Invalid message type')
  const q = (params.get('q') ?? '').trim()
  if (q.length > 120) throw new MonitoringInputError('Search is too long')
  const parseDate = (key: string) => {
    const value = params.get(key)
    if (!value) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new MonitoringInputError('Invalid date')
    return value
  }
  const from = parseDate('from'), to = parseDate('to')
  if (from && to && from > to) throw new MonitoringInputError('Start date must be before end date')
  const until = to ? new Date(Date.parse(to) + 86400000).toISOString() : null
  return { page, channel, thread, direction, kind, q, from, until, mediaOnly: params.get('media') === 'true' }
}

