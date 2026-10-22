'use client'

import { Fragment, useEffect, useState } from 'react'
import type { MonitoringChannel, MonitoringMessage } from '@/lib/monitoring/types'
import type { activityReport } from '@/lib/monitoring/activity-report'
import { formatDuration, type agentReport } from '@/lib/monitoring/agent-report'
import { useCan } from './access'
import { csvCell } from '@/lib/monitoring/csv'

const input = 'min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm'
const button = 'rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40'
type LogMessage = MonitoringMessage & { thread_id: string; channel_id: string; customer: string; customer_name: string | null }
type LogResult = { messages: LogMessage[]; total: number }
type Report = ReturnType<typeof activityReport> & ReturnType<typeof agentReport> & { total: number; included: number; truncated: boolean; timezone: string; waiting: { channel_id: string; count: number; oldest: string }[] }

function downloadCsv(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob(['\ufeff', rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function useRemote<T>(url: string, refresh: number) {
  const key = `${url}#${refresh}`
  const [result, setResult] = useState<{ key: string; data: T | null; error: string }>({ key: '', data: null, error: '' })
  useEffect(() => {
    const abort = new AbortController()
    fetch(url, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to load data')
      if (!abort.signal.aborted) setResult({ key, data: body, error: '' })
    }).catch(err => { if (!abort.signal.aborted) setResult({ key, data: null, error: err.message }) })
    return () => abort.abort()
  }, [url, key])
  return result.key === key ? { ...result, loading: false } : { data: null, error: '', loading: true }
}

export function MessageBrowser({ channels, refresh, onOpen }: { channels: MonitoringChannel[]; refresh: number; onOpen: (id: string) => void }) {
  const canExport = useCan('export_data')
  const [filters, setFilters] = useState({ channel: '', direction: '', kind: '', q: '', from: '', to: '' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const params = new URLSearchParams({ ...filters, page: String(page) })
  const { data, error, loading } = useRemote<LogResult>(`/api/monitoring/messages?${params}`, refresh)
  const filter = (key: keyof typeof filters, value: string) => { setFilters(f => ({ ...f, [key]: value })); setPage(0) }
  const name = (id: string) => channels.find(c => c.id === id)?.label ?? 'Business number'
  return <section className="space-y-4" aria-busy={loading}>
    <div className="grid gap-3 crm-card p-6 sm:grid-cols-2 xl:grid-cols-3">
      <form className="flex min-w-0 gap-2" onSubmit={e => { e.preventDefault(); filter('q', search) }}><input aria-label="Search message text" className={`${input} w-full`} placeholder="Search message text or caption" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} /><button className={button}>Search</button></form>
      <select aria-label="Filter business number" className={input} value={filters.channel} onChange={e => filter('channel', e.target.value)}><option value="">All business numbers</option>{channels.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      <select aria-label="Filter direction" className={input} value={filters.direction} onChange={e => filter('direction', e.target.value)}><option value="">Incoming and outgoing</option><option value="inbound">Incoming</option><option value="outbound">Outgoing</option></select>
      <select aria-label="Filter message format" className={input} value={filters.kind} onChange={e => filter('kind', e.target.value)}><option value="">All formats</option>{['text', 'image', 'audio', 'video', 'document', 'sticker', 'reaction', 'contacts', 'location', 'interactive', 'revoke', 'unsupported', 'media_placeholder'].map(k => <option key={k}>{k}</option>)}</select>
      <label className="text-xs text-muted-foreground">From (UTC)<input type="date" className={`${input} ml-2`} value={filters.from} onChange={e => filter('from', e.target.value)} /></label>
      <label className="text-xs text-muted-foreground">Through (UTC)<input type="date" className={`${input} ml-2`} value={filters.to} onChange={e => filter('to', e.target.value)} /></label>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{loading ? 'Loading…' : `${data?.total ?? 0} matching messages`}</p>{canExport && <button className={button} disabled={loading || !data?.messages.length} onClick={() => downloadCsv('wacrm-message-page.csv', [['Sent at (UTC)', 'Direction', 'Business number', 'Customer', 'Phone', 'Format', 'Message', 'Message ID'], ...(data?.messages ?? []).map(m => [m.sent_at, m.direction, name(m.channel_id), m.customer_name, m.customer, m.kind, m.content, m.meta_id])])}>Export this page (CSV)</button>}</div>
    <div className="space-y-3">{data?.messages.map(m => <article key={m.id} className="crm-card min-w-0 p-4">
      <div className="flex flex-wrap justify-between gap-2"><button className="text-left font-semibold text-primary hover:underline" onClick={() => onOpen(m.thread_id)}>{m.customer_name || m.customer || 'Open conversation'}</button><span className="text-xs text-muted-foreground">{m.direction === 'inbound' ? 'Incoming' : 'Outgoing'} · {m.kind}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">{name(m.channel_id)} · {new Date(m.sent_at).toLocaleString()}</p>
      {m.content && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{m.content}</p>}
      {!m.content && <p className="mt-3 text-sm text-muted-foreground">{m.media_id ? 'Attachment — open the conversation to view it.' : 'No message body or attachment was supplied.'}</p>}
    </article>)}</div>
    {!loading && !error && data?.messages.length === 0 && <p className="rounded-xl border border-border p-8 text-center text-muted-foreground">No messages match these filters.</p>}
    <nav aria-label="Message browser pages" className="flex items-center justify-between gap-2"><button className={button} disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span className="text-xs">Page {page + 1} of {Math.max(1, Math.ceil((data?.total ?? 0) / 50))}</span><button className={button} disabled={loading || !data || (page + 1) * 50 >= data.total} onClick={() => setPage(p => p + 1)}>Next</button></nav>
  </section>
}

const formatNames: Record<string, string> = { text: 'Text', audio: 'Voice notes', image: 'Photos', video: 'Videos', document: 'Documents', sticker: 'Stickers', reaction: 'Reactions', media_placeholder: 'Media from history', location: 'Locations', contacts: 'Contact cards', interactive: 'Buttons & lists', revoke: 'Deleted', unsupported: 'Other' }
const niceMax = (n: number) => { if (n <= 5) return 5; const p = 10 ** Math.floor(Math.log10(n)); return Math.ceil(n / p) * p }
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

function Legend() {
  return <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
    <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--series-in)]" />Received</span>
    <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--series-out)]" />Agent replies</span>
  </div>
}

