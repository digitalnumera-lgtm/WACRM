'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LayoutDashboard, Inbox, Users, ImageIcon, List, ChartNoAxesCombined, Phone, History, CircleAlert, Settings, ArrowLeft, MessageSquare, Zap } from 'lucide-react'
import { QuickRepliesPanel } from './quick-replies'
import { useThreadWorkflows } from './use-thread-workflows'
import { RenewMetaAccess } from './renew-access'
import { MonitoringSettings } from './settings-panel'
import { BusinessNumbers } from './business-numbers'
import { Conversation, type ChatSnapshot } from './conversation'
import { ContactsPanel } from './contacts-panel'
import { MessageBrowser, ReportsPanel } from './activity-panels'
import { HistoryImport, PortfolioPicker } from './setup-panels'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { leadStatuses, type MonitoringChannel, type MonitoringThread } from '@/lib/monitoring/types'

const navigation = [
  { name: 'Dashboard', icon: LayoutDashboard }, { name: 'Inbox', icon: Inbox },
  { name: 'Saved replies', icon: Zap },
  { name: 'Contacts', icon: Users }, { name: 'Media', icon: ImageIcon },
  { name: 'Message logs', icon: List }, { name: 'Reports', icon: ChartNoAxesCombined },
  { name: 'Business numbers', icon: Phone }, { name: 'Import history', icon: History },
  { name: 'Events for review', icon: CircleAlert }, { name: 'Settings', icon: Settings },
]

