'use client'

import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
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
  if (failed) return <div className="mt-2 space-y-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="status"><p>{problem?.message || 'Checking attachment access…'}</p><div className="flex flex-wrap gap-3"><button className="underline" onClick={() => { setProblem(null); setFailed(false); setAttempt(attempt + 1) }}>Retry</button>{problem?.renew && <a className="underline" href="/monitoring?view=settings&section=access">Renew Meta access</a>}{problem?.download && <a className="underline" href={src} download>Download attachment</a>}{problem?.login && <a className="underline" href="/login">Sign in</a>}</div></div>
  const error = () => setFailed(true)
  if (message.kind === 'image' || message.kind === 'sticker') {
    // Authenticated, uncached media must not pass through a public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={message.content || 'WhatsApp image'} loading="lazy" onError={error} className="mt-2 max-h-96 max-w-full rounded-lg object-contain" /></a>
  }
  if (message.kind === 'audio') return <VoicePlayer key={src} src={src} seed={message.id} onError={error} />
  if (message.kind === 'video') return <video key={src} src={src} controls playsInline preload="none" onError={error} className="mt-2 max-h-96 max-w-full rounded-lg" aria-label="WhatsApp video message" />
  if (message.kind === 'document') return <a className="mt-2 inline-block rounded-lg border border-border p-3 text-sm underline" href={src} download>Download document</a>
  return <p className="mt-1 text-xs text-muted-foreground">Preview is not available for this attachment type.</p>
}

export function mediaLabel(kind: string) {
  return ({ image: 'Photo', sticker: 'Sticker', audio: 'Voice note', video: 'Video', document: 'Document' } as Record<string, string>)[kind] ?? 'Attachment'
}

const bars = (seed: string) => Array.from({ length: 36 }, (_, i) => {
  const code = seed.charCodeAt(i % seed.length) + i * 31
  return 25 + ((code * 9301 + 49297) % 233280) / 233280 * 75
})
const mmss = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00'

/** Waveform-style voice note player (loads only when played). */
function VoicePlayer({ src, seed, onError }: { src: string; seed: string; onError: () => void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)
  const heights = bars(seed)
  const progress = duration ? time / duration : 0
  const toggle = () => { const el = audio.current; if (!el) return; if (el.paused) void el.play().catch(onError); else el.pause() }
  return <div className="mt-1.5 flex w-64 max-w-full items-center gap-2.5">
    <audio ref={audio} src={src} preload="none" onError={onError} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setTime(0) }}
      onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onLoadedMetadata={e => setDuration(e.currentTarget.duration)} />
    <button type="button" onClick={toggle} aria-label={playing ? 'Pause voice note' : 'Play voice note'} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-current">
      {playing ? <Pause size={15} className="fill-current text-[var(--bubble-icon)]" /> : <Play size={15} className="ml-0.5 fill-current text-[var(--bubble-icon)]" />}
    </button>
    <div role="slider" aria-label="Voice note position" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} tabIndex={0}
      className="flex h-8 flex-1 cursor-pointer items-center gap-[2px]"
      onClick={e => { const el = audio.current; if (!el || !duration) { toggle(); return } const box = e.currentTarget.getBoundingClientRect(); el.currentTime = ((e.clientX - box.left) / box.width) * duration }}
      onKeyDown={e => { const el = audio.current; if (!el) return; if (e.key === 'ArrowRight') el.currentTime += 5; if (e.key === 'ArrowLeft') el.currentTime -= 5; if (e.key === ' ') { e.preventDefault(); toggle() } }}>
      {heights.map((h, i) => <span key={i} className="wave-bar" data-played={i / heights.length < progress} style={{ height: `${h}%` }} />)}
    </div>
    <span className="w-8 shrink-0 text-right text-[11px] tabular-nums opacity-70">{mmss(playing || time ? time : duration)}</span>
    <button type="button" onClick={() => { const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(next); if (audio.current) audio.current.playbackRate = next }} className="shrink-0 rounded-full border border-current/30 px-1.5 text-[10px] font-semibold opacity-70 hover:opacity-100" aria-label={`Playback speed ${rate}×`}>{rate}×</button>
  </div>
}
