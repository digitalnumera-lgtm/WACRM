'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownUp, CheckCheck, Clock, Image as ImageIcon, Search, SlidersHorizontal, X } from 'lucide-react'
import { leadStatuses, type MonitoringChannel, type MonitoringThread } from '@/lib/monitoring/types'
import type { MonitoringLabel } from '@/lib/monitoring/workflow-types'
import { api, Avatar, buttonClass, inputClass, LabelChip, PriorityIcon, priorityMeta, timeAgo, waitingFor } from './ui'

export type InboxTab = 'open' | 'waiting' | 'unread' | 'snoozed' | 'resolved' | 'all'
export type InboxFilters = { tab: InboxTab; q: string; channel: string; agent: string; status: string; label: string; priority: string; sort: 'latest' | 'oldest' }
export const emptyFilters: InboxFilters = { tab: 'open', q: '', channel: '', agent: '', status: '', label: '', priority: '', sort: 'latest' }
const tabs: { id: InboxTab; name: string; hint: string }[] = [
  { id: 'open', name: 'Open', hint: 'Conversations not resolved or snoozed' },
  { id: 'waiting', name: 'Waiting', hint: 'Customer messaged last and the agent has not replied yet' },
  { id: 'unread', name: 'Unread', hint: 'New activity management has not reviewed' },
  { id: 'snoozed', name: 'Snoozed', hint: 'Hidden until the snooze ends or a new message arrives' },
  { id: 'resolved', name: 'Resolved', hint: 'Closed; any new message reopens it' },
  { id: 'all', name: 'All', hint: 'Every conversation' },
]

type InboxPage = { channels: MonitoringChannel[]; threads: MonitoringThread[]; total: number | null; nextCursor: string | null; workflowReady: boolean }
const params = (filters: InboxFilters, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams({ scroll: '1', ...extra })
  for (const [key, value] of Object.entries(filters)) if (value) p.set(key, value)
  return p
}

