export type ConversationState = 'open' | 'resolved' | 'snoozed'
export interface ThreadWorkflow {
  status: ConversationState
  snoozed_until: string | null
  unread_count: number
  marked_unread: boolean
}
export interface InternalNote {
  id: string
  body: string
  author: string
  created_at: string
}
export interface QuickReply {
  id: string
  title: string
  body: string
  version: string
}

// Replace only supported tokens. Customer content is plain text, never HTML.
export function expandQuickReply(body: string, values: { name: string; phone: string; agent: string }) {
  return body.replace(/\{\{(name|phone|agent)\}\}/g, (_, key: keyof typeof values) => values[key])
}
