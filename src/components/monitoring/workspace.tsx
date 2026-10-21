'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChartNoAxesCombined, CircleAlert, History, ImageIcon, Inbox, LayoutDashboard, List, LogOut, MessageSquare, Phone, Settings, Users, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { MonitoringChannel, MonitoringThread } from '@/lib/monitoring/types'
import type { ThreadWorkflow } from '@/lib/monitoring/workflow-types'
import { QuickRepliesPanel } from './quick-replies'
import { RenewMetaAccess } from './renew-access'
import { MonitoringSettings } from './settings-panel'
import { BusinessNumbers } from './business-numbers'
import { ConnectNumber } from './connect-number'
import { Conversation, workflowPatch, type ChatSnapshot } from './conversation'
import { ContactsPanel } from './contacts-panel'
import { ContactPanel } from './contact-panel'
import { MessageBrowser, ReportsPanel } from './activity-panels'
import { HistoryImport, PortfolioPicker } from './setup-panels'
import { ConversationList, emptyFilters, useInbox, type InboxFilters, type InboxTab } from './inbox-list'
import { LabelsSettings, useLabels } from './labels'
import { api, buttonClass, inputClass } from './ui'

type View = 'Dashboard' | 'Inbox' | 'Contacts' | 'Reports' | 'Media' | 'Message logs' | 'Saved replies' | 'Business numbers' | 'Import history' | 'Events for review' | 'Settings'
const primaryNav: { name: View; icon: typeof Inbox }[] = [
  { name: 'Inbox', icon: Inbox }, { name: 'Dashboard', icon: LayoutDashboard }, { name: 'Contacts', icon: Users },
  { name: 'Reports', icon: ChartNoAxesCombined }, { name: 'Media', icon: ImageIcon }, { name: 'Message logs', icon: List },
]
const secondaryNav: { name: View; icon: typeof Inbox }[] = [
  { name: 'Saved replies', icon: Zap }, { name: 'Business numbers', icon: Phone }, { name: 'Import history', icon: History },
  { name: 'Events for review', icon: CircleAlert }, { name: 'Settings', icon: Settings },
]
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'No events yet'

export function MonitoringSignOut({ compact }: { compact?: boolean }) {
  const [error, setError] = useState('')
  const router = useRouter()
  const signOut = async () => {
    const result = await createClient().auth.signOut()
    if (result.error) { setError('Unable to sign out. Please try again.'); return }
    router.replace('/login'); router.refresh()
  }
  return <>{compact
    ? <button onClick={signOut} aria-label="Sign out" title="Sign out" className="flex size-10 items-center justify-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white"><LogOut size={19} /></button>
    : <button className={buttonClass} onClick={signOut}>Sign out</button>}{error && <p role="alert" className="text-xs text-red-400">{error}</p>}</>
}

