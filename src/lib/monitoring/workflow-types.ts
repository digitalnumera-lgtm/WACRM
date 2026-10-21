export type ConversationState = 'open' | 'resolved' | 'snoozed'
export type ConversationPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'
export interface ThreadWorkflow {
  status: ConversationState
  snoozed_until: string | null
  unread_count: number
  marked_unread: boolean
  priority: ConversationPriority
  label_ids?: string[]
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
export interface MonitoringLabel {
  id: string
  name: string
  color: string
  description: string | null
}
export interface ContactProfile {
  customer: string
  name: string | null
  email: string | null
  company: string | null
  city: string | null
  notes: string | null
  updated_at: string | null
}

// Replace only supported tokens. Customer content is plain text, never HTML.
export function expandQuickReply(body: string, values: { name: string; phone: string; agent: string }) {
  return body.replace(/\{\{(name|phone|agent)\}\}/g, (_, key: keyof typeof values) => values[key])
}
