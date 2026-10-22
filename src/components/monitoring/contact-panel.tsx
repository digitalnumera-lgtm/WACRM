'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Building2, ChevronDown, Copy, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, X } from 'lucide-react'
import { leadStatuses, type LeadAudit, type MonitoringChannel, type MonitoringThread } from '@/lib/monitoring/types'
import type { ContactProfile, ConversationPriority, MonitoringLabel } from '@/lib/monitoring/workflow-types'
import { LabelPicker } from './labels'
import { useCan } from './access'
import { api, Avatar, buttonClass, inputClass, LabelChip, Menu, primaryButton, priorityMeta, sendJson, timeAgo } from './ui'

type Related = Pick<MonitoringThread, 'id' | 'channel_id' | 'lead_status' | 'last_message_at' | 'last_preview' | 'last_direction' | 'message_count' | 'customer_name'>

function Section({ title, children, defaultOpen = true, action }: { title: string; children: ReactNode; defaultOpen?: boolean; action?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className="border-b border-border">
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      <button type="button" aria-expanded={open} className="flex flex-1 items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground" onClick={() => setOpen(v => !v)}><ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} />{title}</button>{action}
    </div>
    {open && <div className="px-4 pb-4">{children}</div>}
  </section>
}

export function ContactPanel({ thread, channels, labels, workflowReady, onPatched, onOpenThread, onClose }: {
  thread: MonitoringThread; channels: MonitoringChannel[]; labels: MonitoringLabel[]; workflowReady: boolean | null;
  onPatched: (patch: Partial<MonitoringThread>) => void; onOpenThread: (id: string) => void; onClose: () => void
}) {
  const canView = useCan('view_contacts'), canEdit = useCan('edit_contacts'), canLead = useCan('edit_lead_stage')
  const canPriority = useCan('manage_conversations'), canLabel = useCan('apply_labels')
  const [profile, setProfile] = useState<ContactProfile | null>(null)
  const [related, setRelated] = useState<Related[]>([])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const channel = channels.find(c => c.id === thread.channel_id)
  const name = profile?.name || thread.customer_name || `+${thread.customer}`

  useEffect(() => {
    if (!canView) return
    const controller = new AbortController()
    api<{ profile: ContactProfile | null; conversations: Related[] }>(`/api/monitoring/contacts/profile?customer=${encodeURIComponent(thread.customer)}`, { signal: controller.signal })
      .then(data => { setProfile(data.profile); setRelated(data.conversations); setError('') })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [thread.customer, revision, canView])

  async function act(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const setLead = (lead_status: string) => act(async () => { await api(`/api/monitoring/threads/${thread.id}`, sendJson('PATCH', { lead_status })); onPatched({ lead_status }) })
  const setPriority = (priority: ConversationPriority) => act(async () => { await api(`/api/monitoring/threads/${thread.id}/workflow`, sendJson('PATCH', { action: 'priority', priority })); onPatched({ priority }) })
  const setLabels = (label_ids: string[]) => act(async () => { onPatched({ label_ids }); await api(`/api/monitoring/threads/${thread.id}/labels`, sendJson('PUT', { label_ids })) })
  const threadLabels = (thread.label_ids ?? []).map(id => labels.find(l => l.id === id)).filter((l): l is MonitoringLabel => !!l)
  const others = related.filter(r => r.id !== thread.id)

  return <aside aria-label="Contact details" className="flex h-full min-h-0 flex-col overflow-y-auto border-l border-border bg-card">
    <div className="flex items-center justify-between px-4 py-3"><h3 className="text-sm font-semibold">Contact</h3><button className={`${buttonClass} px-2 py-1.5`} aria-label="Close contact panel" onClick={onClose}><X size={16} /></button></div>
    {error && <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    <div className="border-b border-border px-4 pb-5 pt-1 text-center">
      <div className="flex justify-center"><Avatar name={name} seed={thread.customer} size="lg" /></div>
      <p className="mt-3 break-words text-lg font-semibold tracking-tight">{name}</p>
      {profile?.company && <p className="text-xs text-muted-foreground">{profile.company}</p>}
      <div className="mt-3 flex justify-center gap-2">
        <a href={`https://wa.me/${thread.customer}`} target="_blank" rel="noreferrer" aria-label="Open in WhatsApp" title="Open in WhatsApp" className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-muted"><MessageCircle size={15} /></a>
        <button aria-label="Copy number" title="Copy number" className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-muted" onClick={() => void navigator.clipboard?.writeText(`+${thread.customer}`)}><Copy size={15} /></button>
        {profile?.email && <a href={`mailto:${profile.email}`} aria-label="Email" title="Email" className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-muted"><Mail size={15} /></a>}
      </div>
      {!editing ? <ul className="mt-4 space-y-2 text-left text-sm">
        <li className="flex items-center gap-2"><Phone size={14} className="text-muted-foreground" /><a className="flex-1 truncate hover:text-primary" href={`https://wa.me/${thread.customer}`} target="_blank" rel="noreferrer">+{thread.customer}</a><button className="text-muted-foreground hover:text-foreground" aria-label="Copy number" onClick={() => void navigator.clipboard?.writeText(`+${thread.customer}`)}><Copy size={13} /></button></li>
        <li className="flex items-center gap-2"><Mail size={14} className="text-muted-foreground" />{profile?.email ? <a className="truncate hover:text-primary" href={`mailto:${profile.email}`}>{profile.email}</a> : <span className="text-muted-foreground">No email</span>}</li>
        <li className="flex items-center gap-2"><Building2 size={14} className="text-muted-foreground" /><span className={profile?.company ? '' : 'text-muted-foreground'}>{profile?.company || 'No company'}</span></li>
        <li className="flex items-center gap-2"><MapPin size={14} className="text-muted-foreground" /><span className={profile?.city ? '' : 'text-muted-foreground'}>{profile?.city || 'No city'}</span></li>
        {profile?.notes && <li className="whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-xs">{profile.notes}</li>}
        {canEdit && <li><button className={`${buttonClass} mt-1 w-full`} disabled={workflowReady === false} title={workflowReady === false ? 'Needs the inbox database update' : undefined} onClick={() => setEditing(true)}><Pencil size={14} />Edit contact</button></li>}
      </ul> : <ContactForm profile={profile} fallbackName={thread.customer_name} busy={busy} onCancel={() => setEditing(false)} onSave={values => act(async () => {
        const data = await api<{ profile: ContactProfile }>('/api/monitoring/contacts/profile', sendJson('PUT', { customer: thread.customer, ...values }))
        setProfile(data.profile); setEditing(false); setRevision(n => n + 1)
      })} />}
    </div>

    <Section title="Conversation">
      <div className="space-y-3">
        <label className="block text-xs font-medium text-muted-foreground">Lead stage<select aria-label="Lead stage" className={`${inputClass} mt-1 capitalize`} value={thread.lead_status} disabled={busy || !canLead} onChange={e => void setLead(e.target.value)}>{!leadStatuses.includes(thread.lead_status as typeof leadStatuses[number]) && <option>{thread.lead_status}</option>}{leadStatuses.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="block text-xs font-medium text-muted-foreground">Priority<select aria-label="Priority" className={`${inputClass} mt-1`} value={thread.priority ?? 'none'} disabled={busy || !workflowReady || !canPriority} onChange={e => void setPriority(e.target.value as ConversationPriority)}>{(['none', 'low', 'medium', 'high', 'urgent'] as const).map(p => <option key={p} value={p}>{priorityMeta[p].label}</option>)}</select></label>
        <div><p className="text-xs font-medium text-muted-foreground">Labels</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{threadLabels.map(l => <LabelChip key={l.id} label={l} onRemove={busy || !canLabel ? undefined : () => void setLabels((thread.label_ids ?? []).filter(id => id !== l.id))} />)}
            {workflowReady && canLabel && <Menu label="Add label" align="left" trigger={<><Plus size={13} /><span className="text-xs">Add</span></>}>{() => <LabelPicker labels={labels} selected={thread.label_ids ?? []} disabled={busy} onChange={ids => void setLabels(ids)} />}</Menu>}
            {workflowReady === false && <span className="text-xs text-muted-foreground">Needs the inbox database update</span>}
          </div>
        </div>
      </div>
    </Section>

    <Section title="Details">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Agent</dt><dd className="truncate font-medium">{channel?.label ?? '—'}</dd>
        <dt className="text-muted-foreground">Number</dt><dd className="truncate">{channel?.display_number ?? '—'}{channel && !channel.active && <span className="ml-1 text-xs text-amber-700">(removed)</span>}</dd>
        <dt className="text-muted-foreground">Status</dt><dd className="capitalize">{thread.state ?? '—'}{thread.snoozed_until && <span className="block text-xs text-muted-foreground">until {new Date(thread.snoozed_until).toLocaleString()}</span>}</dd>
        <dt className="text-muted-foreground">Messages</dt><dd>{thread.message_count.toLocaleString()}</dd>
        <dt className="text-muted-foreground">Last activity</dt><dd title={new Date(thread.last_message_at).toLocaleString()}>{new Date(thread.last_message_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        <dt className="text-muted-foreground">Last message</dt><dd>{thread.last_direction === 'inbound' ? 'From customer' : 'From agent'}</dd>
      </dl>
    </Section>

    {canView && <Section title={`Other conversations (${others.length})`} defaultOpen={others.length > 0}>
      {others.length === 0 ? <p className="text-xs text-muted-foreground">This customer has not messaged any other business number.</p>
        : <ul className="space-y-2">{others.map(r => { const c = channels.find(ch => ch.id === r.channel_id); return <li key={r.id}>
          <button className="w-full rounded-lg border border-border p-2.5 text-left hover:border-primary/50 hover:bg-muted/50" onClick={() => onOpenThread(r.id)}>
            <div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold">{c?.label ?? 'Number'}</span><span className="text-muted-foreground">{timeAgo(r.last_message_at)}</span></div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{r.last_preview || 'Media message'}</p>
            <p className="mt-1 text-[11px] capitalize text-muted-foreground">{r.lead_status} · {r.message_count} messages</p>
          </button></li> })}</ul>}
    </Section>}

    <Section title="Lead history" defaultOpen={false}>
      {/* Loaded only when opened, to keep switching chats fast. */}
      <LeadHistory threadId={thread.id} leadStatus={thread.lead_status} />
    </Section>
  </aside>
}

function LeadHistory({ threadId, leadStatus }: { threadId: string; leadStatus: string }) {
  const [audit, setAudit] = useState<LeadAudit[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    api<{ audit: LeadAudit[] }>(`/api/monitoring/threads/${threadId}?scroll=1&auditOnly=1&auditPage=0`, { signal: controller.signal })
      .then(data => setAudit(data.audit)).catch(() => { if (!controller.signal.aborted) setAudit([]) })
    return () => controller.abort()
  }, [threadId, leadStatus])
  if (!audit) return <p className="text-xs text-muted-foreground">Loading…</p>
  if (!audit.length) return <p className="text-xs text-muted-foreground">No lead stage changes yet.</p>
  return <ol className="space-y-2 border-l border-border pl-3">{audit.map(a => <li key={a.id} className="text-xs"><span className="capitalize">{a.previous_status}</span> → <span className="font-semibold capitalize">{a.new_status}</span><span className="block text-muted-foreground">{new Date(a.changed_at).toLocaleString()}</span></li>)}</ol>
}

function ContactForm({ profile, fallbackName, busy, onSave, onCancel }: { profile: ContactProfile | null; fallbackName: string | null; busy: boolean; onSave: (v: Record<string, string>) => void; onCancel: () => void }) {
  const [values, setValues] = useState({ name: profile?.name ?? fallbackName ?? '', email: profile?.email ?? '', company: profile?.company ?? '', city: profile?.city ?? '', notes: profile?.notes ?? '' })
  const field = (key: keyof typeof values, label: string, max: number, type = 'text') => <label className="block text-left text-xs font-medium text-muted-foreground">{label}<input type={type} className={`${inputClass} mt-1`} maxLength={max} value={values[key]} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} /></label>
  return <form className="mt-4 space-y-2" onSubmit={e => { e.preventDefault(); onSave(values) }}>
    {field('name', 'Name', 120)}{field('email', 'Email', 200, 'email')}{field('company', 'Company', 120)}{field('city', 'City', 120)}
    <label className="block text-left text-xs font-medium text-muted-foreground">About this contact<textarea className={`${inputClass} mt-1 min-h-20`} maxLength={2000} value={values.notes} onChange={e => setValues(v => ({ ...v, notes: e.target.value }))} /></label>
    <div className="flex gap-2 pt-1"><button className={`${primaryButton} flex-1`} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className={buttonClass} onClick={onCancel}>Cancel</button></div>
  </form>
}
