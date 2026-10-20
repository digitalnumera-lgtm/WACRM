'use client'

import { useState } from 'react'

export function MonitoringSettings({ enabled, onSaved }: { enabled: boolean | null; onSaved: (enabled: boolean) => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  return <section className="max-w-2xl rounded-xl border border-border bg-card p-6">
    <h3 className="text-lg font-semibold">Management replies</h3>
    <p className="mt-2 text-sm text-muted-foreground">Choose whether owners and admins can reply to customers from this CRM. Applies to every business number in this workspace.</p>
    <div className="my-5 flex items-center justify-between gap-4 rounded-lg bg-muted/50 p-4"><div><p className="font-medium">Allow management replies</p><p className="mt-1 text-xs text-muted-foreground">{enabled === null ? 'Loading setting…' : enabled ? 'Enabled · Reply panel visible' : 'Disabled · Monitoring only'}</p></div><button type="button" role="switch" aria-label="Allow management replies" aria-checked={enabled === true} disabled={saving || enabled === null} onClick={async () => {
      setSaving(true); setSaved(false); setError('')
      try {
        const response = await fetch('/api/monitoring/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ management_replies_enabled: !enabled }) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to save settings.')
        onSaved(data.management_replies_enabled); setSaved(true)
      } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
    }} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-primary' : 'bg-slate-400'}`}><span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-transform ${enabled ? 'left-1 translate-x-5' : 'left-1'}`} /></button></div>
    <p className="text-sm text-muted-foreground">When off, the entire reply panel and reply-window notice are hidden, and new CRM sends are blocked. Incoming messages, phone-app replies, saved chats and media remain available.</p>
    <p className="mt-3 text-xs text-muted-foreground">Messages already submitted cannot be recalled. WhatsApp’s reply-window rules still apply when you enable replies.</p>
    {saving && <p role="status" className="mt-4 text-sm">Saving…</p>}{saved && <p role="status" className="mt-4 text-sm text-emerald-700 dark:text-emerald-400">Setting saved for this workspace.</p>}{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
  </section>
}