export function MonitoringWorkspace({ accountName, initialView = 'Inbox' }: { accountName: string; initialView?: 'Inbox' | 'Settings' }) {
  const [view, setView] = useState<View>(initialView)
  const [filters, setFilters] = useState<InboxFilters>(emptyFilters)
  const [selected, setSelected] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [replyEnabled, setReplyEnabled] = useState<boolean | null>(null)
  // Contact panel opens by default on wide screens only (it renders after a chat is selected, so no hydration mismatch).
  const [contactOpen, setContactOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1280px)').matches)
  const [details, setDetails] = useState<Record<string, MonitoringThread>>({})
  const settingsRevision = useRef(0)
  const [chatCache] = useState(() => new Map<string, ChatSnapshot>())
  const inbox = useInbox(filters, refresh)
  const { labels, ready: labelsReady, reload: reloadLabels } = useLabels(refresh)
  const workflowReady = inbox.workflowReady
  const bump = useCallback(() => setRefresh(n => n + 1), [])

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setRefresh(n => n + 1) }, 30000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const revision = settingsRevision.current
    const load = () => api<{ management_replies_enabled: boolean }>('/api/monitoring/settings', { signal: controller.signal })
      .then(data => { if (revision === settingsRevision.current) setReplyEnabled(data.management_replies_enabled) })
      .catch(() => { if (!controller.signal.aborted) setReplyEnabled(null) })
    void load()
    return () => controller.abort()
  }, [refresh])

  const selectedThread = selected ? inbox.threads.find(t => t.id === selected) ?? details[selected] : undefined
  const patch = useCallback((id: string, value: Partial<MonitoringThread>) => {
    inbox.patchThread(id, value)
    setDetails(old => old[id] ? { ...old, [id]: { ...old[id], ...value } } : old)
  }, [inbox])
  // A conversation opened from Contacts/Logs may not be in the current list;
  // load its workflow state separately.
  const onLoaded = useCallback((thread: MonitoringThread) => {
    if (inbox.threads.some(t => t.id === thread.id)) return
    setDetails(old => old[thread.id]?.state !== undefined ? old : { ...old, [thread.id]: { ...old[thread.id], ...thread } })
    if (!workflowReady) return
    api<{ workflows: Record<string, ThreadWorkflow> }>(`/api/monitoring/workflow?ids=${thread.id}`)
      .then(data => { const w = data.workflows[thread.id]; if (w) setDetails(old => ({ ...old, [thread.id]: { ...thread, ...old[thread.id], ...workflowPatch(w) } })) })
      .catch(() => { /* Actions show their own errors. */ })
  }, [inbox.threads, workflowReady])
  const open = useCallback((id: string) => { setSelected(id); setView('Inbox') }, [])

  // Keyboard: j/k next/previous conversation, "/" search, Esc back to list.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (view !== 'Inbox' || event.metaKey || event.ctrlKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable) return
      if (event.key === '/') { event.preventDefault(); document.getElementById('inbox-search')?.focus(); return }
      if (event.key === 'Escape') { setSelected(null); return }
      if (event.key !== 'j' && event.key !== 'k') return
      const index = inbox.threads.findIndex(t => t.id === selected)
      const next = inbox.threads[event.key === 'j' ? index + 1 : Math.max(0, index - 1)]
      if (next) { event.preventDefault(); setSelected(next.id) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [view, inbox.threads, selected])

  const navButton = ({ name, icon: Icon }: { name: View; icon: typeof Inbox }) => <button key={name} onClick={() => setView(name)} aria-label={name} title={name} aria-current={view === name ? 'page' : undefined}
    className={`relative flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors ${view === name ? 'bg-[#C0DD11] text-[#121316]' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}>
    <Icon size={19} />{name === 'Inbox' && (inbox.counts?.waiting ?? 0) > 0 && view !== 'Inbox' && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-[#121316]" />}
  </button>

  return <div className="monitoring-panel flex h-dvh flex-col overflow-hidden bg-background text-foreground md:flex-row">
    <aside aria-label="Workspace" className={`flex shrink-0 items-center gap-1 bg-[#121316] px-2 py-2 md:w-16 md:flex-col md:px-0 md:py-3 ${view === 'Inbox' && selected ? 'hidden md:flex' : 'flex'}`}>
      <div title={accountName} className="mr-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#C0DD11] text-lg font-black text-[#121316] md:mb-3 md:mr-0">N</div>
      <nav className="flex flex-1 items-center gap-1 overflow-x-auto md:flex-col md:overflow-visible">{primaryNav.map(navButton)}<span className="mx-1 h-6 w-px shrink-0 bg-white/10 md:my-2 md:h-px md:w-6" />{secondaryNav.map(navButton)}</nav>
      <MonitoringSignOut compact />
    </aside>

    {view === 'Inbox' ? <main className={`grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] ${contactOpen && selectedThread ? 'lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)_320px]' : 'lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]'}`}>
      <ConversationList inbox={inbox} filters={filters} setFilters={f => { setFilters(f) }} labels={labels} selected={selected} onSelect={setSelected} hidden={!!selected} />
      <section aria-label="Conversation" className={`min-h-0 min-w-0 ${selected ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'}`}>
        {selected ? <Conversation key={selected} id={selected} thread={selectedThread} channels={inbox.channels} repliesEnabled={replyEnabled === true} workflowReady={workflowReady}
          cache={chatCache} contactOpen={contactOpen} onToggleContact={() => setContactOpen(v => !v)} onBack={() => setSelected(null)}
          onPatched={value => patch(selected, value)} onLoaded={onLoaded} onChanged={bump} />
          : <div className="chat-wallpaper flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-muted-foreground"><span className="flex size-16 items-center justify-center rounded-2xl bg-card shadow-sm"><MessageSquare size={30} className="text-primary" /></span><p className="font-medium text-foreground">Select a conversation</p><p className="max-w-xs text-sm">Use <kbd className="rounded border border-border bg-card px-1">j</kbd> / <kbd className="rounded border border-border bg-card px-1">k</kbd> to move between conversations and <kbd className="rounded border border-border bg-card px-1">/</kbd> to search.</p></div>}
      </section>
      {contactOpen && selectedThread && <div className="fixed inset-0 z-40 bg-black/30 xl:static xl:z-auto xl:bg-transparent" onClick={e => { if (e.target === e.currentTarget) setContactOpen(false) }}>
        <div className="ml-auto h-full w-[min(340px,92vw)] xl:w-auto"><ContactPanel key={selectedThread.id} thread={selectedThread} channels={inbox.channels} labels={labels} workflowReady={workflowReady}
          onPatched={value => patch(selectedThread.id, value)} onOpenThread={setSelected} onClose={() => setContactOpen(false)} /></div>
      </div>}
    </main>
      : <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-8">
          <header className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">{accountName}</p><h1 className="text-2xl font-semibold">{view}</h1></div><button className={buttonClass} onClick={bump}>Refresh</button></header>
          {view === 'Dashboard' && <Dashboard refresh={refresh} channels={inbox.channels} onTab={tab => { setFilters({ ...emptyFilters, tab, sort: tab === 'waiting' ? 'oldest' : 'latest' }); setView('Inbox') }} onChannel={id => { setFilters({ ...emptyFilters, tab: 'all', channel: id }); setView('Inbox') }} />}
          {view === 'Contacts' && <ContactsPanel channels={inbox.channels} onOpen={open} />}
          {(view === 'Media' || view === 'Message logs') && <MessageBrowser key={view} channels={inbox.channels} media={view === 'Media'} refresh={refresh} onOpen={open} />}
          {view === 'Reports' && <ReportsPanel channels={inbox.channels} refresh={refresh} />}
          {view === 'Saved replies' && <QuickRepliesPanel />}
          {view === 'Business numbers' && <><ConnectNumber onConnected={bump} /><BusinessNumbers channels={inbox.channels} refresh={refresh} onSaved={bump} onOpen={id => { setFilters({ ...emptyFilters, tab: 'all', channel: id }); setView('Inbox') }} />
            <details className="rounded-xl border border-border bg-card p-3"><summary className="cursor-pointer p-2 font-medium">Add a number from Meta portfolio (without history sharing)</summary><PortfolioPicker onSaved={bump} /></details>
            <details className="rounded-xl border border-border bg-card p-3"><summary className="cursor-pointer p-2 font-medium">Enter number details manually</summary><ChannelManager channels={inbox.channels} onSaved={bump} /></details></>}
          {view === 'Import history' && <HistoryImport channels={inbox.channels} onSaved={bump} />}
          {view === 'Events for review' && <ReviewEvents channels={inbox.channels} />}
          {view === 'Settings' && <>
            <LabelsSettings labels={labels} ready={labelsReady} onChanged={() => { reloadLabels(); bump() }} />
            <MonitoringSettings enabled={replyEnabled} onSaved={enabled => { settingsRevision.current++; setReplyEnabled(enabled); bump() }} />
            <RenewMetaAccess channels={inbox.channels} />
          </>}
        </div>
      </main>}
  </div>
}

function Pagination({ page, size, total, setPage, label = 'conversation' }: { page: number; size: number; total: number; setPage: (page: number) => void; label?: string }) {
  return <nav aria-label={`${label} pages`} className="flex items-center justify-between gap-2 border-t border-border p-3"><button className={buttonClass} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span className="text-xs text-muted-foreground">Page {page + 1} of {Math.max(1, Math.ceil(total / size))}</span><button className={buttonClass} disabled={(page + 1) * size >= total} onClick={() => setPage(page + 1)}>Next</button></nav>
}

function ChannelManager({ channels, onSaved }: { channels: MonitoringChannel[]; onSaved: () => void }) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  return <section className="p-2"><p className="text-sm text-muted-foreground">Add a number using credentials for your Numera Meta app. Saving verifies its details and stores its encrypted credential. It does not register the number or change WabaCRM subscriptions. Use the agent’s name as the label.</p>
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setSaving(true); setError(''); setSuccess(false)
      try { await api('/api/monitoring/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(data)) }); form.reset(); setSuccess(true); onSaved() }
      catch (err) { setError((err as Error).message) }
      finally { setSaving(false) }
    }}>
      <label className="text-sm">Agent label<input className={inputClass} name="label" maxLength={120} required autoComplete="off" /></label><label className="text-sm">Phone number ID<input className={inputClass} name="phone_number_id" pattern="[0-9]+" maxLength={40} required /></label><label className="text-sm">WhatsApp Business Account ID<input className={inputClass} name="waba_id" pattern="[0-9]+" maxLength={40} required /></label><label className="text-sm">Numera app access token<input className={inputClass} name="access_token" type="password" autoComplete="new-password" maxLength={8192} required /></label><div><button className={buttonClass} disabled={saving}>{saving ? 'Verifying…' : 'Verify and add number'}</button></div>
    </form>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{success && <p role="status" className="mt-3 text-sm">Number saved. Webhook delivery still needs to be verified.</p>}
    <p className="mt-3 text-xs text-muted-foreground">{channels.length} configured numbers.</p>
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
  return <section className="rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Unsupported and history events are retained. They are not treated as imported conversations.</p>{error && <p role="alert">{error}</p>}<ul className="my-3 space-y-2">{data.events.map(event => <li key={event.id}><button onClick={() => { if (selected !== event.id) { setPayload(null); setSelected(event.id) } }} className="w-full rounded-lg bg-muted p-3 text-left text-sm hover:bg-primary/10">{event.field} · {channels.find(c => c.id === event.channel_id)?.display_number ?? 'Unknown number'} · {date(event.received_at)} · View event</button></li>)}</ul>{payload && <details open className="mb-3 rounded-lg border border-border p-3"><summary className="text-sm font-medium">Retained {payload.field} event</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(payload.payload, null, 2)}</pre></details>}{!error && data.events.length === 0 && <p className="my-3 text-sm text-muted-foreground">No events awaiting review.</p>}<Pagination page={page} size={25} total={data.total} setPage={setPage} label="event" /></section>
}

