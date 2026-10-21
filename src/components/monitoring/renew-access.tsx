'use client'

import { useState } from 'react'
import type { MonitoringChannel } from '@/lib/monitoring/types'

export function RenewMetaAccess({ channels }: { channels: MonitoringChannel[] }) {
  const [token, setToken] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function renew() {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/monitoring/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: token.trim(), channel_ids: selected }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to renew access.')
      setToken(''); setNotice(`Access renewed for ${result.updated} ${result.updated === 1 ? 'number' : 'numbers'}. Return to the chat and retry the attachment. Files Meta no longer retains cannot be restored by renewing access.`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <section aria-label="Meta access" className="max-w-2xl space-y-4 rounded-xl border border-border bg-card p-6">
    <div><h3 className="text-lg font-semibold">Meta access</h3><p className="mt-2 text-sm text-muted-foreground">Renew the access used to load media and send management replies. Use a fresh token from your waCRM Meta app with access to the selected WhatsApp accounts.</p></div>
    <p className="text-xs text-muted-foreground">A revoked or expired token can stop media downloads while webhook messages still arrive. Renewal preserves numbers, monitoring status, provider connections and saved chats.</p>
    <fieldset disabled={busy} className="space-y-2"><legend className="mb-2 text-sm font-medium">Business numbers</legend><button type="button" disabled={!channels.length} className="text-xs text-primary underline disabled:opacity-40" onClick={() => setSelected(selected.length === channels.length ? [] : channels.map(c => c.id))}>{selected.length === channels.length && channels.length ? 'Clear selection' : 'Select all numbers'}</button><div className="max-h-60 space-y-2 overflow-y-auto">{channels.map(channel => <label key={channel.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"><input type="checkbox" checked={selected.includes(channel.id)} onChange={e => setSelected(old => e.target.checked ? [...old, channel.id] : old.filter(id => id !== channel.id))} /><span>{channel.label} · {channel.display_number}{!channel.active && ' · Monitoring removed'}</span></label>)}</div>{!channels.length && <p className="text-sm text-muted-foreground">Add a business number first.</p>}</fieldset>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void renew() }}><label className="block text-sm font-medium">New Meta access token<input aria-label="New Meta access token" type="password" autoComplete="new-password" spellCheck={false} maxLength={8192} disabled={busy} value={token} onChange={e => setToken(e.target.value)} className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-sm" placeholder="Paste the new token here" required /></label><p className="text-xs text-muted-foreground">Required permissions: whatsapp_business_management and whatsapp_business_messaging. The server verifies account access and stores the token encrypted.</p><button disabled={busy || !token.trim() || !selected.length} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40">{busy ? 'Verifying selected numbers…' : 'Verify and renew access'}</button></form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
  </section>
}
