import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), decrypt: vi.fn(() => 'token') }))
vi.mock('./media', () => ({ fetchMonitoringMedia: mocks.fetch }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }))
import { archiveDeliveredMedia } from './media-archive'

afterEach(() => vi.clearAllMocks())
function db(rows: { id: string; media_id: string }[], archived: string[] = []) {
  const upload = vi.fn().mockResolvedValue({ error: null })
  const from = (table: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'not']) q[m] = () => q
    q.maybeSingle = () => Promise.resolve({ data: { encrypted_token: 'cipher' }, error: null })
    q.then = (r: (v: unknown) => unknown) => Promise.resolve(table === 'monitoring_messages' ? { data: rows, error: null } : { data: [], error: null }).then(r)
    return q
  }
  const storage = { from: () => ({ upload, createSignedUrl: (path: string) => Promise.resolve(archived.includes(path) ? { data: { signedUrl: 'https://signed' }, error: null } : { data: null, error: { message: 'Object not found' } }) }) }
  return { client: { from, storage }, upload }
}

describe('permanent media archive', () => {
  it('copies new media once, skipping files already stored and failures', async () => {
    const { client, upload } = db([{ id: 'm1', media_id: '1' }, { id: 'm2', media_id: '2' }, { id: 'm3', media_id: '3' }], ['acc/m2'])
    mocks.fetch.mockImplementation(async (id: string) => { if (id === '3') throw new Error('expired'); return { bytes: new Uint8Array([1]), type: 'image/jpeg' } })
    await archiveDeliveredMedia(client as never, [{ channelId: 'ch', accountId: 'acc', metaIds: ['a', 'b', 'c'] }])
    expect(upload).toHaveBeenCalledExactlyOnceWith('acc/m1', new Uint8Array([1]), expect.objectContaining({ contentType: 'image/jpeg' }))
  })
  it('bounds work per delivery', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, media_id: String(i) }))
    const { client, upload } = db(rows)
    mocks.fetch.mockResolvedValue({ bytes: new Uint8Array([1]), type: 'audio/ogg' })
    await archiveDeliveredMedia(client as never, [{ channelId: 'ch', accountId: 'acc', metaIds: rows.map(r => r.id) }], 5)
    expect(upload).toHaveBeenCalledTimes(5)
  })
})
