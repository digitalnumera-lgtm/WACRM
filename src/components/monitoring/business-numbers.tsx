'use client'

import { useState } from 'react'
import { Archive, MessageSquare, RotateCcw, Phone } from 'lucide-react'
import type { MonitoringChannel } from '@/lib/monitoring/types'

export function BusinessNumbers({ channels, onSaved, onOpen }: { channels: MonitoringChannel[]; onSaved: () => void; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<'active' | 'removed'>('active')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function change(channel: MonitoringChannel, active: boolean) {
    setBusy(channel.id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/monitoring/channels/${channel.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to update this number.')
      setConfirm(null); setNotice(active ? `${channel.label}: monitoring restored. Messages missed while removed are not automatically recovered.` : `${channel.label}: removed from monitoring. Saved conversations are still available.`)
      onSaved()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(null) }
  }
  const visible = channels.filter(channel => channel.active === (tab === 'active'))
  return <section className="space-y-4" aria-label="Manage business numbers">
    <div><h3 className="text-lg font-semibold">Your numbers</h3><p className="mt-1 text-sm text-muted-foreground">Manage which agent numbers this workspace monitors. Saved conversations stay available when a number is removed.</p></div>
    <div className="flex gap-2" aria-label="Number status">{(['active', 'removed'] as const).map(value => <button key={value} onClick={() => { setTab(value); setConfirm(null) }} aria-pressed={tab === value} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === value ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>{value === 'active' ? 'Active' : 'Removed'} ({channels.filter(c => c.active === (value === 'active')).length})</button>)}</div>
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{notice}</p>}
    <div className="grid gap-4 xl:grid-cols-2">{visible.map(channel => <article key={channel.id} className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Phone size={20} /></span><div className="min-w-0 flex-1"><h4 className="truncate font-semibold">{channel.label}</h4><p className="mt-1 text-sm text-muted-foreground">{channel.display_number}</p></div><span className={`rounded-full px-2 py-1 text-xs ${channel.active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{channel.active ? 'Monitoring' : 'Removed'}</span></div>
      <p className="my-4 text-xs text-muted-foreground">Last event: {channel.last_event_at ? new Date(channel.last_event_at).toLocaleString() : 'No events yet'}</p>
      <div className="flex flex-wrap gap-2"><button onClick={() => onOpen(channel.id)} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"><MessageSquare size={16} />View chats</button>{channel.active ? <button disabled={busy !== null} onClick={() => setConfirm(channel.id)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"><Archive size={16} />Remove from monitoring</button> : <button disabled={busy !== null} onClick={() => change(channel, true)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary hover:bg-primary/10 disabled:opacity-50"><RotateCcw size={16} />{busy === channel.id ? 'Restoring…' : 'Restore monitoring'}</button>}</div>
      {confirm === channel.id && <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4"><p className="text-sm">Stop receiving new messages and sending CRM replies for {channel.label}? Saved chats and the agent’s WhatsApp app remain available.</p><div className="mt-3 flex flex-wrap gap-2"><button disabled={busy !== null} onClick={() => change(channel, false)} className="rounded-lg bg-destructive px-3 py-2 text-sm text-white disabled:opacity-50">{busy === channel.id ? 'Removing…' : 'Confirm removal'}</button><button disabled={busy !== null} onClick={() => setConfirm(null)} className="rounded-lg border border-border px-3 py-2 text-sm">Cancel</button></div></div>}
    </article>)}</div>
    {visible.length === 0 && <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{tab === 'active' ? 'No active numbers. Add a number below or restore one from Removed.' : 'No removed numbers.'}</p>}
  </section>
}
