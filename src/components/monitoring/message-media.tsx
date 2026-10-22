'use client'

import { useEffect, useState } from 'react'
import type { MonitoringMessage } from '@/lib/monitoring/types'
import { useCan } from './access'

export function MessageMedia({ message }: { message: MonitoringMessage }) {
  const allowed = useCan('view_media')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [problem, setProblem] = useState<{ message: string; renew?: boolean; download?: boolean; login?: boolean } | null>(null)
  const src = `/api/monitoring/messages/${message.id}/media?attempt=${attempt}`
  useEffect(() => {
    if (!failed || !message.media_id) return
    const controller = new AbortController()
    fetch(`${src}&diagnose=1`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.status === 401) { if (!controller.signal.aborted) setProblem({ message: 'Your CRM session expired. Sign in again to load this attachment.', login: true }); return }
      const data = await response.json()
      if (controller.signal.aborted) return
      if (response.ok && data.available) setProblem({ message: 'This browser could not preview the attachment. Download it to open in a compatible app.', download: true })
      else setProblem({ message: data.error || 'The CRM could not load this attachment. Please retry.', renew: ['meta_access_invalid', 'meta_access_denied', 'credential_unavailable'].includes(data.code) })
    }).catch(() => { if (!controller.signal.aborted) setProblem({ message: 'The CRM could not be reached. Check your connection and retry.' }) })
    return () => controller.abort()
  }, [failed, src, message.media_id])
  if (!message.media_id) return null
  if (!allowed) return <p className="mt-1 text-xs italic text-slate-500">🔒 {mediaLabel(message.kind)} · your role cannot open media</p>
  if (failed) return <div className="mt-2 space-y-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="status"><p>{problem?.message || 'Checking attachment access…'}</p><div className="flex flex-wrap gap-3"><button className="underline" onClick={() => { setProblem(null); setFailed(false); setAttempt(attempt + 1) }}>Retry</button>{problem?.renew && <a className="underline" href="/monitoring?view=settings">Renew Meta access</a>}{problem?.download && <a className="underline" href={src} download>Download attachment</a>}{problem?.login && <a className="underline" href="/login">Sign in</a>}</div></div>
  const error = () => setFailed(true)
  if (message.kind === 'image' || message.kind === 'sticker') {
    // Authenticated, uncached media must not pass through a public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={message.content || 'WhatsApp image'} loading="lazy" onError={error} className="mt-2 max-h-96 max-w-full rounded-lg object-contain" /></a>
  }
  if (message.kind === 'audio') return <audio key={src} src={src} controls preload="none" onError={error} className="mt-2 max-w-full" aria-label="WhatsApp audio message" />
  if (message.kind === 'video') return <video key={src} src={src} controls playsInline preload="none" onError={error} className="mt-2 max-h-96 max-w-full rounded-lg" aria-label="WhatsApp video message" />
  if (message.kind === 'document') return <a className="mt-2 inline-block rounded-lg border border-border p-3 text-sm underline" href={src} download>Download document</a>
  return <p className="mt-1 text-xs text-muted-foreground">Preview is not available for this attachment type.</p>
}

export function mediaLabel(kind: string) {
  return ({ image: 'Photo', sticker: 'Sticker', audio: 'Voice note', video: 'Video', document: 'Document' } as Record<string, string>)[kind] ?? 'Attachment'
}
