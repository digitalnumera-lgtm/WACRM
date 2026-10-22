'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownUp, CheckCheck, ChevronDown, Clock, Contact, FileText, Image as ImageIcon, MapPin, Mic, Paperclip, Pin, Search, SlidersHorizontal, Smile, Sticker, Video, X } from 'lucide-react'
import { leadStatuses, type MonitoringChannel, type MonitoringThread } from '@/lib/monitoring/types'
import type { MonitoringLabel } from '@/lib/monitoring/workflow-types'
import { api, Avatar, buttonClass, inputClass, LabelChip, Menu, MenuItem, PriorityIcon, priorityMeta, waitingFor } from './ui'
import { usePreferences } from './preferences'

export type InboxTab = 'open' | 'waiting' | 'unread' | 'snoozed' | 'resolved' | 'all'
export type InboxFilters = { tab: InboxTab; q: string; channel: string; agent: string; status: string; label: string; priority: string; sort: 'latest' | 'oldest' }
export const emptyFilters: InboxFilters = { tab: 'open', q: '', channel: '', agent: '', status: '', label: '', priority: '', sort: 'latest' }
const tabs: { id: InboxTab; name: string; hint: string }[] = [
  { id: 'open', name: 'Open', hint: 'Chats you have not marked done' },
  { id: 'waiting', name: 'Waiting', hint: 'The customer messaged last and the agent has not replied' },
  { id: 'unread', name: 'Unread', hint: 'New messages you have not looked at' },
  { id: 'resolved', name: 'Done', hint: 'Marked done; a new message reopens it' },
  { id: 'snoozed', name: 'Snoozed', hint: 'Hidden until the snooze ends or a new message arrives' },
  { id: 'all', name: 'All', hint: 'Every chat' },
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
const kindLabels: Record<string, string> = { image: 'Photo', audio: 'Voice message', video: 'Video', document: 'Document', sticker: 'Sticker', media_placeholder: 'Media from chat history', location: 'Location', contacts: 'Contact', reaction: 'Reaction', revoke: 'Message deleted', unsupported: 'Unsupported message' }
const kindIcons: Record<string, typeof Mic> = { image: ImageIcon, audio: Mic, video: Video, document: FileText, sticker: Sticker, media_placeholder: Paperclip, location: MapPin, contacts: Contact, reaction: Smile }
/** Small icon for media-only previews ("[audio]" etc.). */
export function PreviewIcon({ preview }: { preview: string | null }) {
  const kind = preview ? /^\[([a-z_]+)\]$/.exec(preview)?.[1] : null
  const Icon = kind ? kindIcons[kind] : null
  return Icon ? <Icon size={13} className="mr-1 inline -translate-y-px text-muted-foreground" aria-hidden="true" /> : null
}
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

/** Today: clock time; this week: weekday; older: date. */
function listTime(value: string, now: number, hour12: boolean) {
  const date = new Date(value), today = new Date(now)
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 })
  if (date.toDateString() === new Date(now - 86400000).toDateString()) return 'Yesterday'
  if (now - date.getTime() < 6 * 86400000) return date.toLocaleDateString(undefined, { weekday: 'short' })
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function ConversationList({ inbox, filters, setFilters, labels, selected, onSelect, onPrefetch, hidden, pinned = [], refresh = 0 }: {
  inbox: ReturnType<typeof useInbox>; filters: InboxFilters; setFilters: (f: InboxFilters) => void; labels: MonitoringLabel[];
  selected: string | null; onSelect: (id: string) => void; onPrefetch?: (id: string) => void; hidden?: boolean
  pinned?: string[]; refresh?: number
}) {
  const { prefs } = usePreferences()
  const hoverTimer = useRef<number | null>(null)
  const hover = (id: string) => { if (!onPrefetch) return; if (hoverTimer.current) window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => onPrefetch(id), 120) }
  const leave = () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current) }
  const { channels, threads, total, counts, workflowReady, loading, loadingMore, error, more, loadMore } = inbox
  const [search, setSearch] = useState(filters.q)
  const [showFilters, setShowFilters] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  const viewport = useRef<HTMLUListElement>(null)
  const sentinel = useRef<HTMLLIElement>(null)
  const set = (patch: Partial<InboxFilters>) => {
    const next = { ...filters, ...patch }
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

  // Pinned chats are loaded by ID so they stay on top whatever the tab.
  const pinnedKey = pinned.join(',')
  const [pinnedRows, setPinnedRows] = useState<MonitoringThread[]>([])
  useEffect(() => {
    if (!pinnedKey) return
    const controller = new AbortController()
    api<{ threads: MonitoringThread[] }>(`/api/monitoring?scroll=1&tab=all&ids=${pinnedKey}`, { signal: controller.signal })
      .then(d => setPinnedRows(pinnedKey.split(',').map(id => d.threads.find(t => t.id === id)).filter((t): t is MonitoringThread => !!t)))
      .catch(() => {})
    return () => controller.abort()
  }, [pinnedKey, refresh])
  const pinnedThreads = pinnedKey ? pinnedRows.map(p => threads.find(t => t.id === p.id) ?? p).filter(t => pinned.includes(t.id)) : []
  const rest = threads.filter(t => !pinned.includes(t.id))

  const activeFilters = [filters.channel, filters.status, filters.label, filters.priority].filter(Boolean).length
  // Snoozed only shows when something is snoozed.
  const visibleTabs = workflowReady === false ? tabs.filter(t => t.id === 'all') : tabs.filter(t => t.id !== 'snoozed' || filters.tab === 'snoozed' || (counts?.snoozed ?? 0) > 0)
  const labelMap = new Map(labels.map(l => [l.id, l]))
  const agents = [...new Set(channels.map(c => c.label))]
  const hour12 = prefs.timeFormat === '12h'

  const row = (thread: MonitoringThread) => {
    const channel = channels.find(c => c.id === thread.channel_id)
    const name = thread.customer_name || `+${thread.customer}`
    const unread = (thread.unread_count ?? 0) > 0 || thread.marked_unread
    const waiting = thread.last_direction === 'inbound' && thread.state !== 'resolved'
    const waitMinutes = (now - Date.parse(thread.last_message_at)) / 60000
    const threadLabels = (thread.label_ids ?? []).map(id => labelMap.get(id)).filter((l): l is MonitoringLabel => !!l)
    const isPinned = pinned.includes(thread.id)
    return <li key={thread.id} className="group relative px-2">
      <button type="button" onClick={() => onSelect(thread.id)} onMouseEnter={() => hover(thread.id)} onMouseLeave={leave} onFocus={() => onPrefetch?.(thread.id)} aria-current={selected === thread.id ? 'true' : undefined}
        className={`density-row flex w-full gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${selected === thread.id ? 'bg-muted' : 'hover:bg-muted/60'}`}>
        <span className="shrink-0 self-start"><Avatar name={name} seed={thread.customer} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isPinned && <Pin size={12} className="shrink-0 rotate-45 text-muted-foreground" aria-label="Pinned" />}
            <span className={`min-w-0 flex-1 truncate text-sm ${unread ? 'font-bold' : 'font-medium'}`}>{name}</span>
            <PriorityIcon priority={thread.priority} />
            <time className={`shrink-0 text-xs ${unread ? 'font-semibold text-foreground' : 'text-muted-foreground'}`} dateTime={thread.last_message_at} title={new Date(thread.last_message_at).toLocaleString([], { hour12 })}>{listTime(thread.last_message_at, now, hour12)}</time>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className={`min-w-0 flex-1 truncate text-[13px] ${unread ? 'text-foreground' : 'text-muted-foreground'}`}>
              {thread.last_direction === 'outbound' && <CheckCheck size={13} className="mr-1 inline text-emerald-600" aria-label="Agent replied" />}
              <PreviewIcon preview={thread.last_preview} />{previewText(thread.last_preview) || 'Media message'}
            </p>
            {unread && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#C0DD11] px-1.5 text-xs font-bold text-[#121316]" aria-label={`${thread.unread_count || ''} unread`}>{thread.marked_unread && !thread.unread_count ? '' : (thread.unread_count ?? 0) > 99 ? '99+' : thread.unread_count}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate font-medium">{channel?.label ?? 'Unknown number'}</span>
            {waiting && <span className={`rounded-full px-1.5 py-0.5 font-medium ${waitMinutes > 60 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'}`}>Waiting {waitingFor(thread.last_message_at, now)}</span>}
            {thread.state === 'snoozed' && <span className="flex items-center gap-0.5 text-amber-700"><Clock size={11} />Snoozed</span>}
            {thread.state === 'resolved' && <span className="flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400"><CheckCheck size={11} />Done</span>}
            {thread.lead_status !== 'new' && <span className="rounded-full bg-muted px-1.5 py-0.5 capitalize">{thread.lead_status}</span>}
            {threadLabels.slice(0, 2).map(l => <LabelChip key={l.id} label={l} />)}{threadLabels.length > 2 && <span>+{threadLabels.length - 2}</span>}
          </div>
        </div>
      </button>
    </li>
  }

  return <section aria-label="Conversations" className={`flex h-full min-h-0 flex-col bg-card md:rounded-3xl md:border md:border-border md:shadow-sm ${hidden ? 'hidden lg:flex' : 'flex'}`}>
    <div className="space-y-3 px-4 pb-2 pt-4">
      <div className="flex items-center justify-between gap-2"><h2 className="font-display text-2xl font-semibold tracking-tight">Messages</h2>
        <div className="flex items-center gap-1">
          <button type="button" className="relative flex size-9 items-center justify-center rounded-full hover:bg-muted" aria-label="Filters" aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)}><SlidersHorizontal size={17} />{activeFilters > 0 && <span className="absolute right-0 top-0 flex size-4 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">{activeFilters}</span>}</button>
          {agents.length > 1 && <Menu label="Filter by agent" triggerClass={`flex h-9 max-w-36 items-center gap-1 rounded-full px-3 text-xs font-medium hover:bg-muted ${filters.agent || filters.channel ? 'bg-muted' : ''}`} trigger={<><span className="truncate">{filters.agent || (filters.channel ? channels.find(c => c.id === filters.channel)?.label : '') || 'All agents'}</span><ChevronDown size={14} className="shrink-0" /></>}>{close => <>
            {['', ...agents].map(a => <MenuItem key={a || 'all'} active={filters.agent === a && (!!a || !filters.channel)} onClick={() => { close(); set(a ? { agent: a } : { agent: '', channel: '' }) }}>{a || 'All agents'}</MenuItem>)}
          </>}</Menu>}
          <button type="button" className="flex size-9 items-center justify-center rounded-full hover:bg-muted" aria-label={filters.sort === 'latest' ? 'Newest first. Switch to oldest first' : 'Oldest first. Switch to newest first'} title={filters.sort === 'latest' ? 'Newest first' : 'Oldest first'} onClick={() => set({ sort: filters.sort === 'latest' ? 'oldest' : 'latest' })}><ArrowDownUp size={16} /></button>
        </div>
      </div>
      <form role="search" onSubmit={e => { e.preventDefault(); set({ q: search.trim() }) }} className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input id="inbox-search" aria-label="Search conversations" className="w-full rounded-full bg-muted py-2.5 pl-10 pr-9 text-sm outline-none focus:ring-2 focus:ring-[#C0DD11]" placeholder="Search" maxLength={120} value={search} onChange={e => setSearch(e.target.value)} />
        {filters.q && <button type="button" aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => { setSearch(''); set({ q: '' }) }}><X size={16} /></button>}
      </form>
      {showFilters && <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/60 p-3">
        <label className="text-xs font-medium text-muted-foreground">Business number<select className={inputClass} value={filters.channel} onChange={e => set({ channel: e.target.value })}><option value="">All numbers</option>{channels.map(c => <option key={c.id} value={c.id}>{c.label} · {c.display_number}{c.active ? '' : ' (removed)'}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">Lead stage<select className={inputClass} value={filters.status} onChange={e => set({ status: e.target.value })}><option value="">All stages</option>{leadStatuses.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">Priority<select className={inputClass} value={filters.priority} disabled={!workflowReady} onChange={e => set({ priority: e.target.value })}><option value="">Any priority</option>{(['urgent', 'high', 'medium', 'low', 'none'] as const).map(p => <option key={p} value={p}>{priorityMeta[p].label}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">Label<select className={inputClass} value={filters.label} disabled={!workflowReady} onChange={e => set({ label: e.target.value })}><option value="">Any label</option>{labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        {activeFilters > 0 && <button type="button" className="col-span-2 text-left text-xs font-medium underline" onClick={() => setFilters({ ...emptyFilters, tab: filters.tab, q: filters.q, sort: filters.sort, agent: filters.agent })}>Clear filters</button>}
      </div>}
      <nav aria-label="Conversation status" className="-mx-4 flex gap-0.5 overflow-x-auto px-4 [scrollbar-width:none]">{visibleTabs.map(tab => {
        const active = (workflowReady === false ? 'all' : filters.tab) === tab.id
        return <button key={tab.id} type="button" title={tab.hint} aria-current={active ? 'page' : undefined} onClick={() => set({ tab: tab.id, sort: tab.id === 'waiting' && filters.tab !== 'waiting' ? 'oldest' : tab.id !== 'waiting' && filters.tab === 'waiting' ? prefs.defaultSort : filters.sort })}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          {tab.name}{counts && tab.id !== 'resolved' && tab.id !== 'all' && <span className={`text-xs ${tab.id === 'waiting' && counts.waiting > 0 ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>{counts[tab.id] > 999 ? '999+' : counts[tab.id]}</span>}
        </button>
      })}</nav>
    </div>
    {workflowReady === false && <p className="mx-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">Tabs, labels and priority need the inbox database update.</p>}
    {error && <p role="alert" className="mx-4 flex items-center justify-between gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}<button className={buttonClass} onClick={inbox.retry}>Retry</button></p>}
    <ul ref={viewport} aria-label="Conversation list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
      {pinnedThreads.length > 0 && <>
        <li className="px-5 pb-1 pt-2 text-xs font-medium text-muted-foreground">Pinned</li>
        {pinnedThreads.map(row)}
        <li className="px-5 pb-1 pt-3 text-xs font-medium text-muted-foreground">All chats ({total.toLocaleString()})</li>
      </>}
      {!pinnedThreads.length && <li className="flex justify-between px-5 pb-1 text-xs text-muted-foreground"><span>{total.toLocaleString()} conversation{total === 1 ? '' : 's'}</span>{loading && <span>Updating…</span>}</li>}
      {rest.map(row)}
      {!loading && !error && threads.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">{channels.length ? filters.tab === 'waiting' ? 'Nobody is waiting for a reply.' : 'No chats here.' : 'Add an agent’s number in Settings to start.'}</li>}
      {loading && threads.length === 0 && [0, 1, 2, 3, 4].map(i => <li key={i} className="flex gap-3 px-5 py-3"><span className="size-10 animate-pulse rounded-full bg-muted" /><span className="flex-1 space-y-2"><span className="block h-3 w-2/3 animate-pulse rounded bg-muted" /><span className="block h-3 w-full animate-pulse rounded bg-muted" /></span></li>)}
      <li ref={sentinel} className="p-3 text-center text-xs text-muted-foreground">{loadingMore ? 'Loading more…' : !more && threads.length > 0 ? 'End of list' : ''}</li>
    </ul>
  </section>
}