/** Daily received vs agent replies: paired bars, hover for exact values. */
function DailyChart({ daily }: { daily: { date: string; inbound: number; outbound: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const top = niceMax(Math.max(0, ...daily.flatMap(d => [d.inbound, d.outbound])))
  const tip = hover !== null ? daily[hover] : null
  return <div className="crm-card p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="font-display text-lg font-semibold">Messages per day</h3><Legend /></div>
    <div className="relative mt-6 h-56 pl-10">
      {[1, 0.5, 0].map(f => <div key={f} className="absolute inset-x-0 border-t border-border/70 pl-10" style={{ bottom: `${f * 100}%` }}><span className="absolute -top-2 left-0 w-8 text-right text-[10px] tabular-nums text-muted-foreground">{Math.round(top * f).toLocaleString()}</span></div>)}
      <div className="relative flex h-full items-end" role="img" aria-label="Received and agent replies per day; exact values are in the daily table below" onMouseLeave={() => setHover(null)}>
        {daily.map((d, i) => <div key={d.date} className={`flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] px-[1px] ${hover === i ? 'bg-muted/70' : ''}`} onMouseEnter={() => setHover(i)}>
          <span className="w-full max-w-3 rounded-t-[4px] bg-[var(--series-in)]" style={{ height: `${(d.inbound / top) * 100}%`, minHeight: d.inbound ? 2 : 0 }} />
          <span className="w-full max-w-3 rounded-t-[4px] bg-[var(--series-out)]" style={{ height: `${(d.outbound / top) * 100}%`, minHeight: d.outbound ? 2 : 0 }} />
        </div>)}
        {tip && <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg" style={{ left: `${((hover! + 0.5) / daily.length) * 100}%` }}>
          <p className="font-semibold">{shortDate(tip.date)}</p><p className="text-muted-foreground">Received <b className="text-foreground">{tip.inbound.toLocaleString()}</b></p><p className="text-muted-foreground">Agent replies <b className="text-foreground">{tip.outbound.toLocaleString()}</b></p>
        </div>}
      </div>
    </div>
    <div className="mt-2 flex justify-between pl-10 text-[11px] text-muted-foreground"><span>{daily[0] && shortDate(daily[0].date)}</span><span>{daily.at(-1) && shortDate(daily.at(-1)!.date)}</span></div>
  </div>
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const top = Math.max(1, ...rows.map(r => r.value))
  return <ul className="space-y-2.5">{rows.map(r => <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
    <span className="truncate text-muted-foreground">{r.label}</span>
    <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground/80" style={{ width: `${(r.value / top) * 100}%` }} /></span>
    <span className="text-right tabular-nums">{r.value.toLocaleString()}</span>
  </li>)}</ul>
}

export function ReportsPanel({ channels, refresh }: { channels: MonitoringChannel[]; refresh: number }) {
  const canExport = useCan('export_data')
  const [days, setDays] = useState('30'), [channel, setChannel] = useState('')
  const { data, error } = useRemote<Report>(`/api/monitoring/reports?${new URLSearchParams({ days, channel })}`, refresh)
  const name = (id: string) => channels.find(c => c.id === id)?.label ?? 'Business number'
  return <section className="reports space-y-5">
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Report period" className="inline-flex gap-1 rounded-full bg-card p-1 shadow-sm">{['7', '30', '90'].map(d => <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{d} days</button>)}</div>
      <select aria-label="Agent" className={input} value={channel} onChange={e => setChannel(e.target.value)}><option value="">All agents</option>{channels.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      {canExport && <button className={`${button} ml-auto`} disabled={!data} onClick={() => downloadCsv('wacrm-daily-activity.csv', [['Date (UTC)', 'Received', 'Agent replies'], ...(data?.daily ?? []).map(d => [d.date, d.inbound, d.outbound])])}>Export CSV</button>}
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!data && !error && <div className="crm-card h-56 animate-pulse" />}
    {data && <>
      {data.truncated && <p role="status" className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Showing the latest {data.included.toLocaleString()} of {data.total.toLocaleString()} messages. Pick fewer days or one agent for complete numbers.</p>}
      <div className="grid gap-3 sm:grid-cols-3">{([['Received', data.inbound, 'var(--series-in)'], ['Agent replies', data.outbound, 'var(--series-out)'], ['All messages', data.total, '']] as const).map(([label, count, color]) => <div key={label} className="crm-card p-5">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">{color && <span className="size-2.5 rounded-sm" style={{ background: color }} />}{label}</p><p className="font-display mt-2 text-4xl font-semibold tracking-tight">{Number(count).toLocaleString()}</p></div>)}</div>
      <DailyChart daily={data.daily} />
      <AgentPerformance data={data} channels={channels} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="crm-card p-6"><h3 className="font-display mb-4 text-lg font-semibold">Messages by agent</h3>{data.numbers.length ? <Bars rows={data.numbers.map(n => ({ label: name(n.channel_id), value: n.inbound + n.outbound })).sort((a, b) => b.value - a.value)} /> : <p className="text-sm text-muted-foreground">No messages in this period.</p>}</div>
        <div className="crm-card p-6"><h3 className="font-display mb-4 text-lg font-semibold">Message types</h3><Bars rows={Object.entries(data.formats).map(([kind, value]) => ({ label: formatNames[kind] ?? kind, value })).sort((a, b) => b.value - a.value).slice(0, 8)} /></div>
      </div>
      <details className="crm-card p-6"><summary className="cursor-pointer text-sm font-semibold">Daily table</summary><table className="mt-3 w-full text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-1 font-medium">Date (UTC)</th><th className="py-1 font-medium">Received</th><th className="py-1 font-medium">Agent replies</th></tr></thead><tbody className="tabular-nums">{data.daily.map(d => <tr key={d.date} className="border-t border-border"><td className="py-1.5">{d.date}</td><td>{d.inbound}</td><td>{d.outbound}</td></tr>)}</tbody></table></details>
    </>}
  </section>
}

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function AgentPerformance({ data, channels }: { data: Report; channels: MonitoringChannel[] }) {
  const canExport = useCan('export_data')
  const name = (id: string) => channels.find(c => c.id === id)?.label ?? 'Business number'
  const waiting = new Map(data.waiting.map(w => [w.channel_id, w]))
  const peak = Math.max(1, ...data.heatmap.flat())
  const ids = [...new Set([...data.agents.map(a => a.channel_id), ...data.waiting.map(w => w.channel_id)])]
  return <>
    <div className="crm-card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-2 p-6 pb-3"><div><h3 className="font-display text-lg font-semibold">Agent performance</h3><p className="mt-1 text-xs text-muted-foreground">Response time: from a customer’s first unanswered message to the agent’s next reply.</p></div>
        {canExport && <button className={button} onClick={() => downloadCsv('wacrm-agent-performance.csv', [['Agent', 'Conversations', 'Received', 'Sent', 'Customer messages answered', 'Unanswered in period', 'Waiting now', 'Median response (s)', 'Average response (s)', 'Answered within 5 min', 'Answered within 1 hour'], ...ids.map(id => { const a = data.agents.find(x => x.channel_id === id); return [name(id), a?.conversations ?? 0, a?.inbound ?? 0, a?.outbound ?? 0, a?.answered ?? 0, a?.unanswered ?? 0, waiting.get(id)?.count ?? 0, a?.median_response_seconds ?? '', a?.average_response_seconds ?? '', a?.within_5_min ?? 0, a?.within_1_hour ?? 0] })])}>Export</button>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-y border-border bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-5 py-2 font-medium">Agent</th><th className="px-3 py-2 font-medium">Waiting now</th><th className="px-3 py-2 font-medium">Median response</th><th className="px-3 py-2 font-medium">Average</th><th className="px-3 py-2 font-medium">Within 5 min</th><th className="px-3 py-2 font-medium">Within 1 hour</th><th className="px-3 py-2 font-medium">Unanswered</th><th className="px-3 py-2 font-medium">Chats</th><th className="px-3 py-2 font-medium">In / Out</th></tr></thead>
        <tbody className="divide-y divide-border">{ids.map(id => { const a = data.agents.find(x => x.channel_id === id); const w = waiting.get(id); const pct = (n = 0) => a?.answered ? `${Math.round(n / a.answered * 100)}%` : '—'
          return <tr key={id}><td className="px-5 py-3 font-medium">{name(id)}</td>
            <td className="px-3 py-3">{w ? <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300" title={`Oldest since ${new Date(w.oldest).toLocaleString()}`}>{w.count}</span> : <span className="text-muted-foreground">0</span>}</td>
            <td className={`px-3 py-3 font-semibold ${(a?.median_response_seconds ?? 0) > 3600 ? 'text-red-600 dark:text-red-400' : (a?.median_response_seconds ?? 0) > 900 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatDuration(a?.median_response_seconds ?? null)}</td>
            <td className="px-3 py-3">{formatDuration(a?.average_response_seconds ?? null)}</td><td className="px-3 py-3">{pct(a?.within_5_min)}</td><td className="px-3 py-3">{pct(a?.within_1_hour)}</td>
            <td className="px-3 py-3">{a?.unanswered ?? 0}</td><td className="px-3 py-3">{a?.conversations ?? 0}</td><td className="px-3 py-3 text-muted-foreground">{a?.inbound ?? 0} / {a?.outbound ?? 0}</td></tr> })}
          {ids.length === 0 && <tr><td colSpan={9} className="px-5 py-4 text-sm text-muted-foreground">No agent activity in this period.</td></tr>}</tbody>
      </table></div>
    </div>
    <div className="crm-card p-6"><h3 className="font-display text-lg font-semibold">When customers message</h3><p className="mt-1 text-xs text-muted-foreground">By day and hour, Pakistan time. Darker means busier.</p>
      <div className="mt-4 overflow-x-auto"><div className="grid min-w-[640px] grid-cols-[40px_repeat(24,minmax(0,1fr))] gap-0.5 text-[10px] text-muted-foreground">
        <span />{Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? h : ''}</span>)}
        {data.heatmap.map((row, d) => <Fragment key={d}><span className="pr-1 text-right leading-5">{days[d]}</span>{row.map((count, h) => <span key={`${d}-${h}`} title={`${days[d]} ${h}:00 — ${count} messages`} className="h-5 rounded-sm" style={{ backgroundColor: count ? `color-mix(in oklab, var(--series-in) ${Math.round(15 + 85 * count / peak)}%, transparent)` : 'var(--muted)' }} />)}</Fragment>)}
      </div></div>
    </div>
  </>
}
