'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, LoaderCircle } from 'lucide-react'
import { MessageMedia } from './message-media'
import { ReplyComposer } from './reply-composer'
import { ConversationTools, InternalNotes } from './conversation-tools'
import type { ThreadWorkflow } from '@/lib/monitoring/workflow-types'
import { leadStatuses, type MonitoringChannel, type MonitoringMessage, type MonitoringThread, type ThreadDetail } from '@/lib/monitoring/types'

export type ChatSnapshot = ThreadDetail & { nextCursor: string | null }
const button = 'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40'
const timestamp = (value: string) => new Date(value).toLocaleString()
const cursor = (m: MonitoringMessage) => `${m.sent_at}|${m.id}`
export function mergeMessages(old: MonitoringMessage[], incoming: MonitoringMessage[]) {
  const rows = new Map(old.map(m => [m.id, m]))
  incoming.forEach(m => rows.set(m.id, m))
  return [...rows.values()].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id))
}
async function read(url: string, signal: AbortSignal): Promise<ChatSnapshot> {
  const response = await fetch(url, { cache: 'no-store', signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to load messages.')
  return data
}

export function Conversation({ id, preview, channels, repliesEnabled, cache, workflow, onWorkflowChanged, onChanged }: {
  id: string; preview?: MonitoringThread; channels: MonitoringChannel[]; repliesEnabled: boolean;
  workflow?: ThreadWorkflow; onWorkflowChanged: (value: ThreadWorkflow) => void;
  cache: Map<string, ChatSnapshot>; onChanged: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(() => cache.get(id) ?? null)
  const snapshotRef = useRef(snapshot)
  const [error, setError] = useState('')
  const [olderBusy, setOlderBusy] = useState(false)
  const [newMessages, setNewMessages] = useState(false)
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditPage, setAuditPage] = useState(0)
  const [audit, setAudit] = useState<{ rows: ThreadDetail['audit']; total: number } | null>(null)
  const [auditError, setAuditError] = useState('')
  const viewport = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const polling = useRef(false)
  const positioned = useRef(false)
  const scrollUpdate = useRef<{ height: number; top: number } | 'bottom' | null>('bottom')
  const endpoint = `/api/monitoring/threads/${id}`
  const save = useCallback((value: ChatSnapshot) => {
    snapshotRef.current = value; cache.delete(id); cache.set(id, value)
    // Cache recent chats in this signed-in workspace only, never browser storage.
    while (cache.size > 8) cache.delete(cache.keys().next().value!)
    setSnapshot(value)
  }, [cache, id])
  const nearBottom = () => !viewport.current || viewport.current.scrollHeight - viewport.current.scrollTop - viewport.current.clientHeight < 100

  const latest = useCallback(async () => {
    if (!abort.current || polling.current) return
    polling.current = true
    const signal = abort.current.signal
    try {
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
        // An initial fetch is the latest 50; subsequent polls catch up every new
        // message in ascending batches, even when more than 50 arrived.
        next = newest ? response.nextCursor : null
      } while (next && !signal.aborted)
    } catch (e) { if (!signal.aborted) setError((e as Error).message) }
    finally { if (abort.current?.signal === signal) polling.current = false }
  }, [endpoint, save])

  useEffect(() => {
    abort.current = new AbortController()
    polling.current = false
    void latest()
    const timer = setInterval(() => { if (!document.hidden) void latest() }, 15000)
    return () => { abort.current?.abort(); clearInterval(timer) }
  }, [latest, retry])

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
  }, [snapshot])
  useEffect(() => {
    const el = viewport.current
    const top = sentinel.current
    if (!el || !top || !snapshot?.nextCursor || error) return
    const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) void older() }, { root: el, rootMargin: '120px 0px 0px' })
    observer.observe(top)
    return () => observer.disconnect()
  }, [older, snapshot?.nextCursor, error])
  useEffect(() => {
    if (!auditOpen) return
    const controller = new AbortController()
    read(`${endpoint}?scroll=1&auditOnly=1&auditPage=${auditPage}`, controller.signal)
      .then(data => { setAudit({ rows: data.audit, total: data.auditTotal }); setAuditError('') })
      .catch(e => { if (!controller.signal.aborted) setAuditError(e.message) })
    return () => controller.abort()
  }, [endpoint, auditPage, auditOpen])

  const thread = snapshot?.thread ?? preview
  const channel = channels.find(c => c.id === thread?.channel_id)
  return <div>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-card p-4">
      <div className="min-w-0"><h3 className="break-words text-lg font-semibold">{thread?.customer_name || thread?.customer || 'Opening conversation…'}</h3><p className="text-xs text-muted-foreground">{thread?.customer}</p><p className="mt-2 text-xs text-muted-foreground">{channel?.label} {channel?.display_number && `· ${channel.display_number}`} {channel && !channel.active && '· Removed from monitoring'}</p></div>
      {thread && <label className="text-xs text-muted-foreground">Lead status<select aria-label="Conversation lead status" className="mt-1 block rounded-lg border border-border bg-background p-2 text-sm" value={thread.lead_status} disabled={saving} onChange={async e => {
        setSaving(true)
        try {
          const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_status: e.target.value }) })
          const result = await response.json(); if (!response.ok) throw new Error(result.error)
          await latest(); onChanged()
        } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
      }}>{!leadStatuses.includes(thread.lead_status as typeof leadStatuses[number]) && <option>{thread.lead_status}</option>}{leadStatuses.map(status => <option key={status}>{status}</option>)}</select></label>}
    </header>
    {thread && <ConversationTools id={id} count={thread.message_count} workflow={workflow} onSaved={onWorkflowChanged} onRetry={onChanged} />}
    {error && <div role="alert" className="flex items-center justify-between gap-3 bg-destructive/10 p-3 text-sm text-destructive">{error}<button className={button} onClick={() => { setError(''); setRetry(n => n + 1) }}>Retry</button></div>}
    <div className="relative">
      <div ref={viewport} aria-label="Chat messages" className="h-[58vh] min-h-72 space-y-3 overflow-y-auto overscroll-contain bg-slate-100/80 p-4 dark:bg-slate-950/50 [overflow-anchor:none]" onScroll={() => { if (nearBottom()) setNewMessages(false) }}>
        <div ref={sentinel} className="h-1" />
        {olderBusy && <p role="status" className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" />Loading earlier messages…</p>}
        {snapshot && !snapshot.nextCursor && snapshot.messages.length > 0 && <p className="text-center text-xs text-muted-foreground">Beginning of saved conversation</p>}
        {!snapshot && !error && <div role="status" aria-label="Loading messages" className="space-y-5 py-5">{[0, 1, 2, 3].map(i => <div key={i} className={`h-16 w-3/4 animate-pulse rounded-2xl ${i % 2 ? 'ml-auto bg-emerald-200/50 dark:bg-emerald-950' : 'bg-white dark:bg-slate-800'}`} />)}</div>}
        {snapshot?.messages.map((message, index, messages) => <div key={message.id}>
          {(index === 0 || new Date(messages[index - 1].sent_at).toLocaleDateString() !== new Date(message.sent_at).toLocaleDateString()) && <div className="my-4 text-center"><span className="rounded-full bg-slate-200/80 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{new Date(message.sent_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>}
          <article data-message-id={message.id} className={`w-fit max-w-[90%] rounded-2xl border p-3 shadow-sm ${message.direction === 'outbound' ? 'ml-auto rounded-tr-sm border-emerald-200 bg-emerald-100 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50' : 'rounded-tl-sm border-sky-100 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'}`}>
            <p className={`mb-1 text-[11px] font-semibold ${message.direction === 'outbound' ? 'text-emerald-700 dark:text-emerald-300' : 'text-sky-700 dark:text-sky-300'}`}>{message.direction === 'outbound' ? `${channel?.label ?? 'Business'} · Sent` : 'Customer · Received'}</p>
            {message.reaction && <div className="mb-1 text-sm"><span className="text-xl">{message.reaction.emoji || 'Reaction removed'}</span><p className="text-xs opacity-70">{messages.find(m => m.meta_id === message.reaction?.target)?.content || 'Reaction to an earlier message'}</p></div>}
            {!message.reaction && (message.content || !message.media_id) && <p className="whitespace-pre-wrap break-words text-sm">{message.content || (message.kind === 'revoke' ? 'This message was deleted' : 'This message format is not available yet.')}</p>}
            <MessageMedia message={message} /><time title={timestamp(message.sent_at)} className="mt-2 block text-right text-[10px] opacity-60">{new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          </article>
        </div>)}
        {snapshot?.messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No saved messages yet.</p>}
      </div>
      {newMessages && <button className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg" onClick={() => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; setNewMessages(false) }}>New messages<ArrowDown size={16} /></button>}
    </div>
    {repliesEnabled && <ReplyComposer threadId={id} variables={{ name: thread?.customer_name || thread?.customer || '', phone: thread?.customer || '', agent: channel?.label || '' }} onSent={() => { scrollUpdate.current = 'bottom'; void latest(); onChanged() }} />}
    <InternalNotes id={id} />
    <details className="border-t border-border p-4" onToggle={e => setAuditOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Lead history</summary>{auditError && <p role="alert">{auditError}</p>}{auditOpen && !audit && <p className="mt-3 text-xs">Loading lead history…</p>}<ul className="mt-3 space-y-2 text-xs">{audit?.rows.map(row => <li key={row.id}>{row.previous_status} → {row.new_status} · {timestamp(row.changed_at)}</li>)}</ul>{audit?.total === 0 && <p className="text-xs text-muted-foreground">No lead changes yet.</p>}{audit && audit.total > 25 && <div className="mt-3 flex justify-between"><button className={button} disabled={!auditPage} onClick={() => setAuditPage(p => p - 1)}>Previous</button><button className={button} disabled={(auditPage + 1) * 25 >= audit.total} onClick={() => setAuditPage(p => p + 1)}>Next</button></div>}</details>
  </div>
}
