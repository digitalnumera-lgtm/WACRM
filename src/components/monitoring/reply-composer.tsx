'use client'

import { useEffect, useState } from 'react'
import { QuickReplyPicker } from './quick-replies'
import { expandQuickReply } from '@/lib/monitoring/workflow-types'

type Pending = { request_id: string; text: string }
type SendResult = { state?: 'accepted' | 'rejected' | 'uncertain'; message?: string; error?: string }
type WindowInfo = { enabled?: boolean; open: boolean; expires_at: string | null; active: boolean; attempt?: SendResult | null }

export function ReplyComposer({ threadId, variables, onSent }: { threadId: string; variables: { name: string; phone: string; agent: string }; onSent: () => void }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [info, setInfo] = useState<WindowInfo | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const storageKey = `wacrm-pending-reply:${threadId}`
  const endpoint = `/api/monitoring/threads/${threadId}/reply`
  const remember = (value: Pending | null) => {
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey) } catch { /* The server still protects duplicate request IDs. */ }
    setPending(value)
  }
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
        if (saved && typeof saved.request_id === 'string' && typeof saved.text === 'string') { setPending(saved); setText(saved.text); setNotice('A previous reply needs a status check before you send another.') }
      } catch { /* A corrupt draft does not prevent loading the conversation. */ }
      setReady(true)
    })
    const abort = new AbortController()
    const load = () => fetch(endpoint, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to check reply availability.')
      if (!cancelled) setInfo(body)
    }).catch(error => { if (!cancelled) setNotice(error.message) })
    void load()
    const timer = setInterval(() => { if (!document.hidden) void load() }, 30000)
    return () => { cancelled = true; clearInterval(timer); abort.abort() }
  }, [endpoint, storageKey])

  function finish(result: SendResult) {
    setNotice(result.message || result.error || 'Unable to confirm this reply. Check its status before trying again.')
    if (result.state === 'accepted') { remember(null); setText(''); onSent() }
    if (result.state === 'rejected') remember(null)
  }
  async function send() {
    if (busy || !ready) return
    const wasPending = pending !== null
    const attempt = pending ?? { request_id: crypto.randomUUID(), text: text.trim() }
    if (!attempt.text) return
    remember(attempt); setBusy(true)
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attempt) })
      const result = await response.json()
      finish(result)
      // These responses are emitted before a reservation/send. Server failures
      // remain pending because they may have occurred after Meta acceptance.
      if (!wasPending && !result.state && [400, 401, 403, 404, 409, 429].includes(response.status)) remember(null)
    } catch { setNotice('The connection was interrupted. Check send status; do not create a second copy of this reply.') }
    finally { setBusy(false) }
  }
  async function check() {
    if (!pending || busy) return
    setBusy(true)
    try {
      const response = await fetch(`${endpoint}?request_id=${pending.request_id}`, { cache: 'no-store' })
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to check send status.')
      setInfo(result)
      if (result.attempt) finish(result.attempt)
      else setNotice('This request has not been recorded. Use Retry same request to continue without creating a duplicate.')
    } catch (error) { setNotice((error as Error).message) }
    finally { setBusy(false) }
  }
  const open = info?.open && info.active && (!info.expires_at || Date.parse(info.expires_at) > Date.now())
  if (info?.enabled === false) return null
  return <section aria-label="Management reply" className="space-y-3 border-t border-border p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Reply as management</h3><span className="text-xs text-muted-foreground">Owner and admin access only</span></div>
    <p className="text-xs text-muted-foreground">{!info ? 'Checking reply availability…' : !info.active ? 'This number is paused.' : open ? `Customer reply window ends ${new Date(info.expires_at!).toLocaleString()}. WhatsApp makes the final eligibility check.` : 'The 24-hour reply window is closed. Wait for a new customer message. Template replies are not available here yet.'}</p>
    <QuickReplyPicker disabled={!ready || busy || !!pending || !open} onInsert={reply => setText(value => [value.trimEnd(), expandQuickReply(reply.body, variables)].filter(Boolean).join('\n'))} />
    <textarea aria-label="Management reply text" className="min-h-28 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm disabled:opacity-60" value={text} onChange={e => setText(e.target.value)} maxLength={8192} disabled={!ready || busy || !!pending || !open} placeholder="Write a reply…" />
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{[...text].length} / 4096 characters · Text replies</span><div className="flex gap-2">{pending && <button className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40" disabled={busy} onClick={check}>Check send status</button>}<button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40" disabled={busy || !ready || (!pending && (!open || !text.trim() || [...text].length > 4096))} onClick={send}>{busy ? 'Working…' : pending ? 'Retry same request' : 'Send reply'}</button></div></div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>
}
