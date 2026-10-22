'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, Zap } from 'lucide-react'
import type { QuickReply } from '@/lib/monitoring/workflow-types'
import { readJson } from './ui'

const input = 'w-full rounded-lg border border-border bg-background p-3 text-sm'
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40'
function useReplies(search: string, revision: number, enabled = true) {
  const [data, setData] = useState<{ replies: QuickReply[]; total: number } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/monitoring/quick-replies?q=${encodeURIComponent(search)}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
        const result = await readJson(response)
        if (!response.ok) throw new Error(result.error || 'Unable to load saved replies.')
        if (!controller.signal.aborted) { setData(result); setError('') }
      }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [search, revision, enabled])
  return { data, error }
}
export function QuickReplyPicker({ disabled, onInsert }: { disabled: boolean; onInsert: (reply: QuickReply) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)
  const { data, error } = useReplies(search, retry, open)
  return <div>
    <button type="button" className={button} disabled={disabled} aria-expanded={open} onClick={() => setOpen(v => !v)}><Zap size={14} className="mr-1 inline" />Saved replies</button>
    {open && <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <input aria-label="Find saved reply" className={input} maxLength={120} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search saved replies by title" />
      {error && <p role="alert" className="text-xs text-destructive">{error} <button className={button} onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
      {!data && !error && <p className="text-xs">Loading saved replies…</p>}
      <ul className="max-h-56 space-y-1 overflow-y-auto">{data?.replies.map(reply => <li key={reply.id}><button disabled={disabled} className="w-full rounded-lg p-2 text-left hover:bg-muted disabled:opacity-40" onClick={() => { onInsert(reply); setOpen(false) }}><span className="block text-sm font-medium">{reply.title}</span><span className="block truncate text-xs text-muted-foreground">{reply.body}</span></button></li>)}</ul>
      {data?.total === 0 && <p className="text-xs text-muted-foreground">No matching replies. Create one in Saved replies from the sidebar.</p>}
      {data && data.total > data.replies.length && <p className="text-xs">Showing the first 100 matches. Refine your search.</p>}
      <p className="text-xs text-muted-foreground">Inserts into your draft. Review it before sending.</p>
    </div>}
  </div>
}

export function QuickRepliesPanel() {
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<QuickReply | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [remove, setRemove] = useState<string | null>(null)
  const pending = useRef<{ key: string; request_id: string } | null>(null)
  const { data, error: loadError } = useReplies(search, revision)
  async function save() {
    if (busy || !title.trim() || !body.trim()) return
    setBusy(true); setError(''); setNotice('')
    const key = JSON.stringify([title.trim(), body.trim()])
    if (pending.current?.key !== key) pending.current = { key, request_id: crypto.randomUUID() }
    try {
      const response = await fetch('/api/monitoring/quick-replies', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body, ...(editing ? { action: 'update', id: editing.id, version: editing.version } : { request_id: pending.current.request_id }) }) })
      const result = await readJson(response)
      if (!response.ok) throw new Error(result.error || 'Unable to save reply.')
      setEditing(null); setTitle(''); setBody(''); pending.current = null; setRevision(n => n + 1); setNotice('Saved reply ready for management.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function destroy(reply: QuickReply) {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/monitoring/quick-replies', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: reply.id, version: reply.version }) })
      const result = await readJson(response)
      if (!response.ok) throw new Error(result.error || 'Unable to remove reply.')
      setRemove(null); setRevision(n => n + 1); setNotice('Saved reply removed.')
      if (editing?.id === reply.id) { setEditing(null); setTitle(''); setBody('') }
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
    <section aria-label="Saved reply library" className="space-y-4 crm-card p-6">
      <div />
      <label className="flex items-center gap-2"><Search size={18} /><input aria-label="Search saved replies" className={input} placeholder="Search by title" maxLength={120} value={search} onChange={e => setSearch(e.target.value)} /></label>
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError} <button className={button} onClick={() => setRevision(n => n + 1)}>Refresh replies</button></p>}
      <ul className="space-y-3">{data?.replies.map(reply => <li key={reply.id} className="rounded-lg border border-border p-4"><p className="font-medium">{reply.title}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{reply.body}</p><div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={() => { setEditing(reply); setTitle(reply.title); setBody(reply.body); setError(''); setNotice('') }}>Edit</button>{remove === reply.id ? <><button className={button + ' text-destructive'} disabled={busy} onClick={() => void destroy(reply)}>Confirm removal</button><button className={button} onClick={() => setRemove(null)}>Cancel removal</button></> : <button disabled={busy} className={button} onClick={() => setRemove(reply.id)}>Remove</button>}</div></li>)}</ul>
      {data?.total === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No saved replies found.</p>}
      {data && data.total > 100 && <p className="text-xs text-muted-foreground">Showing 100 of {data.total}. Search to find another reply.</p>}
    </section>
    <form className="space-y-4 crm-card p-6" onSubmit={e => { e.preventDefault(); void save() }}>
      <h3 className="font-semibold">{editing ? 'Edit saved reply' : 'New saved reply'}</h3>
      <label className="block text-sm">Title<input aria-label="Saved reply title" className={input + ' mt-1'} maxLength={80} required disabled={busy} value={title} onChange={e => setTitle(e.target.value)} placeholder="Welcome message" /></label>
      <label className="block text-sm">Message<textarea aria-label="Saved reply message" className={input + ' mt-1 min-h-40'} maxLength={4096} required disabled={busy} value={body} onChange={e => setBody(e.target.value)} placeholder="Hello {{name}}, how can we help?" /></label>
      <p className="text-xs text-muted-foreground">Personalize with {'{{name}}'}, {'{{phone}}'} or {'{{agent}}'}. These are draft shortcuts, not approved WhatsApp templates.</p>
      <div className="flex gap-2"><button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40" disabled={busy || !title.trim() || !body.trim()}>{busy ? 'Saving…' : 'Save reply'}</button>{editing && <button type="button" className={button} disabled={busy} onClick={() => { setEditing(null); setTitle(''); setBody('') }}>Cancel edit</button>}</div>
      {error && <p role="alert" className="text-sm text-destructive">{error} <button type="button" className={button} onClick={() => setRevision(n => n + 1)}>Refresh replies</button></p>}
      {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
    </form>
  </div>
}
