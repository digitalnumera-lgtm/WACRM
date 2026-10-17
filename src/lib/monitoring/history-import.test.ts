import { expect, it } from 'vitest'
import { historyMessages } from './history-import'
import { parseImportFile } from './import-file'
import { messageText } from './rich-message'
const row = { customer: '+92 3001234567', direction: 'inbound', timestamp: '2026-10-01T12:00:00+05:00', text: 'Hello 👋', kind: 'text' }
it('preserves unicode, timestamps, IDs and deterministic retry identities', () => {
  const a = historyMessages([row])[0]; const b = historyMessages([row])[0]
  expect(a.id).toBe(b.id); expect(a.timestamp).toBe('2026-10-01T07:00:00.000Z'); expect(a.text).toBe('Hello 👋')
  expect(historyMessages([{ ...row, id: 'wamid.original' }])[0].id).toBe('wamid.original')
})
it('rejects ambiguous dates, missing customers, directions, and foreign media URLs', () => {
  for (const invalid of [{ timestamp: '10/01/26' }, { customer: '' }, { direction: 'sent?' }, { media_id: 'https://evil.test' }]) expect(() => historyMessages([{ ...row, ...invalid }])).toThrow()
})
it('parses quoted CSV without corrupting multiline messages', () => {
  expect(parseImportFile('customer,text\r\n923001234567,"Hello, \"\"friend\"\"\n👋"', true)).toEqual([{ customer: '923001234567', text: 'Hello, "friend"\n👋' }])
  expect(() => parseImportFile('a,b\n"unfinished', true)).toThrow()
})
it('renders reactions, deletion and interactive replies without placeholders', () => {
  expect(messageText({ type: 'reaction', reaction: { emoji: '❤️' } })).toBe('Reacted ❤️')
  expect(messageText({ type: 'reaction', reaction: { emoji: '' } })).toBe('Reaction removed')
  expect(messageText({ type: 'revoke' })).toBe('This message was deleted')
  expect(messageText({ type: 'interactive', interactive: { button_reply: { title: 'Yes' } } })).toBe('Yes')
  expect(messageText({ type: 'image', image: { id: '123' } })).toBeNull()
})
