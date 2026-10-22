import { describe, expect, it } from 'vitest'
import { withoutImportedCopies } from './history-dedupe'
import type { StoredMessage } from './ingest'

const msg = (id: string, direction: 'inbound' | 'outbound', timestamp: string, text: string | null, kind = 'text'): StoredMessage =>
  ({ id, customer: '923001234567', name: null, direction, timestamp, kind, text, media_id: null })
const threads = new Map([['923001234567', { id: 't1' }]])

describe('history duplicates of imported messages', () => {
  it('drops a history message already stored from an import, keeps the rest', () => {
    const existing = [
      { thread_id: 't1', direction: 'inbound', sent_at: '2026-09-01T10:00:05Z', content: 'Is it  available?' },
      { thread_id: 't1', direction: 'outbound', sent_at: '2026-09-01T10:01:00Z', content: null },
    ]
    const kept = withoutImportedCopies([
      msg('wamid.a', 'inbound', '2026-09-01T10:00:00Z', 'is it available?'), // same text, 5 s apart
      msg('wamid.b', 'outbound', '2026-09-01T10:01:30Z', null, 'audio'), // both without text, 30 s apart
      msg('wamid.c', 'inbound', '2026-09-01T10:00:00Z', 'Price?'), // different text
      msg('wamid.d', 'inbound', '2026-09-01T12:00:00Z', 'is it available?'), // too far apart
    ], threads, existing)
    expect(kept.map(m => m.id)).toEqual(['wamid.c', 'wamid.d'])
  })

  it('matches each imported message only once', () => {
    const existing = [{ thread_id: 't1', direction: 'inbound', sent_at: '2026-09-01T10:00:00Z', content: 'ok' }]
    const kept = withoutImportedCopies([msg('wamid.a', 'inbound', '2026-09-01T10:00:00Z', 'ok'), msg('wamid.b', 'inbound', '2026-09-01T10:00:20Z', 'ok')], threads, existing)
    expect(kept.map(m => m.id)).toEqual(['wamid.b'])
  })
})
