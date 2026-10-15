export interface MonitoringChannel {
  id: string; account_id: string; phone_number_id: string; waba_id: string;
  label: string; display_number: string; active: boolean; last_event_at: string | null;
}
export interface MonitoringThread {
  id: string; channel_id: string; customer: string; customer_name: string | null;
  lead_status: string; last_message_at: string; last_preview: string | null;
  last_direction: string; message_count: number;
}
export interface MonitoringMessage {
  id: string; direction: string; sent_at: string; kind: string;
  content: string | null; media_id: string | null;
}
export interface LeadAudit {
  id: string; changed_by: string; previous_status: string; new_status: string; changed_at: string;
}
export interface ThreadDetail {
  thread: MonitoringThread; messages: MonitoringMessage[]; messageTotal: number;
  audit: LeadAudit[]; auditTotal: number;
}
export const leadStatuses = ['new', 'contacted', 'qualified', 'won', 'lost'] as const
