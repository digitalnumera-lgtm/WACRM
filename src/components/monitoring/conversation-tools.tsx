'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCheck, Clock, LockKeyhole } from 'lucide-react'
import type { InternalNote, ThreadWorkflow } from '@/lib/monitoring/workflow-types'

const button = 'rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-40'
export function ConversationTools({ id, count, workflow, onSaved, onRetry }: {
  id: string; count: number; workflow?: ThreadWorkflow; onSaved: (value: ThreadWorkflow) => void; onRetry: () => void;
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function update(change: Record<string, unknown>) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/monitoring/threads/${id}/workflow`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...change, observed_count: count }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to save conversation status.')
      onSaved(data.workflow)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const unread = workflow && (workflow.unread_count > 0 || workflow.marked_unread)
  return <section aria-label="Conversation tools" className="space-y-2 border-b border-border bg-muted/20 px-4 py-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${workflow?.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : workflow?.status === 'snoozed' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>{workflow ? workflow.status[0].toUpperCase() + workflow.status.slice(1) : 'Loading status…'}</span>
      <button className={button} disabled={busy || !workflow} onClick={() => void update({ action: 'status', status: workflow?.status === 'open' ? 'resolved' : 'open' })}><CheckCheck className="mr-1 inline" size={14} />{workflow?.status === 'open' ? 'Resolve' : 'Reopen'}</button>
      <label className="flex items-center gap-1 text-xs"><Clock size={14} /><select aria-label="Snooze conversation" className={button + ' bg-background'} value="" disabled={busy || !workflow} onChange={e => { if (e.target.value) void update({ action: 'status', status: 'snoozed', until: new Date(Date.now() + Number(e.target.value) * 3600000).toISOString() }) }}><option value="">Snooze…</option><option value="1">1 hour</option><option value="4">4 hours</option><option value="24">24 hours</option><option value="168">1 week</option></select></label>
      <button className={button} disabled={busy || !workflow} onClick={() => void update({ action: unread ? 'read' : 'unread' })}>{unread ? 'Mark read' : 'Mark unread'}</button>
      {workflow && <span className="text-xs text-muted-foreground">{workflow.marked_unread ? 'Marked unread' : workflow.unread_count ? `${workflow.unread_count} unread in CRM` : 'Read in CRM'}</span>}
      {!workflow && <button className={button} onClick={onRetry}>Retry status</button>}
    </div>
    {workflow?.snoozed_until && <p className="text-xs text-muted-foreground">Snoozed until {new Date(workflow.snoozed_until).toLocaleString()}. New messages reopen the conversation.</p>}
    <p className="text-[11px] text-muted-foreground">CRM read state includes customer and agent messages. WhatsApp read receipts are unchanged.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>
}

export function InternalNotes({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<InternalNote[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const pending = useRef<{ body: string; request_id: string } | null>(null)
  const loadAbort = useRef<AbortController | null>(null)
  const endpoint = `/api/monitoring/threads/${id}/notes`
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    loadAbort.current = controller
    fetch(endpoint, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load notes.')
      if (!controller.signal.aborted) { setNotes(data.notes); setCursor(data.nextCursor); setError('') }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [endpoint, open, revision])
  async function older() {
    if (!cursor || loading) return
    setLoading(true)
    const signal = loadAbort.current?.signal
    try {
      const response = await fetch(`${endpoint}?before=${encodeURIComponent(cursor)}`, { cache: 'no-store', signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load notes.')
      if (!signal?.aborted) { setNotes(old => [...new Map([...old, ...data.notes].map(n => [n.id, n])).values()]); setCursor(data.nextCursor); setError('') }
    } catch (e) { if (!signal?.aborted) setError((e as Error).message) } finally { setLoading(false) }
  }
  async function save() {
    if (!body.trim() || busy) return
    // Reuse the ID after a timeout. A deliberate text edit starts another note.
    if (pending.current?.body !== body.trim()) pending.current = { body: body.trim(), request_id: crypto.randomUUID() }
    setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to save note.')
      pending.current = null; setBody(''); setRevision(n => n + 1)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <details className="border-t border-border bg-amber-50/40 p-4 dark:bg-amber-950/10" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold"><LockKeyhole size={15} className="mr-2 inline" />Internal notes</summary>
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">Private to management. Notes are never sent to WhatsApp.</p>
      <textarea aria-label="Internal note" className="min-h-24 w-full rounded-lg border border-amber-200 bg-background p-3 text-sm" value={body} maxLength={5000} disabled={busy} onChange={e => setBody(e.target.value)} placeholder="Add context or a follow-up for management…" />
      <button className={button} onClick={() => void save()} disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Add internal note'}</button>
      {error && <p role="alert" className="text-sm text-destructive">{error} <button className={button} onClick={() => setRevision(n => n + 1)}>Reload notes</button></p>}
      <ul aria-label="Internal notes" className="max-h-80 space-y-2 overflow-y-auto">{notes.map(note => <li key={note.id} className="rounded-lg border border-amber-200/70 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"><p className="whitespace-pre-wrap break-words text-sm">{note.body}</p><p className="mt-2 text-[11px] text-muted-foreground">{note.author} · {new Date(note.created_at).toLocaleString()}</p></li>)}</ul>
      {cursor && <button className={button} disabled={loading} onClick={() => void older()}>{loading ? 'Loading…' : 'Earlier notes'}</button>}
    </div>}
  </details>
}
