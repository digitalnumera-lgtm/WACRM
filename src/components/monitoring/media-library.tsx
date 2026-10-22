'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileText, ImageOff, MessageSquare, Mic, Play, X } from 'lucide-react'
import type { MonitoringChannel, MonitoringMessage } from '@/lib/monitoring/types'
import { MessageMedia } from './message-media'
import { api, Avatar, buttonClass } from './ui'

const field = 'min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary'

type Item = MonitoringMessage & { thread_id: string; channel_id: string; customer: string; customer_name: string | null }
type Tab = 'visual' | 'audio' | 'document'
const tabs: { id: Tab; label: string; kinds: string; icon: typeof Mic }[] = [
  { id: 'visual', label: 'Photos & videos', kinds: 'image,video,sticker', icon: Play },
  { id: 'audio', label: 'Voice notes', kinds: 'audio', icon: Mic },
  { id: 'document', label: 'Documents', kinds: 'document', icon: FileText },
]
const src = (id: string) => `/api/monitoring/messages/${id}/media`
const day = (value: string) => new Date(value).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Media library: photos and videos in a grid, voice notes and documents in lists. */
export function MediaLibrary({ channels, refresh, onOpen }: { channels: MonitoringChannel[]; refresh: number; onOpen: (threadId: string) => void }) {
  const [tab, setTab] = useState<Tab>('visual')
  const [filters, setFilters] = useState({ channel: '', direction: '', from: '', to: '' })
  const [page, setPage] = useState(0)
  const [viewer, setViewer] = useState<number | null>(null)
  const kinds = tabs.find(t => t.id === tab)!.kinds
  const query = useMemo(() => new URLSearchParams(Object.entries({ ...filters, kinds }).filter(([, v]) => v)).toString(), [filters, kinds])
  const key = `${query}|${page}|${refresh}`
  // "Load more" appends pages of the same query; a new query starts over.
  const [result, setResult] = useState<{ key: string; query: string; items: Item[]; total: number; error: string }>({ key: '', query: '', items: [], total: 0, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    api<{ messages: Item[]; total: number }>(`/api/monitoring/messages?${query}&page=${page}`, { signal: controller.signal })
      .then(data => setResult(old => ({ key, query, total: data.total, error: '',
        items: page && old.query === query ? [...old.items, ...data.messages.filter(m => !old.items.some(o => o.id === m.id))] : data.messages })))
      .catch(e => { if (!controller.signal.aborted) setResult(old => ({ ...old, key, error: e.message })) })
    return () => controller.abort()
  }, [key, query, page])
  const loading = result.key !== key
  const items = useMemo(() => result.query === query ? result.items : [], [result, query])
  const { total, error } = result

  const filter = (key: keyof typeof filters, value: string) => { setFilters(f => ({ ...f, [key]: value })); setPage(0); setViewer(null) }
  const agent = useCallback((id: string) => channels.find(c => c.id === id)?.label ?? 'Business number', [channels])
  const groups = useMemo(() => {
    const out: { day: string; items: { item: Item; index: number }[] }[] = []
    items.forEach((item, index) => {
      const label = day(item.sent_at)
      if (out.at(-1)?.day !== label) out.push({ day: label, items: [] })
      out.at(-1)!.items.push({ item, index })
    })
    return out
  }, [items])

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-2 crm-card p-2">
      <div role="tablist" aria-label="Media type" className="flex flex-wrap gap-1">
        {tabs.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setPage(0); setViewer(null) }}
          className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><t.icon size={15} />{t.label}</button>)}
      </div>
      <div className="flex flex-wrap gap-2 lg:ml-auto">
        <select aria-label="Business number" className={field} value={filters.channel} onChange={e => filter('channel', e.target.value)}><option value="">All numbers</option>{channels.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <select aria-label="Sent by" className={field} value={filters.direction} onChange={e => filter('direction', e.target.value)}><option value="">Everyone</option><option value="inbound">Customers</option><option value="outbound">Agents</option></select>
        <input aria-label="From date" type="date" className={field} value={filters.from} onChange={e => filter('from', e.target.value)} />
        <input aria-label="To date" type="date" className={field} value={filters.to} onChange={e => filter('to', e.target.value)} />
      </div>
    </div>
    <p className="text-sm text-muted-foreground">{loading && !items.length ? 'Loading…' : `${total.toLocaleString()} ${tabs.find(t => t.id === tab)!.label.toLowerCase()}`}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

    {groups.map(group => <div key={group.day} className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{group.day}</h3>
      {tab === 'visual'
        ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">{group.items.map(({ item, index }) => <Tile key={item.id} item={item} onClick={() => setViewer(index)} />)}</div>
        : <ul className="divide-y divide-border overflow-hidden crm-card">{group.items.map(({ item }) => <li key={item.id} className="flex flex-wrap items-center gap-3 p-3">
          <Avatar name={item.customer_name || item.customer} seed={item.customer} size="sm" />
          <div className="min-w-[10rem] flex-1">
            <p className="truncate text-sm font-medium">{item.customer_name || `+${item.customer}`}</p>
            <p className="text-xs text-muted-foreground">{item.direction === 'inbound' ? 'From customer' : 'Sent by agent'} · {agent(item.channel_id)} · {time(item.sent_at)}</p>
            {tab === 'document' && item.content && <p className="mt-1 truncate text-xs">{item.content}</p>}
          </div>
          <div className="min-w-0 basis-full sm:basis-auto">{tab === 'audio' ? <MessageMedia message={item} /> : <a className={buttonClass} href={src(item.id)} download><Download size={14} />Download</a>}</div>
          <button className={buttonClass} onClick={() => onOpen(item.thread_id)}><MessageSquare size={14} />Open chat</button>
        </li>)}</ul>}
    </div>)}

    {!loading && !error && items.length === 0 && <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nothing here for these filters.</p>}
    {items.length < total && <div className="flex justify-center"><button className={buttonClass} disabled={loading} onClick={() => setPage(p => p + 1)}>{loading ? 'Loading…' : 'Load more'}</button></div>}
    {viewer !== null && items[viewer] && <Viewer item={items[viewer]} agent={agent(items[viewer].channel_id)} hasPrev={viewer > 0} hasNext={viewer < items.length - 1}
      onPrev={() => setViewer(v => Math.max(0, (v ?? 0) - 1))} onNext={() => setViewer(v => Math.min(items.length - 1, (v ?? 0) + 1))} onClose={() => setViewer(null)} onOpen={() => onOpen(items[viewer].thread_id)} />}
  </section>
}

