// CRM permissions a custom team role can allow. Shared by the server (which
// enforces them on every /api/monitoring route) and the UI (which hides what
// a member cannot use). Owners and admins always have every permission.
// Keep in sync with the check constraint in supabase/numera/003_team_access_and_storage.sql.

export const PERMISSIONS = [
  'view_inbox', 'view_media', 'view_contacts', 'edit_contacts', 'manage_conversations',
  'edit_lead_stage', 'apply_labels', 'write_notes', 'view_reports', 'export_data',
  'manage_labels', 'manage_numbers', 'manage_settings',
] as const

export type Permission = typeof PERMISSIONS[number]

export const PERMISSION_GROUPS: { title: string; items: { key: Permission; label: string; hint: string }[] }[] = [
  { title: 'Conversations', items: [
    { key: 'view_inbox', label: 'See conversations', hint: 'Always on: inbox, messages, notes and message logs for the assigned numbers' },
    { key: 'view_media', label: 'Open media', hint: 'Photos, voice notes, videos, documents and the Media library' },
    { key: 'manage_conversations', label: 'Manage conversations', hint: 'Resolve, reopen, snooze, mark read or unread, set priority' },
    { key: 'apply_labels', label: 'Label conversations', hint: 'Add or remove labels on a chat' },
    { key: 'write_notes', label: 'Write private notes', hint: 'Notes are only visible inside the CRM' },
    { key: 'edit_lead_stage', label: 'Change lead stage', hint: 'New, contacted, qualified, won, lost' },
  ] },
  { title: 'Contacts', items: [
    { key: 'view_contacts', label: 'See contacts', hint: 'Contact details and the Contacts list' },
    { key: 'edit_contacts', label: 'Edit contacts', hint: 'Edit details and import address books' },
  ] },
  { title: 'Reports', items: [
    { key: 'view_reports', label: 'See dashboard and reports', hint: 'Activity, waiting times and agent performance' },
    { key: 'export_data', label: 'Export CSV', hint: 'Download message logs and reports' },
  ] },
  { title: 'Administration', items: [
    { key: 'manage_labels', label: 'Manage labels', hint: 'Create, rename and delete labels' },
    { key: 'manage_numbers', label: 'Manage business numbers', hint: 'Connect numbers, Meta access, history import, review events' },
    { key: 'manage_settings', label: 'Manage storage settings', hint: 'Media storage limits and cleanup' },
  ] },
]

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)
}

/** What the signed-in user may do in the CRM (returned by /api/monitoring/me). */
export interface MonitoringMe {
  /** Owner or admin: every permission, every number, team management. */
  full: boolean
  role: string
  permissions: Permission[]
  /** null = every business number. */
  channelIds: string[] | null
}

export function can(me: MonitoringMe | null | undefined, permission: Permission): boolean {
  return !!me && (me.full || me.permissions.includes(permission))
}