function Stat({ label, value, hint, tone = 'default', onClick }: { label: string; value: number | null | undefined; hint?: string; tone?: 'default' | 'alert' | 'good'; onClick?: () => void }) {
  const body: ReactNode = <><p className="text-sm text-muted-foreground">{label}</p><p className={`mt-2 text-3xl font-semibold ${tone === 'alert' && value ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : ''}`}>{value === null || value === undefined ? '—' : value.toLocaleString()}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</>
  return onClick ? <button onClick={onClick} className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary/50 hover:shadow-sm">{body}</button> : <div className="rounded-xl border border-border bg-card p-5">{body}</div>
}

function Dashboard({ refresh, channels, onTab, onChannel }: { refresh: number; channels: MonitoringChannel[]; onTab: (tab: InboxTab) => void; onChannel: (id: string) => void }) {
  const [summary, setSummary] = useState<{ conversations: number; inbound: number; outbound: number; numbers: number } | null>(null)
  const [counts, setCounts] = useState<Record<InboxTab, number> | null>(null)
  const [perAgent, setPerAgent] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api<typeof summary>('/api/monitoring/summary', { signal: controller.signal }).then(setSummary).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    api<{ counts: Record<InboxTab, number> | null }>('/api/monitoring/counts', { signal: controller.signal }).then(d => setCounts(d.counts)).catch(() => {})
    return () => controller.abort()
  }, [refresh])
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(channels.filter(c => c.active).map(c => api<{ counts: Record<InboxTab, number> | null }>(`/api/monitoring/counts?channel=${c.id}`, { signal: controller.signal }).then(d => [c.id, d.counts?.waiting ?? 0] as const)))
      .then(rows => setPerAgent(Object.fromEntries(rows))).catch(() => {})
    return () => controller.abort()
  }, [channels, refresh])
  return <div className="space-y-6">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Waiting for agent reply" value={counts?.waiting} hint="Customer messaged last" tone="alert" onClick={() => onTab('waiting')} />
        <Stat label="Unread in CRM" value={counts?.unread} hint="Not yet reviewed by management" onClick={() => onTab('unread')} />
        <Stat label="Open conversations" value={counts?.open} onClick={() => onTab('open')} />
        <Stat label="Resolved" value={counts?.resolved} tone="good" onClick={() => onTab('resolved')} />
      </div>
      {counts === null && <p className="mt-2 text-xs text-muted-foreground">Status counts appear after the inbox database update.</p>}
    </section>
    <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Agents</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{channels.map(channel => <button key={channel.id} onClick={() => onChannel(channel.id)} className="rounded-xl border border-border bg-card p-4 text-left hover:border-primary/50 hover:shadow-sm">
        <div className="flex items-center justify-between gap-2"><p className="truncate font-semibold">{channel.label}</p><span className={`rounded-full px-2 py-0.5 text-[11px] ${channel.active ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>{channel.active ? 'Monitoring' : 'Paused'}</span></div>
        <p className="mt-1 text-sm text-muted-foreground">{channel.display_number}</p>
        <div className="mt-3 flex items-center justify-between text-xs"><span className="text-muted-foreground">Last event {channel.last_event_at ? new Date(channel.last_event_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</span>{perAgent[channel.id] ? <span className="rounded-md bg-red-50 px-1.5 py-0.5 font-medium text-red-700">{perAgent[channel.id]} waiting</span> : null}</div>
      </button>)}</div>
    </section>
    <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">All time</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Conversations" value={summary?.conversations} /><Stat label="Messages received" value={summary?.inbound} /><Stat label="Messages sent by agents" value={summary?.outbound} /><Stat label="Business numbers" value={summary?.numbers} /></div>
      <p className="mt-3 text-xs text-muted-foreground">Counts reflect messages received or imported into this CRM. A customer contacting two numbers has two conversations.</p>
    </section>
  </div>
}