/** Photos load lazily with a loading shimmer; videos only load when opened (saving them uses storage). */
function Tile({ item, onClick }: { item: Item; onClick: () => void }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'broken'>('loading')
  const [attempt, setAttempt] = useState(0)
  const video = item.kind === 'video'
  // A photo not saved yet is fetched from Meta on first view, which can time
  // out when many load at once: try once more before calling it unavailable.
  const failed = () => {
    if (attempt === 0) { setTimeout(() => setAttempt(1), 1500); return }
    setState('broken')
  }
  return <button onClick={onClick} aria-label={`Open ${video ? 'video' : 'photo'} from ${item.customer_name || item.customer}`} className="group relative aspect-square overflow-hidden rounded-xl bg-muted">
    {video ? <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[var(--ink)] text-white/80"><Play size={28} className="fill-current" /><span className="text-xs">Video</span>{item.content && <span className="line-clamp-1 px-2 text-[11px] text-white/60">{item.content}</span>}</span>
      : state === 'broken' ? <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground"><ImageOff size={22} /><span className="px-2 text-center text-xs">No longer available</span></span>
        : <>
          {state === 'loading' && <span aria-hidden className="absolute inset-0 animate-pulse bg-muted-foreground/10" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={attempt} src={attempt ? `${src(item.id)}?retry=1` : src(item.id)} alt="" loading="lazy" decoding="async" onLoad={() => setState('loaded')} onError={failed}
            className={`h-full w-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-105 ${state === 'loaded' ? 'opacity-100' : 'opacity-0'}`} />
        </>}
  </button>
}

function Viewer({ item, agent, hasPrev, hasNext, onPrev, onNext, onClose, onOpen }: { item: Item; agent: string; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void; onOpen: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowLeft' && hasPrev) onPrev(); if (e.key === 'ArrowRight' && hasNext) onNext() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [hasPrev, hasNext, onPrev, onNext, onClose])
  return <div role="dialog" aria-modal="true" aria-label="Media viewer" className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <header className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{item.customer_name || `+${item.customer}`}</p><p className="text-xs text-white/60">{item.direction === 'inbound' ? 'From customer' : 'Sent by agent'} · {agent} · {new Date(item.sent_at).toLocaleString()}</p></div>
      <button className="rounded-lg px-3 py-2 text-sm hover:bg-white/10" onClick={onOpen}><MessageSquare size={16} className="mr-1 inline" />Open chat</button>
      <a className="rounded-lg px-3 py-2 text-sm hover:bg-white/10" href={src(item.id)} download aria-label="Download"><Download size={16} /></a>
      <button className="rounded-lg p-2 hover:bg-white/10" aria-label="Close" onClick={onClose}><X size={18} /></button>
    </header>
    <div className="relative flex min-h-0 flex-1 items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      {hasPrev && <button aria-label="Previous" className="absolute left-3 rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={onPrev}><ChevronLeft /></button>}
      {item.kind === 'video'
        ? <video key={item.id} src={src(item.id)} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" />
        // eslint-disable-next-line @next/next/no-img-element
        : <img key={item.id} src={src(item.id)} alt={item.content || 'Photo'} className="max-h-full max-w-full rounded-lg object-contain" />}
      {hasNext && <button aria-label="Next" className="absolute right-3 rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={onNext}><ChevronRight /></button>}
    </div>
    {item.content && <p className="mx-auto max-w-2xl p-4 text-center text-sm text-white/80">{item.content}</p>}
  </div>
}
