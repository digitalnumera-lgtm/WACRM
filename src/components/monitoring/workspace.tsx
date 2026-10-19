'use client'

import { useEffect, useState } from 'react'
import { LayoutDashboard, Inbox, Users, ImageIcon, List, ChartNoAxesCombined, Phone, History, CircleAlert, ArrowLeft, MessageSquare } from 'lucide-react'
import { BusinessNumbers } from './business-numbers'
import { MessageMedia } from './message-media'
import { ContactsPanel } from './contacts-panel'
import { MessageBrowser, ReportsPanel } from './activity-panels'
import { ReplyComposer } from './reply-composer'
import { HistoryImport, PortfolioPicker } from './setup-panels'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { leadStatuses, type MonitoringChannel, type MonitoringThread, type ThreadDetail } from '@/lib/monitoring/types'

const navigation = [
  { name: 'Dashboard', icon: LayoutDashboard }, { name: 'Inbox', icon: Inbox },
  { name: 'Contacts', icon: Users }, { name: 'Media', icon: ImageIcon },
  { name: 'Message logs', icon: List }, { name: 'Reports', icon: ChartNoAxesCombined },
  { name: 'Business numbers', icon: Phone }, { name: 'Import history', icon: History },
  { name: 'Events for review', icon: CircleAlert },
]

const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm'
const buttonClass = 'rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'No events yet'

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? 'Unable to load monitoring data.')
  return value as T
}

export function MonitoringSignOut() {
  const [error, setError] = useState('')
  const router = useRouter()
  return <><button className={buttonClass} onClick={async () => {
    const result = await createClient().auth.signOut()
    if (result.error) { setError('Unable to sign out. Please try again.'); return }
    router.replace('/login')
    router.refresh()
  }}>Sign out</button>{error && <p role="alert">{error}</p>}</>
}

