export function messageText(raw: Record<string, unknown>): string | null {
  const kind = String(raw.type ?? '')
  const value = raw[kind] as Record<string, unknown> | undefined
  if (kind === 'text') return typeof value?.body === 'string' ? value.body : null
  if (typeof value?.caption === 'string') return value.caption
  if (kind === 'reaction') return typeof value?.emoji === 'string' && value.emoji ? `Reacted ${value.emoji}` : 'Reaction removed'
  if (kind === 'revoke') return 'This message was deleted'
  if (kind === 'location' && value) return [value.name, value.address, `Location: ${value.latitude}, ${value.longitude}`].filter(Boolean).join('\n')
  if (kind === 'contacts' && Array.isArray(raw.contacts)) return raw.contacts.map(c => [c.name?.formatted_name, ...(c.phones ?? []).map((p: { phone?: string }) => p.phone)].filter(Boolean).join(' · ')).join('\n')
  if (kind === 'button') return typeof value?.text === 'string' ? value.text : null
  if (kind === 'interactive' && value) {
    const reply = (value.button_reply ?? value.list_reply ?? value.nfm_reply) as Record<string, unknown> | undefined
    return reply ? [reply.title, reply.description, reply.body].filter(v => typeof v === 'string').join('\n') : null
  }
  if (kind === 'document') return typeof value?.filename === 'string' ? value.filename : null
  return null
}