export function useInbox(filters: InboxFilters, refresh: number) {
  const [channels, setChannels] = useState<MonitoringChannel[]>([])
  const [threads, setThreads] = useState<MonitoringThread[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<InboxTab, number> | null>(null)
  const [workflowReady, setWorkflowReady] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const cursor = useRef<string | null>(null)
  const busy = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const previous = useRef('')
  const loaded = useRef(false)
  const [retry, setRetry] = useState(0)
  const ascending = filters.sort === 'oldest'
  const combine = useCallback((old: MonitoringThread[], incoming: MonitoringThread[]) => {
    const rows = new Map(old.map(t => [t.id, t]))
    incoming.forEach(t => rows.set(t.id, t))
    const sorted = [...rows.values()].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at) || b.id.localeCompare(a.id))
    return ascending ? sorted.reverse() : sorted
  }, [ascending])

  useEffect(() => {
    const controller = new AbortController()
    abort.current = controller; busy.current = true
    const key = JSON.stringify(filters)
    const changed = previous.current !== key
    previous.current = key
    if (changed) { loaded.current = false; setThreads([]); cursor.current = null; setMore(false) }
    setLoading(true)
    api<InboxPage>(`/api/monitoring?${params(filters)}`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return
      setChannels(data.channels); setWorkflowReady(data.workflowReady)
      // Refreshes merge the newest page; a changed tab/filter replaces the list.
      setThreads(old => changed ? data.threads : combine(old.filter(t => matchesTabLocally(t, filters.tab)), data.threads))
      if (data.total !== null) setTotal(data.total)
      if (!loaded.current) { cursor.current = data.nextCursor; setMore(!!data.nextCursor); loaded.current = true }
      setError('')
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) { busy.current = false; setLoading(false) } })
    const { tab: _tab, sort: _sort, ...rest } = filters
    void _tab; void _sort
    api<{ counts: Record<InboxTab, number> | null }>(`/api/monitoring/counts?${params({ ...emptyFilters, ...rest, tab: 'all' })}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setCounts(data.counts) }).catch(() => { /* Badges are optional. */ })
    return () => controller.abort()
  }, [filters, refresh, retry, combine])

  const loadMore = useCallback(async () => {
    if (busy.current || !cursor.current || !abort.current) return
    const controller = abort.current
    busy.current = true; setLoadingMore(true)
    try {
      const data = await api<InboxPage>(`/api/monitoring?${params(filters, { before: cursor.current })}`, { signal: controller.signal })
      if (controller.signal.aborted) return
      setThreads(old => combine(old, data.threads))
      cursor.current = data.nextCursor; setMore(!!data.nextCursor); setError('')
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message) }
    finally { if (!controller.signal.aborted) { busy.current = false; setLoadingMore(false) } }
  }, [filters, combine])

  const patchThread = useCallback((id: string, patch: Partial<MonitoringThread>) => setThreads(old => old.map(t => t.id === id ? { ...t, ...patch } : t)), [])
  return { channels, threads, total, counts, workflowReady, loading, loadingMore, error, more, loadMore, patchThread, retry: () => setRetry(n => n + 1) }
}

// Messages without text are stored with a "[kind]" preview; show friendly labels.
const kindLabels: Record<string, string> = { image: '📷 Photo', audio: '🎤 Voice message', video: '🎥 Video', document: '📄 Document', sticker: 'Sticker', media_placeholder: '📎 Media from chat history', location: '📍 Location', contacts: '👤 Contact', reaction: 'Reaction', revoke: 'Message deleted', unsupported: 'Unsupported message' }
export function previewText(preview: string | null) {
  const match = preview ? /^\[([a-z_]+)\]$/.exec(preview) : null
  return match ? kindLabels[match[1]] ?? 'Message' : preview
}

function matchesTabLocally(thread: MonitoringThread, tab: InboxTab) {
  if (tab === 'all' || !thread.state) return true
  if (tab === 'waiting') return thread.last_direction === 'inbound' && thread.state !== 'resolved'
  if (tab === 'unread') return !!thread.is_unread && thread.state !== 'resolved'
  return thread.state === tab
}

export function ConversationList({ inbox, filters, setFilters, labels, selected, onSelect, hidden }: {
  inbox: ReturnType<typeof useInbox>; filters: InboxFilters; setFilters: (f: InboxFilters) => void; labels: MonitoringLabel[];
  selected: string | null; onSelect: (id: string) => void; hidden?: boolean
}) {
  const { channels, threads, total, counts, workflowReady, loading, loadingMore, error, more, loadMore } = inbox
  const [search, setSearch] = useState(filters.q)
  const [showFilters, setShowFilters] = useState(false)
  // Re-render relative times ("5m", "Waiting 2h") every minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  const viewport = useRef<HTMLUListElement>(null)
  const sentinel = useRef<HTMLLIElement>(null)
  const set = (patch: Partial<InboxFilters>) => {
    const next = { ...filters, ...patch }
    // Number and agent filters are alternatives; choosing one clears the other.
    if (patch.channel) next.agent = ''
    if (patch.agent) next.channel = ''
    setFilters(next)
    if (viewport.current) viewport.current.scrollTop = 0
  }
  useEffect(() => {
    if (!viewport.current || !sentinel.current || !more || loading || loadingMore || error) return
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) void loadMore() }, { root: viewport.current, rootMargin: '0px 0px 200px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [loadMore, more, loading, loadingMore, error, threads.length])
  const activeFilters = [filters.channel, filters.agent, filters.status, filters.label, filters.priority].filter(Boolean).length
  const visibleTabs = workflowReady === false ? tabs.filter(t => t.id === 'all') : tabs
  const labelMap = new Map(labels.map(l => [l.id, l]))

  return <section aria-label="Conversations" className={`flex h-full min-h-0 flex-col border-r border-border bg-card ${hidden ? 'hidden lg:flex' : 'flex'}`}>
    <div className="space-y-3 border-b border-border px-4 pb-0 pt-4">
      <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">Conversations</h2>
        <div className="flex items-center gap-1">
          <button type="button" className={`${buttonClass} relative px-2`} aria-label="Filters" aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)}><SlidersHorizontal size={16} />{activeFilters > 0 && <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-white">{activeFilters}</span>}</button>
          <button type="button" className={`${buttonClass} px-2`} aria-label={filters.sort === 'latest' ? 'Newest first. Switch to oldest first' : 'Oldest first. Switch to newest first'} title={filters.sort === 'latest' ? 'Newest first' : 'Oldest first'} onClick={() => set({ sort: filters.sort === 'latest' ? 'oldest' : 'latest' })}><ArrowDownUp size={16} /><span className="text-xs">{filters.sort === 'latest' ? 'Newest' : 'Oldest'}</span></button>
        </div>
      </div>
      <form role="search" onSubmit={e => { e.preventDefault(); set({ q: search.trim() }) }} className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input id="inbox-search" aria-label="Search conversations" className={`${inputClass} pl-9 pr-8`} placeholder="Search name, number or message  ( / )" maxLength={120} value={search} onChange={e => setSearch(e.target.value)} />
        {filters.q && <button type="button" aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => { setSearch(''); set({ q: '' }) }}><X size={16} /></button>}
      </form>
      {showFilters && <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-3">
        <label className="text-[11px] font-medium text-muted-foreground">Business number<select className={inputClass} value={filters.channel} onChange={e => set({ channel: e.target.value })}><option value="">All numbers</option>{channels.map(c => <option key={c.id} value={c.id}>{c.label} · {c.display_number}{c.active ? '' : ' (removed)'}</option>)}</select></label>
        <label className="text-[11px] font-medium text-muted-foreground">Agent<select className={inputClass} value={filters.agent} onChange={e => set({ agent: e.target.value })}><option value="">All agents</option>{[...new Set(channels.map(c => c.label))].map(l => <option key={l}>{l}</option>)}</select></label>
        <label className="text-[11px] font-medium text-muted-foreground">Lead stage<select className={inputClass} value={filters.status} onChange={e => set({ status: e.target.value })}><option value="">All stages</option>{leadStatuses.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
        <label className="text-[11px] font-medium text-muted-foreground">Priority<select className={inputClass} value={filters.priority} disabled={!workflowReady} onChange={e => set({ priority: e.target.value })}><option value="">Any priority</option>{(['urgent', 'high', 'medium', 'low', 'none'] as const).map(p => <option key={p} value={p}>{priorityMeta[p].label}</option>)}</select></label>
        <label className="col-span-2 text-[11px] font-medium text-muted-foreground">Label<select className={inputClass} value={filters.label} disabled={!workflowReady} onChange={e => set({ label: e.target.value })}><option value="">Any label</option>{labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        {activeFilters > 0 && <button type="button" className="col-span-2 text-left text-xs font-medium text-primary" onClick={() => setFilters({ ...emptyFilters, tab: filters.tab, q: filters.q, sort: filters.sort })}>Clear filters</button>}
      </div>}
      <nav aria-label="Conversation status" className="-mx-4 flex gap-1 overflow-x-auto px-4">{visibleTabs.map(tab => {
        const active = (workflowReady === false ? 'all' : filters.tab) === tab.id
        return <button key={tab.id} type="button" title={tab.hint} aria-current={active ? 'page' : undefined} onClick={() => set({ tab: tab.id, sort: tab.id === 'waiting' && filters.tab !== 'waiting' ? 'oldest' : tab.id !== 'waiting' && filters.tab === 'waiting' ? 'latest' : filters.sort })}
          className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2 pb-2.5 pt-1 text-sm font-medium ${active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          {tab.name}{counts && <span className={`rounded-full px-1.5 text-[11px] ${active ? 'bg-primary/10' : 'bg-muted'} ${tab.id === 'waiting' && counts.waiting > 0 ? 'text-red-700' : ''}`}>{counts[tab.id] > 999 ? '999+' : counts[tab.id]}</span>}
        </button>
      })}</nav>
    </div>
    {workflowReady === false && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">Open / Waiting / Unread tabs, labels and priority switch on after the inbox database update (<code>supabase/numera/001_inbox_workflow.sql</code>).</p>}
    {error && <p role="alert" className="flex items-center justify-between gap-2 bg-red-50 px-4 py-2 text-sm text-red-700">{error}<button className={buttonClass} onClick={inbox.retry}>Retry</button></p>}
    <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground"><span>{total.toLocaleString()} conversation{total === 1 ? '' : 's'}</span>{loading && <span>Updating…</span>}</div>
    <ul ref={viewport} aria-label="Conversation list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {threads.map(thread => {
        const channel = channels.find(c => c.id === thread.channel_id)
        const name = thread.customer_name || `+${thread.customer}`
        const unread = (thread.unread_count ?? 0) > 0 || thread.marked_unread
        const waiting = thread.last_direction === 'inbound' && thread.state !== 'resolved'
        const waitMinutes = (now - Date.parse(thread.last_message_at)) / 60000
        const threadLabels = (thread.label_ids ?? []).map(id => labelMap.get(id)).filter((l): l is MonitoringLabel => !!l)
        return <li key={thread.id}>
          <button type="button" onClick={() => onSelect(thread.id)} aria-current={selected === thread.id ? 'true' : undefined}
            className={`flex w-full gap-3 border-b border-border/70 px-4 py-3 text-left transition-colors ${selected === thread.id ? 'bg-primary/[0.07] shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-muted/60'}`}>
            <Avatar name={name} seed={thread.customer} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`min-w-0 flex-1 truncate text-sm ${unread ? 'font-bold' : 'font-semibold'}`}>{name}</span>
                <PriorityIcon priority={thread.priority} />
                <time className={`shrink-0 text-[11px] ${unread ? 'font-semibold text-primary' : 'text-muted-foreground'}`} dateTime={thread.last_message_at} title={new Date(thread.last_message_at).toLocaleString()}>{timeAgo(thread.last_message_at, now)}</time>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="truncate">{channel?.label ?? 'Unknown number'}</span><span aria-hidden="true">·</span><span className="truncate">{channel?.display_number}</span>{thread.state === 'snoozed' && <span className="flex items-center gap-0.5 text-amber-700"><Clock size={11} />Snoozed</span>}{thread.state === 'resolved' && <span className="flex items-center gap-0.5 text-emerald-700"><CheckCheck size={11} />Resolved</span>}</div>
              <div className="mt-1 flex items-center gap-2">
                <p className={`min-w-0 flex-1 truncate text-[13px] ${unread ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {thread.last_direction === 'outbound' && <CheckCheck size={13} className="mr-1 inline text-sky-600" aria-label="Agent replied" />}
                  {previewText(thread.last_preview) || <span className="inline-flex items-center gap-1"><ImageIcon size={12} />Media message</span>}
                </p>
                {unread && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white" aria-label={`${thread.unread_count || ''} unread`}>{thread.marked_unread && !thread.unread_count ? '' : (thread.unread_count ?? 0) > 99 ? '99+' : thread.unread_count}</span>}
              </div>
              {(threadLabels.length > 0 || waiting || thread.lead_status !== 'new') && <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {waiting && <span title="The customer is waiting for the agent's reply" className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${waitMinutes > 60 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>Waiting {waitingFor(thread.last_message_at, now)}</span>}
                {thread.lead_status !== 'new' && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">{thread.lead_status}</span>}
                {threadLabels.slice(0, 3).map(l => <LabelChip key={l.id} label={l} />)}{threadLabels.length > 3 && <span className="text-[11px] text-muted-foreground">+{threadLabels.length - 3}</span>}
              </div>}
            </div>
          </button>
        </li>
      })}
      {!loading && !error && threads.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">{channels.length ? filters.tab === 'waiting' ? 'Nobody is waiting for a reply. 🎉' : 'No conversations here.' : 'Add a business number to start monitoring.'}</li>}
      {loading && threads.length === 0 && [0, 1, 2, 3, 4].map(i => <li key={i} className="flex gap-3 border-b border-border/70 px-4 py-3"><span className="size-10 animate-pulse rounded-full bg-muted" /><span className="flex-1 space-y-2"><span className="block h-3 w-2/3 animate-pulse rounded bg-muted" /><span className="block h-3 w-full animate-pulse rounded bg-muted" /></span></li>)}
      <li ref={sentinel} className="p-3 text-center text-xs text-muted-foreground">{loadingMore ? 'Loading more…' : !more && threads.length > 0 ? 'End of list' : ''}</li>
    </ul>
  </section>
}
