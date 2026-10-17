'use client'

import { useState } from 'react'
import type { MonitoringMessage } from '@/lib/monitoring/types'

export function MessageMedia({ message }: { message: MonitoringMessage }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  if (!message.media_id) return null
  const src = `/api/monitoring/messages/${message.id}/media?attempt=${attempt}`
  if (failed) return <div className="mt-2 text-sm" role="status">Media could not load. It may have expired, be unsupported, or require renewed access. <button className="underline" onClick={() => { setFailed(false); setAttempt(attempt + 1) }}>Retry</button></div>
  const error = () => setFailed(true)
  if (message.kind === 'image' || message.kind === 'sticker') {
    // Authenticated, uncached media must not pass through a public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={message.content || 'WhatsApp image'} loading="lazy" onError={error} className="mt-2 max-h-96 max-w-full rounded-lg object-contain" /></a>
  }
  if (message.kind === 'audio') return <audio key={src} src={src} controls preload="none" onError={error} className="mt-2 max-w-full" aria-label="WhatsApp audio message" />
  if (message.kind === 'video') return <video key={src} src={src} controls playsInline preload="none" onError={error} className="mt-2 max-h-96 max-w-full rounded-lg" aria-label="WhatsApp video message" />
  return <p className="mt-1 text-xs text-muted-foreground">Preview is not available for this attachment type.</p>
}
