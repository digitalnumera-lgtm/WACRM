'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlarmClock, ArrowDown, ArrowLeft, CheckCheck, ChevronDown, LoaderCircle, LockKeyhole, Mail, MailOpen, MoreVertical, PanelRight, RotateCcw } from 'lucide-react'
import { MessageMedia } from './message-media'
import { ReplyComposer } from './reply-composer'
import type { MonitoringChannel, MonitoringMessage, MonitoringThread, ThreadDetail } from '@/lib/monitoring/types'
import type { ConversationPriority, InternalNote, ThreadWorkflow } from '@/lib/monitoring/workflow-types'
import { api, Avatar, buttonClass, Menu, MenuItem, primaryButton, priorityMeta, PriorityIcon, sendJson } from './ui'

export type ChatSnapshot = ThreadDetail & { nextCursor: string | null }
const cursor = (m: MonitoringMessage) => `${m.sent_at}|${m.id}`
export function mergeMessages(old: MonitoringMessage[], incoming: MonitoringMessage[]) {
  const rows = new Map(old.map(m => [m.id, m]))
  incoming.forEach(m => rows.set(m.id, m))
  return [...rows.values()].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id))
}
// Hover/keyboard prefetch: warm the recent-chat cache before a click so a
// conversation opens instantly. Bounded and deduplicated.
const CACHE_LIMIT = 20
const inflight = new Map<string, Promise<void>>()
function remember(cache: Map<string, ChatSnapshot>, id: string, value: ChatSnapshot) {
  cache.delete(id); cache.set(id, value)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}
