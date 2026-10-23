import { describe, expect, it } from 'vitest'
import { messagesForPath, pick } from './area-messages'

const all = { LoginPage: { a: 1 }, Settings: { roles: { r: 1 }, other: 2 }, JoinPage: { j: 1 }, Flows: { big: 1 } }

describe('messagesForPath', () => {
  it('sends nothing to Chats and Clients', () => {
    expect(messagesForPath(all, '/monitoring')).toEqual({})
    expect(messagesForPath(all, '/tracker')).toEqual({})
  })
  it('sends only the sign-in sections to sign-in pages', () => expect(messagesForPath(all, '/login')).toEqual({ LoginPage: { a: 1 } }))
  it('keeps a nested section for the invite page', () => expect(messagesForPath(all, '/join/abc')).toEqual({ JoinPage: { j: 1 }, Settings: { roles: { r: 1 } } }))
  it('sends everything elsewhere', () => expect(messagesForPath(all, '/settings')).toBe(all))
  it('does not match look-alike paths', () => expect(messagesForPath(all, '/monitoringx')).toBe(all))
  it('pick ignores missing sections', () => expect(pick(all, ['Nope'])).toEqual({}))
})