const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm'
const buttonClass = 'rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'No events yet'
const agentColors = ['bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300', 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300']
const agentTint = (id: string) => agentColors[Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % agentColors.length]

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

export function MonitoringWorkspace({ accountName, initialView = 'Inbox' }: { accountName: string; initialView?: 'Inbox' | 'Settings' }) {
  const [channels, setChannels] = useState<MonitoringChannel[]>([])
  const [threads, setThreads] = useState<MonitoringThread[]>([])
  const [filters, setFilters] = useState({ q: '', channel: '', agent: '', status: '' })
  const [search, setSearch] = useState('')
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<string>(initialView)
  const [replyEnabled, setReplyEnabled] = useState<boolean | null>(null)
  const [settingsError, setSettingsError] = useState('')
  const settingsRevision = useRef(0)
  const workflowIds = [...new Set([...threads.map(t => t.id), ...(selected ? [selected] : [])])].join(',')
  const { workflows, error: workflowError, setWorkflows } = useThreadWorkflows(workflowIds, refresh)
  useEffect(() => {
    const controller = new AbortController()
    const revision = settingsRevision.current
    const load = () => api<{ management_replies_enabled: boolean }>('/api/monitoring/settings', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted && revision === settingsRevision.current) { setReplyEnabled(data.management_replies_enabled); setSettingsError('') } })
      .catch(e => { if (!controller.signal.aborted && revision === settingsRevision.current) { setReplyEnabled(null); setSettingsError(e.message) } })
    void load()
    window.addEventListener('focus', load)
    return () => { controller.abort(); window.removeEventListener('focus', load) }
  }, [refresh])

  const chatCache = useRef(new Map<string, ChatSnapshot>())
  const listViewport = useRef<HTMLUListElement>(null)
  const listSentinel = useRef<HTMLLIElement>(null)
  const listAbort = useRef<AbortController | null>(null)
  const listBusy = useRef(false)
  const listCursor = useRef<string | null>(null)
  const previousFilter = useRef('')
  const firstLoaded = useRef(false)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadRetry, setLoadRetry] = useState(0)
  type InboxPage = { channels: MonitoringChannel[]; threads: MonitoringThread[]; total: number | null; nextCursor: string | null }
  const combine = (old: MonitoringThread[], incoming: MonitoringThread[]) => {
    const rows = new Map(old.map(thread => [thread.id, thread]))
    incoming.forEach(thread => rows.set(thread.id, thread))
    return [...rows.values()].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at) || b.id.localeCompare(a.id))
  }
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setRefresh(n => n + 1) }, 30000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    listAbort.current = controller; listBusy.current = true; setLoadingMore(false)
    const key = JSON.stringify(filters)
    const changed = previousFilter.current !== key
    previousFilter.current = key
    if (changed) { firstLoaded.current = false; setThreads([]); listCursor.current = null; setMore(false); if (listViewport.current) listViewport.current.scrollTop = 0 }
    setLoading(true)
    const params = new URLSearchParams({ ...filters, scroll: '1' })
    api<InboxPage>(`/api/monitoring?${params}`, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return
        setChannels(data.channels); setThreads(old => changed ? data.threads : combine(old, data.threads))
        if (data.total !== null) setTotal(data.total)
        if (!firstLoaded.current) { listCursor.current = data.nextCursor; setMore(!!data.nextCursor); firstLoaded.current = true }
        setError('')
        if (changed && window.matchMedia('(min-width: 1024px)').matches) setSelected(data.threads[0]?.id ?? null)
      })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) { listBusy.current = false; setLoading(false) } })
    return () => controller.abort()
  }, [filters, refresh, loadRetry])
  const loadMore = useCallback(async () => {
    if (listBusy.current || !listCursor.current || !listAbort.current) return
    const controller = listAbort.current
    listBusy.current = true; setLoadingMore(true)
    try {
      const params = new URLSearchParams({ ...filters, scroll: '1', before: listCursor.current })
      const data = await api<InboxPage>(`/api/monitoring?${params}`, { signal: controller.signal })
      if (controller.signal.aborted) return
      setThreads(old => combine(old, data.threads)); setChannels(data.channels)
      listCursor.current = data.nextCursor; setMore(!!data.nextCursor); setError('')
    } catch (err) { if (!controller.signal.aborted) setError((err as Error).message) }
    finally { if (!controller.signal.aborted) { listBusy.current = false; setLoadingMore(false) } }
  }, [filters])
  useEffect(() => {
    if (!listViewport.current || !listSentinel.current || !more || loading || loadingMore || error) return
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) void loadMore() }, { root: listViewport.current, rootMargin: '0px 0px 160px' })
    observer.observe(listSentinel.current)
    return () => observer.disconnect()
  }, [loadMore, more, loading, loadingMore, error, view, threads.length])
  function filter(key: keyof typeof filters, value: string) {
    setFilters(current => {
      const next = { ...current, [key]: value }
      if (key === 'channel') next.agent = channels.find(c => c.id === value)?.label ?? ''
      if (key === 'agent') { const matches = channels.filter(c => c.label === value); next.channel = matches.length === 1 ? matches[0].id : '' }
      return next
    })
    setSelected(null)
  }
  function select(id: string) { setSelected(id) }

  return <div className="monitoring-panel min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[220px_1fr]">
    <aside className={`border-r border-border bg-card p-4 lg:sticky lg:top-0 lg:h-screen ${view === 'Inbox' && selected ? 'hidden lg:block' : ''}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Numera Digital</p><h1 className="mt-2 truncate text-lg font-semibold" title={accountName}>{accountName}</h1>
      <p className="mb-6 mt-2 text-xs text-muted-foreground">Management workspace</p>
      <nav aria-label="Workspace" className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">{navigation.map(({ name, icon: Icon }) => <button key={name} onClick={() => setView(name)} aria-current={view === name ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${view === name ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon size={18} aria-hidden="true" />{name}</button>)}</nav><div className="mt-4 lg:mt-8"><MonitoringSignOut /></div>
    </aside>
    <main className="min-w-0 space-y-4 p-4 lg:p-6">
      <header className={`items-center justify-between border-b border-border pb-4 ${view === 'Inbox' && selected ? 'hidden lg:flex' : 'flex'}`}><h2 className="text-xl font-semibold">{view}</h2><button className={buttonClass} onClick={() => setRefresh(n => n + 1)} disabled={loading}>Refresh</button></header>
      {settingsError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Unable to check reply settings: {settingsError} <button className={buttonClass} onClick={() => setRefresh(n => n + 1)}>Retry</button></p>}
      {view === 'Settings' && <MonitoringSettings enabled={replyEnabled} onSaved={enabled => { settingsRevision.current++; setReplyEnabled(enabled); setSettingsError(''); setRefresh(n => n + 1) }} />}
      {view === 'Settings' && <RenewMetaAccess channels={channels} />}
      {view === 'Saved replies' && <QuickRepliesPanel />}
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
        <div className="mb-3 flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Conversations across your business numbers</p>{Object.values(filters).some(Boolean) && <button className="text-xs font-medium text-primary" onClick={() => { setFilters({ q: '', channel: '', agent: '', status: '' }); setSearch(''); setSelected(null) }}>Clear filters</button>}</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); filter('q', search.trim()) }}><label className="sr-only" htmlFor="monitor-search">Search conversations</label><input id="monitor-search" className={inputClass} placeholder="Search customer or latest message" maxLength={120} value={search} onChange={e => setSearch(e.target.value)} /><button className={buttonClass}>Search</button></form>
          <label className="text-xs text-muted-foreground">Business number<select aria-label="Business number" className={inputClass} value={filters.channel} onChange={e => filter('channel', e.target.value)}><option value="">All numbers</option><optgroup label="Active numbers">{channels.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.label} · {c.display_number}</option>)}</optgroup>{channels.some(c => !c.active) && <optgroup label="Removed · saved chats">{channels.filter(c => !c.active).map(c => <option key={c.id} value={c.id}>{c.label} · {c.display_number}</option>)}</optgroup>}</select></label>
          <label className="text-xs text-muted-foreground">Agent<select aria-label="Assigned agent label" className={inputClass} value={filters.agent} onChange={e => filter('agent', e.target.value)}><option value="">All agents</option>{[...new Set(channels.map(c => c.label))].map(label => <option key={label}>{label}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Lead status<select aria-label="Lead status filter" className={inputClass} value={filters.status} onChange={e => filter('status', e.target.value)}><option value="">All statuses</option>{leadStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
        </div>
      </section>
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">{error} <button className={buttonClass} onClick={() => setLoadRetry(n => n + 1)}>Retry</button></p>}
      {workflowError && <p role="alert" className="rounded-lg border border-amber-200 p-3 text-sm">Conversation status could not refresh. Messages remain available. <button className={buttonClass} onClick={() => setRefresh(n => n + 1)}>Retry status</button></p>}
      <div className="grid items-start gap-0 overflow-hidden rounded-xl border border-border lg:grid-cols-[320px_minmax(0,1fr)]">
        <section aria-label="Conversations" aria-busy={loading} className={`overflow-hidden border-r border-border bg-card ${selected ? 'hidden lg:block' : ''}`}>
          <div className="border-b border-border px-4 py-3 text-sm font-medium">{total} conversations {loading && <span className="text-muted-foreground">· Updating…</span>}</div>
          {!loading && !error && threads.length === 0 && <p className="p-6 text-sm text-muted-foreground">{channels.length ? 'No conversations match these filters.' : 'Add a business number to start monitoring. New conversations appear when verified events arrive.'}</p>}
          <ul ref={listViewport} aria-label="Conversation list" className="max-h-[70vh] divide-y divide-border overflow-y-auto overscroll-contain">{threads.map(thread => {
            const channel = channels.find(c => c.id === thread.channel_id)
            const workflow = workflows[thread.id]
            return <li key={thread.id}><button onClick={() => select(thread.id)} aria-pressed={selected === thread.id} className={`w-full p-4 text-left hover:bg-muted ${selected === thread.id ? 'border-l-4 border-l-primary bg-sky-50 dark:bg-sky-950/40' : 'border-l-4 border-l-transparent'}`}>
              <div className="flex items-center gap-3"><span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${agentTint(thread.channel_id)}`}>{(thread.customer_name || thread.customer).slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1 truncate font-semibold">{thread.customer_name || thread.customer}</span><span className="rounded bg-muted px-2 py-1 text-xs">{thread.lead_status}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">{channel?.display_number ?? 'Unknown number'} · {channel?.label ?? 'Unassigned'}</p>
              {workflow && <div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] ${workflow.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : workflow.status === 'snoozed' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>{workflow.status}</span>{(workflow.unread_count > 0 || workflow.marked_unread) && <span title="Messages not marked read in this CRM, including phone-app replies" className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">{workflow.unread_count || '•'} unread</span>}</div>}
              <p className="mt-3 truncate text-sm">{thread.last_preview || 'Media or non-text message'}</p><p className="mt-2 text-xs text-muted-foreground">{date(thread.last_message_at)} · {thread.message_count} {thread.message_count === 1 ? 'message' : 'messages'}</p>
            </button></li>
          })}<li ref={listSentinel} className="p-3 text-center text-xs text-muted-foreground">{loadingMore ? 'Loading more conversations…' : loading ? 'Loading conversations…' : !more && threads.length > 0 ? 'All saved conversations loaded' : ''}</li></ul>
        </section>
        <section aria-label="Conversation detail" className={`min-w-0 bg-card ${selected ? '' : 'hidden lg:block'}`}>
          <button onClick={() => setSelected(null)} className="m-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm lg:hidden"><ArrowLeft size={16} />All conversations</button>
          {selected ? <Conversation key={selected} id={selected} preview={threads.find(t => t.id === selected)} channels={channels} repliesEnabled={replyEnabled === true} cache={chatCache.current} workflow={workflows[selected]} onWorkflowChanged={value => { setWorkflows(old => ({ ...old, [selected]: value })); setRefresh(n => n + 1) }} onChanged={() => setRefresh(n => n + 1)} />
            : <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4 p-10 text-center text-muted-foreground"><MessageSquare size={40} className="text-primary/40" /><p>{loading ? 'Loading conversations…' : threads.length ? 'Choose a conversation' : 'No conversations match your filters'}</p></div>}
        </section>
      </div>
      </>}
      <p className="text-xs text-muted-foreground">Agents use their WhatsApp Business apps. Owners and admins can review conversations and update leads.{replyEnabled === true ? ' Management replies are enabled.' : replyEnabled === false ? ' Management replies are disabled.' : ''}</p>
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