export function MonitoringWorkspace({ accountName }: { accountName: string }) {
  const [channels, setChannels] = useState<MonitoringChannel[]>([])
  const [threads, setThreads] = useState<MonitoringThread[]>([])
  const [filters, setFilters] = useState({ q: '', channel: '', agent: '', status: '' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [messagePage, setMessagePage] = useState(0)
  const [auditPage, setAuditPage] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState('Inbox')

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setRefresh(n => n + 1) }, 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const params = new URLSearchParams({ ...filters, page: String(page) })
    api<{ channels: MonitoringChannel[]; threads: MonitoringThread[]; total: number }>(`/api/monitoring?${params}`, { signal: controller.signal })
      .then(data => { setChannels(data.channels); setThreads(data.threads); setTotal(data.total); setError('') })
      .catch(err => { if (!controller.signal.aborted) { setThreads([]); setError(err.message) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filters, page, refresh])

  useEffect(() => {
    if (!selected) { setDetail(null); return }
    const controller = new AbortController()
    setDetailLoading(true)
    api<ThreadDetail>(`/api/monitoring/threads/${selected}?page=${messagePage}&auditPage=${auditPage}`, { signal: controller.signal })
      .then(data => { setDetail(data); setDetailError('') })
      .catch(err => { if (!controller.signal.aborted) { setDetail(null); setDetailError(err.message) } })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false) })
    return () => controller.abort()
  }, [selected, messagePage, auditPage, refresh])

  function filter(key: keyof typeof filters, value: string) {
    setFilters(current => ({ ...current, [key]: value })); setPage(0)
    setSelected(null); setDetail(null)
  }
  function select(id: string) {
    setSelected(id); setDetail(null); setDetailError(''); setMessagePage(0); setAuditPage(0)
  }
  const activeChannel = channels.find(channel => channel.id === detail?.thread.channel_id)

  return <div className="monitoring-panel min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[220px_1fr]">
    <aside className={`border-r border-border bg-card p-4 lg:sticky lg:top-0 lg:h-screen ${view === 'Inbox' && selected ? 'hidden lg:block' : ''}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Numera Digital</p><h1 className="mt-2 truncate text-lg font-semibold" title={accountName}>{accountName}</h1>
      <p className="mb-6 mt-2 text-xs text-muted-foreground">Management workspace</p>
      <nav aria-label="Workspace" className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">{navigation.map(({ name, icon: Icon }) => <button key={name} onClick={() => setView(name)} aria-current={view === name ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${view === name ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon size={18} aria-hidden="true" />{name}</button>)}</nav><div className="mt-4 lg:mt-8"><MonitoringSignOut /></div>
    </aside>
    <main className="min-w-0 space-y-4 p-4 lg:p-6">
      <header className={`items-center justify-between border-b border-border pb-4 ${view === 'Inbox' && selected ? 'hidden lg:flex' : 'flex'}`}><h2 className="text-xl font-semibold">{view}</h2><button className={buttonClass} onClick={() => setRefresh(n => n + 1)} disabled={loading}>Refresh</button></header>
      {view === 'Business numbers' && <><BusinessNumbers channels={channels} onSaved={() => setRefresh(n => n + 1)} onOpen={id => { filter('channel', id); setView('Inbox') }} /><details className="rounded-xl border border-border bg-card p-3"><summary className="cursor-pointer p-2 font-medium">Add a number from Meta portfolio</summary><PortfolioPicker onSaved={() => setRefresh(n => n + 1)} /></details><details><summary className="cursor-pointer p-3 text-sm">Enter number details manually</summary><ChannelManager channels={channels} onSaved={() => setRefresh(n => n + 1)} /></details></>}
      {view === 'Import history' && <HistoryImport channels={channels} onSaved={() => setRefresh(n => n + 1)} />}
      {view === 'Events for review' && <ReviewEvents channels={channels} />}
      {view === 'Dashboard' && <>
      <section aria-label="Business number activity" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {channels.map(channel => <button key={channel.id} onClick={() => { filter('channel', channel.id); setView('Inbox') }} className={`rounded-xl border p-4 text-left ${filters.channel === channel.id ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
          <p className="truncate font-semibold">{channel.label}</p><p className="mt-1 text-sm">{channel.display_number}</p><p className="mt-3 text-xs text-muted-foreground">{channel.active ? 'Monitoring enabled' : 'Monitoring paused'}</p><p className="mt-1 text-xs text-muted-foreground">Last event: {date(channel.last_event_at)}</p>
        </button>)}
      </section>
      </>}
      {view === 'Dashboard' && <Dashboard refresh={refresh} />}
      {view === 'Contacts' && <ContactsPanel channels={channels} onOpen={id => { select(id); setView('Inbox') }} />}
      {(view === 'Media' || view === 'Message logs') && <MessageBrowser key={view} channels={channels} media={view === 'Media'} refresh={refresh} onOpen={id => { select(id); setView('Inbox') }} />}
      {view === 'Reports' && <ReportsPanel channels={channels} refresh={refresh} />}
      {view === 'Inbox' && <>
      <section className={`rounded-xl border border-border bg-card p-4 ${selected ? 'hidden lg:block' : ''}`}>
        <div className="mb-3 flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Conversations across your business numbers</p>{Object.values(filters).some(Boolean) && <button className="text-xs font-medium text-primary" onClick={() => { setFilters({ q: '', channel: '', agent: '', status: '' }); setSearch(''); setPage(0); setSelected(null); setDetail(null) }}>Clear filters</button>}</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); filter('q', search.trim()) }}><label className="sr-only" htmlFor="monitor-search">Search conversations</label><input id="monitor-search" className={inputClass} placeholder="Search customer or latest message" maxLength={120} value={search} onChange={e => setSearch(e.target.value)} /><button className={buttonClass}>Search</button></form>
          <label className="text-xs text-muted-foreground">Business number<select aria-label="Business number" className={inputClass} value={filters.channel} onChange={e => filter('channel', e.target.value)}><option value="">All numbers</option>{channels.map(c => <option key={c.id} value={c.id}>{c.display_number}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Assigned agent label<select aria-label="Assigned agent label" className={inputClass} value={filters.agent} onChange={e => filter('agent', e.target.value)}><option value="">All agents</option>{[...new Set(channels.map(c => c.label))].map(label => <option key={label}>{label}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Lead status<select aria-label="Lead status filter" className={inputClass} value={filters.status} onChange={e => filter('status', e.target.value)}><option value="">All statuses</option>{leadStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
        </div>
      </section>
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">{error}</p>}
      <div className="grid items-start gap-0 overflow-hidden rounded-xl border border-border lg:grid-cols-[320px_minmax(0,1fr)]">
        <section aria-label="Conversations" aria-busy={loading} className={`overflow-hidden border-r border-border bg-card ${selected ? 'hidden lg:block' : ''}`}>
          <div className="border-b border-border px-4 py-3 text-sm font-medium">{total} conversations {loading && <span className="text-muted-foreground">· Updating…</span>}</div>
          {!loading && !error && threads.length === 0 && <p className="p-6 text-sm text-muted-foreground">{channels.length ? 'No conversations match these filters.' : 'Add a business number to start monitoring. New conversations appear when verified events arrive.'}</p>}
          <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">{threads.map(thread => {
            const channel = channels.find(c => c.id === thread.channel_id)
            return <li key={thread.id}><button onClick={() => select(thread.id)} aria-pressed={selected === thread.id} className={`w-full p-4 text-left hover:bg-muted ${selected === thread.id ? 'bg-primary/10' : ''}`}>
              <div className="flex items-center gap-3"><span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{(thread.customer_name || thread.customer).slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1 truncate font-semibold">{thread.customer_name || thread.customer}</span><span className="rounded bg-muted px-2 py-1 text-xs">{thread.lead_status}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">{channel?.display_number ?? 'Unknown number'} · {channel?.label ?? 'Unassigned'}</p>
              <p className="mt-3 truncate text-sm">{thread.last_preview || 'Media or non-text message'}</p><p className="mt-2 text-xs text-muted-foreground">{date(thread.last_message_at)} · {thread.message_count} {thread.message_count === 1 ? 'message' : 'messages'}</p>
            </button></li>
          })}</ul>
          <Pagination page={page} size={30} total={total} setPage={setPage} disabled={loading} />
        </section>
        <section aria-label="Conversation detail" aria-busy={detailLoading} className={`min-w-0 bg-card ${selected ? '' : 'hidden lg:block'}`}>
          <button onClick={() => { setSelected(null); setDetail(null) }} className="m-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm lg:hidden"><ArrowLeft size={16} />All conversations</button>
          {detailError && <p role="alert" className="p-5 text-destructive">{detailError}</p>}
          {!detail && <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4 p-10 text-center text-muted-foreground"><MessageSquare size={40} className="text-primary/40" /><p>{detailLoading ? 'Loading conversation…' : 'Choose a conversation'}</p><p className="max-w-xs text-sm">Read messages, view media and reply from one place.</p></div>}
          {detail && <>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div><h2 className="text-lg font-semibold">{detail.thread.customer_name || detail.thread.customer}</h2><p className="text-sm text-muted-foreground">{detail.thread.customer}</p><p className="mt-2 text-sm">Business number: {activeChannel?.display_number ?? 'Unknown'}</p><p className="text-sm">Assigned agent: {activeChannel?.label ?? 'Unassigned'}</p></div>
              <label className="text-xs text-muted-foreground">Lead status<select aria-label="Conversation lead status" className={inputClass} value={detail.thread.lead_status} disabled={saving || detailLoading} onChange={async e => {
                setSaving(true)
                try { await api(`/api/monitoring/threads/${detail.thread.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_status: e.target.value }) }); setRefresh(n => n + 1) }
                catch (err) { setDetailError((err as Error).message) }
                finally { setSaving(false) }
              }}>{!leadStatuses.includes(detail.thread.lead_status as typeof leadStatuses[number]) && <option>{detail.thread.lead_status}</option>}{leadStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
            </div>
            <nav aria-label="Message history" className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
              <button className={buttonClass} disabled={detailLoading || (messagePage + 1) * 50 >= detail.messageTotal} onClick={() => setMessagePage(p => p + 1)}>Older messages</button>
              <span className="text-xs text-muted-foreground">{detail.messageTotal.toLocaleString()} saved messages · {messagePage === 0 ? 'Latest' : `History page ${messagePage + 1}`}</span>
              <button className={buttonClass} disabled={detailLoading || messagePage === 0} onClick={() => setMessagePage(p => p - 1)}>Newer messages</button>
              {messagePage > 1 && <button className="text-xs text-primary" disabled={detailLoading} onClick={() => setMessagePage(0)}>Jump to latest</button>}
            </nav>
            <div className="h-[55vh] space-y-3 overflow-y-auto bg-muted/20 p-5">{[...detail.messages].reverse().map(message => <article key={message.id} className={`max-w-[90%] rounded-xl border border-border p-3 ${message.direction === 'outbound' ? 'ml-auto bg-primary/10' : 'bg-card'}`}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{message.direction === 'outbound' ? `${activeChannel?.label ?? 'Business'} · Outgoing` : 'Customer'}</p>{message.reaction && <div className="mb-2 rounded-lg bg-muted p-2 text-xs">{message.reaction.emoji || 'Reaction removed'} · {detail.messages.find(m => m.meta_id === message.reaction?.target)?.content || 'Reaction to an earlier message'}</div>}{(!message.reaction && (message.content || !message.media_id)) && <p className="whitespace-pre-wrap break-words text-sm">{message.content || (message.kind === 'revoke' ? 'This message was deleted' : 'This message format is not available yet.')}</p>}<MessageMedia key={message.id} message={message} /><time className="mt-2 block text-xs text-muted-foreground">{date(message.sent_at)}</time>
            </article>)}{detail.messages.length === 0 && <p className="text-sm text-muted-foreground">No messages on this page.</p>}</div>
            <ReplyComposer key={detail.thread.id} threadId={detail.thread.id} onSent={() => { setMessagePage(0); setRefresh(n => n + 1) }} />
            <details className="border-t border-border p-5"><summary className="cursor-pointer font-semibold">Lead history</summary><ul className="mt-3 space-y-2 text-sm">{detail.audit.map(item => <li key={item.id}><span className="font-medium">{item.previous_status} → {item.new_status}</span><span className="ml-2 text-xs text-muted-foreground">{date(item.changed_at)} · User {item.changed_by.slice(0, 8)}</span></li>)}</ul>{detail.audit.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No lead-status changes recorded.</p>}<Pagination page={auditPage} size={25} total={detail.auditTotal} setPage={setAuditPage} disabled={detailLoading} label="audit" /></details>
          </>}
        </section>
      </div>
      </>}
      <p className="text-xs text-muted-foreground">Agents use their WhatsApp Business apps. Owners and admins can review conversations, update leads and send replies from this workspace.</p>
    </main>
  </div>
}

function Pagination({ page, size, total, setPage, disabled, label = 'conversation' }: { page: number; size: number; total: number; setPage: (page: number) => void; disabled?: boolean; label?: string }) {
  return <nav aria-label={`${label} pages`} className="flex items-center justify-between gap-2 border-t border-border p-3"><button className={buttonClass} disabled={disabled || page === 0} onClick={() => setPage(page - 1)}>Previous</button><span className="text-xs text-muted-foreground">Page {page + 1} of {Math.max(1, Math.ceil(total / size))}</span><button className={buttonClass} disabled={disabled || (page + 1) * size >= total} onClick={() => setPage(page + 1)}>Next</button></nav>
}

function ChannelManager({ channels, onSaved }: { channels: MonitoringChannel[]; onSaved: () => void }) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  return <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Business numbers</h2><p className="mt-1 text-sm text-muted-foreground">Add a number using credentials for your Numera Meta app. Saving verifies its details and stores its encrypted credential. It does not register the number or change WabaCRM subscriptions.</p>
    <p className="mt-2 text-xs text-muted-foreground">Use the agent’s name as the label. This label identifies their number in the inbox and agent filter.</p>
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setSaving(true); setError(''); setSuccess(false)
      try { await api('/api/monitoring/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(data)) }); form.reset(); setSuccess(true); onSaved() }
      catch (err) { setError((err as Error).message) }
      finally { setSaving(false) }
    }}>
      <label className="text-sm">Agent label<input className={inputClass} name="label" maxLength={120} required autoComplete="off" /></label><label className="text-sm">Phone number ID<input className={inputClass} name="phone_number_id" pattern="[0-9]+" maxLength={40} required /></label><label className="text-sm">WhatsApp Business Account ID<input className={inputClass} name="waba_id" pattern="[0-9]+" maxLength={40} required /></label><label className="text-sm">Numera app access token<input className={inputClass} name="access_token" type="password" autoComplete="new-password" maxLength={8192} required /></label><div><button className={buttonClass} disabled={saving}>{saving ? 'Verifying…' : 'Verify and add number'}</button></div>
    </form>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{success && <p role="status" className="mt-3 text-sm">Number saved. Webhook delivery still needs to be verified.</p>}
    <p className="mt-3 text-xs text-muted-foreground">{channels.length} configured numbers. Paused numbers remain paused.</p>
  </section>
}

function ReviewEvents({ channels }: { channels: MonitoringChannel[] }) {
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ events: { id: string; channel_id: string; field: string; received_at: string }[]; total: number }>({ events: [], total: 0 })
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<{ field: string; payload: unknown } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    api<typeof data>(`/api/monitoring/events?page=${page}`, { signal: controller.signal }).then(result => { setData(result); setError('') }).catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [page])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    api<{ event: { field: string; payload: unknown } }>(`/api/monitoring/events/${selected}`, { signal: controller.signal })
      .then(result => { setPayload(result.event); setError('') })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [selected])
  return <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Events for review</h2><p className="text-sm text-muted-foreground">Unsupported and history events are retained. They are not treated as imported conversations.</p>{error && <p role="alert">{error}</p>}<ul className="my-3 space-y-2">{data.events.map(event => <li key={event.id}><button onClick={() => { if (selected !== event.id) { setPayload(null); setSelected(event.id) } }} className="w-full rounded-lg bg-muted p-3 text-left text-sm hover:bg-primary/10">{event.field} · {channels.find(c => c.id === event.channel_id)?.display_number ?? 'Unknown number'} · {date(event.received_at)} · View event</button></li>)}</ul>{payload && <details open className="mb-3 rounded-lg border border-border p-3"><summary className="text-sm font-medium">Retained {payload.field} event</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(payload.payload, null, 2)}</pre></details>}{!error && data.events.length === 0 && <p className="my-3 text-sm text-muted-foreground">No events awaiting review.</p>}<Pagination page={page} size={25} total={data.total} setPage={setPage} label="event" /></section>
}

function Dashboard({ refresh }: { refresh: number }) {
  const [data, setData] = useState<{ conversations: number; inbound: number; outbound: number; numbers: number } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { const controller = new AbortController(); api<typeof data>('/api/monitoring/summary', { signal: controller.signal }).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message) }); return () => controller.abort() }, [refresh])
  return <section><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{data && Object.entries(data).map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-card p-6"><p className="text-sm capitalize text-muted-foreground">{label}</p><p className="mt-3 text-3xl font-semibold">{value.toLocaleString()}</p></div>)}</div>{error && <p role="alert">{error}</p>}<p className="mt-5 text-sm text-muted-foreground">Counts reflect messages received or imported into this CRM. A customer contacting two numbers has two conversations.</p></section>
}