export function prefetchConversation(id: string, cache: Map<string, ChatSnapshot>) {
  if (cache.has(id) || inflight.has(id) || inflight.size >= 3) return
  const job = fetch(`/api/monitoring/threads/${id}?scroll=1`, { cache: 'no-store' })
    .then(async response => { if (response.ok && !cache.has(id)) remember(cache, id, await response.json()) })
    .catch(() => { /* Prefetch is best-effort. */ })
    .finally(() => inflight.delete(id))
  inflight.set(id, job)
}
async function read(url: string, signal: AbortSignal): Promise<ChatSnapshot> {
  const response = await fetch(url, { cache: 'no-store', signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to load messages.')
  return data
}
/** Converts the workflow API shape into inbox-row fields. */
export function workflowPatch(w: ThreadWorkflow): Partial<MonitoringThread> {
  return { state: w.status, snoozed_until: w.snoozed_until, unread_count: w.unread_count, marked_unread: w.marked_unread,
    is_unread: w.unread_count > 0 || w.marked_unread, priority: w.priority, ...(w.label_ids ? { label_ids: w.label_ids } : {}) }
}
const snoozeOptions = [
  { label: '1 hour', hours: 1 }, { label: '4 hours', hours: 4 }, { label: 'Tomorrow', hours: 24 }, { label: 'Next week', hours: 168 },
]
type TimelineItem = { type: 'message'; at: string; message: MonitoringMessage } | { type: 'note'; at: string; note: InternalNote }

export function Conversation({ id, thread: listThread, channels, repliesEnabled, workflowReady, cache, contactOpen, onToggleContact, onBack, onPatched, onLoaded, onChanged }: {
  id: string; thread?: MonitoringThread; channels: MonitoringChannel[]; repliesEnabled: boolean; workflowReady: boolean | null;
  cache: Map<string, ChatSnapshot>; contactOpen: boolean; onToggleContact: () => void; onBack: () => void;
  onPatched: (patch: Partial<MonitoringThread>) => void; onLoaded: (thread: MonitoringThread) => void; onChanged: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(() => cache.get(id) ?? null)
  const snapshotRef = useRef(snapshot)
  const [error, setError] = useState('')
  const [olderBusy, setOlderBusy] = useState(false)
  const [newMessages, setNewMessages] = useState(false)
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notes, setNotes] = useState<InternalNote[]>([])
  const [notesRevision, setNotesRevision] = useState(0)
  const [tab, setTab] = useState<'note' | 'reply'>('note')
  const viewport = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const polling = useRef(false)
  const positioned = useRef(false)
  const markedRead = useRef(false)
  const scrollUpdate = useRef<{ height: number; top: number } | 'bottom' | null>('bottom')
  const endpoint = `/api/monitoring/threads/${id}`
  const save = useCallback((value: ChatSnapshot) => {
    snapshotRef.current = value
    // Cache recent chats in this signed-in workspace only, never browser storage.
    remember(cache, id, value)
    setSnapshot(value)
  }, [cache, id])
  const nearBottom = () => !viewport.current || viewport.current.scrollHeight - viewport.current.scrollTop - viewport.current.clientHeight < 100

  const latest = useCallback(async () => {
    if (!abort.current || polling.current) return
    polling.current = true
    const signal = abort.current.signal
    try {
      // A hover prefetch may already be loading this chat: use it.
      if (!snapshotRef.current && inflight.has(id)) {
        await inflight.get(id)
        const warmed = cache.get(id)
        if (warmed && !signal.aborted) { scrollUpdate.current = 'bottom'; snapshotRef.current = warmed; setSnapshot(warmed) }
      }
      const newest = snapshotRef.current?.messages.at(-1)
      let next = newest ? cursor(newest) : null
      do {
        const response = await read(`${endpoint}?scroll=1${next ? `&after=${encodeURIComponent(next)}` : ''}`, signal)
        if (signal.aborted) return
        const current = snapshotRef.current
        const atBottom = nearBottom()
        if (current && response.messages.length === 0 && JSON.stringify(current.thread) === JSON.stringify(response.thread)) { setError(''); break }
        if (!current || atBottom) scrollUpdate.current = 'bottom'
        else if (response.messages.some(m => !current.messages.some(old => old.id === m.id))) setNewMessages(true)
        save({ ...response, messages: mergeMessages(current?.messages ?? [], response.messages), nextCursor: current ? current.nextCursor : response.nextCursor })
        setError('')
        // An initial fetch is the latest 50; later polls catch up in ascending batches.
        next = newest ? response.nextCursor : null
      } while (next && !signal.aborted)
    } catch (e) { if (!signal.aborted) setError((e as Error).message) }
    finally { if (abort.current?.signal === signal) polling.current = false }
  }, [endpoint, save, cache, id])

  useEffect(() => {
    abort.current = new AbortController()
    polling.current = false
    void latest()
    const timer = setInterval(() => { if (!document.hidden) void latest() }, 15000)
    return () => { abort.current?.abort(); clearInterval(timer) }
  }, [latest, retry])

  // Private notes appear inline in the timeline, as in Chatwoot.
  useEffect(() => {
    const controller = new AbortController()
    api<{ notes: InternalNote[] }>(`${endpoint}/notes`, { signal: controller.signal }).then(data => setNotes(data.notes)).catch(() => { /* Notes are secondary to messages. */ })
    return () => controller.abort()
  }, [endpoint, notesRevision])

  const older = useCallback(async () => {
    const current = snapshotRef.current
    if (!current?.nextCursor || pending.current || !abort.current || !positioned.current) return
    pending.current = true; setOlderBusy(true)
    const signal = abort.current.signal
    try {
      const response = await read(`${endpoint}?scroll=1&before=${encodeURIComponent(current.nextCursor)}`, signal)
      if (signal.aborted) return
      const el = viewport.current
      if (el) scrollUpdate.current = { height: el.scrollHeight, top: el.scrollTop }
      const latestValue = snapshotRef.current!
      save({ ...latestValue, messages: mergeMessages(latestValue.messages, response.messages), nextCursor: response.nextCursor })
      setError('')
    } catch (e) { if (!signal.aborted) setError((e as Error).message) }
    finally { pending.current = false; if (!signal.aborted) setOlderBusy(false) }
  }, [endpoint, save])

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el || !snapshot) return
    const change = scrollUpdate.current
    if (change === 'bottom') el.scrollTop = el.scrollHeight
    else if (change) el.scrollTop = change.top + el.scrollHeight - change.height
    scrollUpdate.current = null; positioned.current = true
  }, [snapshot, notes])
  useEffect(() => {
    const el = viewport.current
    const top = sentinel.current
    if (!el || !top || !snapshot?.nextCursor || error) return
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) void older() }, { root: el, rootMargin: '120px 0px 0px' })
    observer.observe(top)
    return () => observer.disconnect()
  }, [older, snapshot?.nextCursor, error])

  const thread: MonitoringThread | undefined = snapshot ? { ...listThread, ...snapshot.thread, ...(listThread ? pickWorkflow(listThread) : {}) } : listThread
  useEffect(() => { if (snapshot?.thread) onLoaded(snapshot.thread) }, [snapshot?.thread, onLoaded])

  async function update(change: Record<string, unknown>) {
    if (!thread) return
    setBusy(true); setActionError('')
    try {
      const data = await api<{ workflow: ThreadWorkflow }>(`${endpoint}/workflow`, sendJson('PATCH', { ...change, observed_count: thread.message_count }))
      onPatched(workflowPatch(data.workflow))
    } catch (e) { setActionError((e as Error).message) } finally { setBusy(false) }
  }
  // Opening a conversation marks its current messages reviewed in this CRM
  // (never a WhatsApp read receipt). "Mark unread" undoes it.
  const unread = !!thread && ((thread.unread_count ?? 0) > 0 || !!thread.marked_unread)
  useEffect(() => {
    if (!snapshot || !workflowReady || markedRead.current || !thread?.state || !unread) return
    markedRead.current = true
    void update({ action: 'read' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, workflowReady, thread?.state, unread])

  const channel = channels.find(c => c.id === thread?.channel_id)
  const name = thread?.customer_name || (thread ? `+${thread.customer}` : 'Opening conversation…')
  const items: TimelineItem[] = [
    ...(snapshot?.messages ?? []).map(message => ({ type: 'message' as const, at: message.sent_at, message })),
    // Only show notes inside the loaded message range, so scrolling stays stable.
    ...notes.filter(n => !snapshot?.nextCursor || !snapshot.messages[0] || n.created_at >= snapshot.messages[0].sent_at).map(note => ({ type: 'note' as const, at: note.created_at, note })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  const state = thread?.state
  const priority = (thread?.priority ?? 'none') as ConversationPriority

  return <div className="flex h-full min-h-0 flex-col bg-card">
    <header className="flex items-center gap-3 border-b border-border px-4 py-3">
      <button className={`${buttonClass} px-2 lg:hidden`} aria-label="Back to conversations" onClick={onBack}><ArrowLeft size={16} /></button>
      {thread && <Avatar name={name} seed={thread.customer} />}
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 truncate text-base font-semibold">{name}<PriorityIcon priority={priority} /></h3>
        <p className="truncate text-xs text-muted-foreground">{thread && `+${thread.customer}`}{channel && <> · <span className="font-medium text-foreground/80">{channel.label}</span> · {channel.display_number}</>}{channel && !channel.active && ' · removed from monitoring'}</p>
      </div>
      {workflowReady && thread?.state && <div className="flex items-center gap-1.5">
        <div className="flex">
          {state === 'open'
            ? <button className={`${primaryButton} rounded-r-none bg-emerald-600`} disabled={busy} onClick={() => void update({ action: 'status', status: 'resolved' })}><CheckCheck size={16} /><span className="hidden sm:inline">Resolve</span></button>
            : <button className={`${primaryButton} rounded-r-none`} disabled={busy} onClick={() => void update({ action: 'status', status: 'open' })}><RotateCcw size={16} /><span className="hidden sm:inline">Reopen</span></button>}
          <Menu label="Snooze conversation" trigger={<ChevronDown size={16} />} disabled={busy}>{close => <>
            <p className="px-3 py-1.5 text-[11px] font-semibold uppercase text-muted-foreground">Snooze until</p>
            {snoozeOptions.map(o => <MenuItem key={o.label} onClick={() => { close(); void update({ action: 'status', status: 'snoozed', until: new Date(Date.now() + o.hours * 3600000).toISOString() }) }}><AlarmClock size={14} />{o.label}</MenuItem>)}
          </>}</Menu>
        </div>
        <Menu label="More actions" trigger={<MoreVertical size={16} />} disabled={busy}>{close => <>
          <MenuItem onClick={() => { close(); void update({ action: unread ? 'read' : 'unread' }) }}>{unread ? <><MailOpen size={14} />Mark as read</> : <><Mail size={14} />Mark as unread</>}</MenuItem>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase text-muted-foreground">Priority</p>
          {(['urgent', 'high', 'medium', 'low', 'none'] as const).map(p => { const Icon = priorityMeta[p].icon; return <MenuItem key={p} active={priority === p} onClick={() => { close(); void update({ action: 'priority', priority: p }) }}><Icon size={14} className={priorityMeta[p].className} />{priorityMeta[p].label}</MenuItem> })}
        </>}</Menu>
      </div>}
      <button className={`${buttonClass} px-2 ${contactOpen ? 'bg-muted' : ''}`} aria-label={contactOpen ? 'Hide contact panel' : 'Show contact panel'} aria-pressed={contactOpen} title="Contact details" onClick={onToggleContact}><PanelRight size={16} /></button>
    </header>
    {state === 'snoozed' && thread?.snoozed_until && <p className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"><AlarmClock size={14} />Snoozed until {new Date(thread.snoozed_until).toLocaleString()}. A new message reopens it.</p>}
    {state === 'resolved' && <p className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900"><CheckCheck size={14} />Resolved. A new message from either side reopens it.</p>}
    {actionError && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{actionError}</p>}
    {error && <div role="alert" className="flex items-center justify-between gap-3 bg-red-50 px-4 py-2 text-sm text-red-700">{error}<button className={buttonClass} onClick={() => { setError(''); setRetry(n => n + 1) }}>Retry</button></div>}
    <div className="relative min-h-0 flex-1">
      <div ref={viewport} aria-label="Chat messages" className="chat-wallpaper h-full space-y-1.5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-8 [overflow-anchor:none]" onScroll={() => { if (nearBottom()) setNewMessages(false) }}>
        <div ref={sentinel} className="h-1" />
        {olderBusy && <p role="status" className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" />Loading earlier messages…</p>}
        {snapshot && !snapshot.nextCursor && snapshot.messages.length > 0 && <p className="py-2 text-center text-xs text-muted-foreground">Beginning of saved conversation</p>}
        {!snapshot && !error && <div role="status" aria-label="Loading messages" className="space-y-4 py-5">{[0, 1, 2, 3].map(i => <div key={i} className={`h-14 w-2/3 animate-pulse rounded-2xl ${i % 2 ? 'ml-auto bg-emerald-100' : 'bg-white'}`} />)}</div>}
        {items.map((item, index) => {
          const previous = items[index - 1]
          const day = new Date(item.at).toDateString()
          const separator = !previous || new Date(previous.at).toDateString() !== day
          return <div key={item.type + (item.type === 'message' ? item.message.id : item.note.id)}>
            {separator && <div className="sticky top-0 z-10 my-3 text-center"><span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm">{dayLabel(item.at)}</span></div>}
            {item.type === 'note' ? <NoteBubble note={item.note} /> : <MessageBubble message={item.message} messages={snapshot!.messages} agent={channel?.label} grouped={previous?.type === 'message' && previous.message.direction === item.message.direction && !separator} />}
          </div>
        })}
        {snapshot?.messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No saved messages yet.</p>}
      </div>
      {newMessages && <button className="absolute bottom-3 right-6 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm text-white shadow-lg" onClick={() => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; setNewMessages(false) }}>New messages<ArrowDown size={16} /></button>}
    </div>
    <footer className="border-t border-border bg-card">
      {repliesEnabled && <div className="flex gap-1 px-4 pt-2" role="tablist">
        <button role="tab" aria-selected={tab === 'note'} className={`rounded-t-lg px-3 py-1.5 text-xs font-semibold ${tab === 'note' ? 'bg-amber-50 text-amber-900' : 'text-muted-foreground'}`} onClick={() => setTab('note')}>Private note</button>
        <button role="tab" aria-selected={tab === 'reply'} className={`rounded-t-lg px-3 py-1.5 text-xs font-semibold ${tab === 'reply' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`} onClick={() => setTab('reply')}>Reply</button>
      </div>}
      {repliesEnabled && tab === 'reply'
        ? <ReplyComposer threadId={id} variables={{ name: thread?.customer_name || thread?.customer || '', phone: thread?.customer || '', agent: channel?.label || '' }} onSent={() => { scrollUpdate.current = 'bottom'; void latest(); onChanged() }} />
        : <NoteComposer endpoint={`${endpoint}/notes`} onSaved={() => { scrollUpdate.current = 'bottom'; setNotesRevision(n => n + 1) }} />}
    </footer>
  </div>
}

function pickWorkflow(t: MonitoringThread): Partial<MonitoringThread> {
  const keys = ['state', 'snoozed_until', 'unread_count', 'marked_unread', 'is_unread', 'priority', 'label_ids', 'lead_status'] as const
  return Object.fromEntries(keys.filter(k => t[k] !== undefined).map(k => [k, t[k]]))
}

function dayLabel(value: string) {
  const date = new Date(value), today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

function MessageBubble({ message, messages, agent, grouped }: { message: MonitoringMessage; messages: MonitoringMessage[]; agent?: string; grouped: boolean }) {
  const outbound = message.direction === 'outbound'
  return <div className={`flex ${outbound ? 'justify-end' : 'justify-start'} ${grouped ? '' : 'pt-2'}`}>
    <article data-message-id={message.id} className={`relative w-fit max-w-[85%] rounded-xl px-3 py-2 shadow-sm sm:max-w-[70%] ${outbound ? 'bg-[#d9fdd3] text-slate-900' : 'bg-white text-slate-900'} ${grouped ? '' : outbound ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}>
      {!grouped && <p className={`mb-0.5 text-[11px] font-semibold ${outbound ? 'text-emerald-700' : 'text-sky-700'}`}>{outbound ? agent ?? 'Agent' : 'Customer'}</p>}
      {message.reaction && <div className="text-sm"><span className="text-2xl">{message.reaction.emoji || '—'}</span><p className="text-xs text-slate-500">{message.reaction.emoji ? 'Reacted to: ' : 'Reaction removed from: '}{messages.find(m => m.meta_id === message.reaction?.target)?.content || 'an earlier message'}</p></div>}
      {!message.reaction && (message.content || !message.media_id) && <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">{message.content || (message.kind === 'revoke' ? <i className="text-slate-500">This message was deleted</i> : message.kind === 'media_placeholder' ? <i className="text-slate-500">📎 Photo, video, voice note or file from chat history. WhatsApp did not share the file itself.</i> : <i className="text-slate-500">This message format is not available yet.</i>)}</p>}
      <MessageMedia message={message} />
      <time title={new Date(message.sent_at).toLocaleString()} className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500">{new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{outbound && <CheckCheck size={12} className="text-sky-500" />}</time>
    </article>
  </div>
}

function NoteBubble({ note }: { note: InternalNote }) {
  return <div className="flex justify-end pt-2">
    <article className="w-fit max-w-[85%] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 shadow-sm sm:max-w-[70%]">
      <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-800"><LockKeyhole size={11} />Private note · {note.author}</p>
      <p className="whitespace-pre-wrap break-words text-[14px] leading-snug text-amber-950">{note.body}</p>
      <time className="mt-0.5 block text-right text-[10px] text-amber-700/80">{new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </article>
  </div>
}

function NoteComposer({ endpoint, onSaved }: { endpoint: string; onSaved: () => void }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingNote = useRef<{ body: string; request_id: string } | null>(null)
  async function save() {
    if (!body.trim() || busy) return
    // Reuse the request ID after a timeout so a retry cannot duplicate the note.
    if (pendingNote.current?.body !== body.trim()) pendingNote.current = { body: body.trim(), request_id: crypto.randomUUID() }
    setBusy(true); setError('')
    try { await api(endpoint, sendJson('POST', pendingNote.current)); pendingNote.current = null; setBody(''); onSaved() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="p-3">
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 focus-within:ring-2 focus-within:ring-amber-200">
      <textarea aria-label="Private note" className="block max-h-40 min-h-16 w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-amber-900/50" value={body} maxLength={5000} disabled={busy}
        onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save() } }}
        placeholder="Add a private note for management. Agents and customers never see it." />
      <div className="flex items-center justify-between gap-2 px-3 pb-2"><span className="flex items-center gap-1 text-[11px] text-amber-800/80"><LockKeyhole size={11} />Visible to management only · Ctrl+Enter to save</span>
        <button className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40" disabled={busy || !body.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Add note'}</button></div>
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
  </div>
}

