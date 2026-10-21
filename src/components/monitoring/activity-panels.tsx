'use client'

import { Fragment, useEffect, useState } from 'react'
import type { MonitoringChannel, MonitoringMessage } from '@/lib/monitoring/types'
import type { activityReport } from '@/lib/monitoring/activity-report'
import { formatDuration, type agentReport } from '@/lib/monitoring/agent-report'
import { MessageMedia } from './message-media'
import { csvCell } from '@/lib/monitoring/csv'

const input = 'min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm'
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40'
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

export function MessageBrowser({ channels, media = false, refresh, onOpen }: { channels: MonitoringChannel[]; media?: boolean; refresh: number; onOpen: (id: string) => void }) {
  const [filters, setFilters] = useState({ channel: '', direction: '', kind: '', q: '', from: '', to: '' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const params = new URLSearchParams({ ...filters, page: String(page), media: String(media) })
  const { data, error, loading } = useRemote<LogResult>(`/api/monitoring/messages?${params}`, refresh)
  const filter = (key: keyof typeof filters, value: string) => { setFilters(f => ({ ...f, [key]: value })); setPage(0) }
  const name = (id: string) => channels.find(c => c.id === id)?.label ?? 'Business number'
  return <section className="space-y-4" aria-busy={loading}>
    <p className="text-sm text-muted-foreground">{media ? 'Images, voice messages, videos, documents and stickers with a stored media reference. Older attachments may no longer be available from WhatsApp.' : 'Search the text of all stored messages, including imported history. Outgoing records do not by themselves confirm delivery.'}</p>
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-3">
      <form className="flex min-w-0 gap-2" onSubmit={e => { e.preventDefault(); filter('q', search) }}><input aria-label="Search message text" className={`${input} w-full`} placeholder="Search message text or caption" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} /><button className={button}>Search</button></form>
      <select aria-label="Filter business number" className={input} value={filters.channel} onChange={e => filter('channel', e.target.value)}><option value="">All business numbers</option>{channels.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      <select aria-label="Filter direction" className={input} value={filters.direction} onChange={e => filter('direction', e.target.value)}><option value="">Incoming and outgoing</option><option value="inbound">Incoming</option><option value="outbound">Outgoing</option></select>
      <select aria-label="Filter message format" className={input} value={filters.kind} onChange={e => filter('kind', e.target.value)}><option value="">All formats</option>{(media ? ['image', 'audio', 'video', 'document', 'sticker'] : ['text', 'image', 'audio', 'video', 'document', 'sticker', 'reaction', 'contacts', 'location', 'interactive', 'revoke', 'unsupported', 'media_placeholder']).map(k => <option key={k}>{k}</option>)}</select>
      <label className="text-xs text-muted-foreground">From (UTC)<input type="date" className={`${input} ml-2`} value={filters.from} onChange={e => filter('from', e.target.value)} /></label>
      <label className="text-xs text-muted-foreground">Through (UTC)<input type="date" className={`${input} ml-2`} value={filters.to} onChange={e => filter('to', e.target.value)} /></label>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{loading ? 'Loading…' : `${data?.total ?? 0} matching messages`}</p><button className={button} disabled={loading || !data?.messages.length} onClick={() => downloadCsv('wacrm-message-page.csv', [['Sent at (UTC)', 'Direction', 'Business number', 'Customer', 'Phone', 'Format', 'Message', 'Message ID'], ...(data?.messages ?? []).map(m => [m.sent_at, m.direction, name(m.channel_id), m.customer_name, m.customer, m.kind, m.content, m.meta_id])])}>Export this page (CSV)</button></div>
    <div className={media ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}>{data?.messages.map(m => <article key={m.id} className="min-w-0 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap justify-between gap-2"><button className="text-left font-semibold text-primary hover:underline" onClick={() => onOpen(m.thread_id)}>{m.customer_name || m.customer || 'Open conversation'}</button><span className="text-xs text-muted-foreground">{m.direction === 'inbound' ? 'Incoming' : 'Outgoing'} · {m.kind}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">{name(m.channel_id)} · {new Date(m.sent_at).toLocaleString()}</p>
      {m.content && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{m.content}</p>}
      {media && <MessageMedia message={m} />}
      {!media && !m.content && <p className="mt-3 text-sm text-muted-foreground">{m.media_id ? 'Attachment — open the conversation to view it.' : 'No message body or attachment was supplied.'}</p>}
    </article>)}</div>
    {!loading && !error && data?.messages.length === 0 && <p className="rounded-xl border border-border p-8 text-center text-muted-foreground">No messages match these filters.</p>}
    <nav aria-label="Message browser pages" className="flex items-center justify-between gap-2"><button className={button} disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span className="text-xs">Page {page + 1} of {Math.max(1, Math.ceil((data?.total ?? 0) / 50))}</span><button className={button} disabled={loading || !data || (page + 1) * 50 >= data.total} onClick={() => setPage(p => p + 1)}>Next</button></nav>
  </section>
}

export function ReportsPanel({ channels, refresh }: { channels: MonitoringChannel[]; refresh: number }) {
  const [days, setDays] = useState('30'), [channel, setChannel] = useState('')
  const { data, error } = useRemote<Report>(`/api/monitoring/reports?${new URLSearchParams({ days, channel })}`, refresh)
  const max = Math.max(1, ...(data?.daily.map(d => d.inbound + d.outbound) ?? []))
  return <section className="space-y-5">
    <div className="flex flex-wrap gap-3"><select aria-label="Report period" className={input} value={days} onChange={e => setDays(e.target.value)}>{[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}</select><select aria-label="Report business number" className={input} value={channel} onChange={e => setChannel(e.target.value)}><option value="">All business numbers</option>{channels.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select><button className={button} disabled={!data} onClick={() => downloadCsv('wacrm-daily-activity.csv', [['Date (UTC)', 'Incoming', 'Outgoing', 'Coverage'], ...(data?.daily ?? []).map(d => [d.date, d.inbound, d.outbound, data?.truncated ? 'Partial: latest 10000 records' : 'All stored records in period'])])}>Export daily activity</button></div>
    <p className="text-sm text-muted-foreground">Activity from messages stored in this CRM, grouped by their original message date in UTC. Imported history is included. Outgoing volume is not a delivery or read rate.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!data && !error && <p role="status">Loading activity…</p>}
    {data && <>
      {data.truncated && <p role="status" className="rounded-lg border border-amber-400 p-3 text-sm">Partial report: showing the latest {data.included.toLocaleString()} of {data.total.toLocaleString()} messages. Choose a shorter period or one business number for a complete report.</p>}
      <div className="grid gap-3 sm:grid-cols-3">{[['Incoming', data.inbound], ['Outgoing', data.outbound], ['Messages in selected period', data.total]].map(([label, count]) => <div key={label} className="rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">{label}{data.truncated && label !== 'Messages in selected period' ? ' (included records)' : ''}</p><p className="mt-2 text-3xl font-semibold">{Number(count).toLocaleString()}</p></div>)}</div>
      <AgentPerformance data={data} channels={channels} />
      <div className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">Daily message volume</h3><p className="mt-1 text-xs text-muted-foreground">Blue: incoming · Purple: outgoing</p><div className="mt-5 flex h-48 items-end gap-1" role="img" aria-label="Daily incoming and outgoing message counts; exact values are in the table below">{data.daily.map(d => <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.date}: ${d.inbound} incoming, ${d.outbound} outgoing`}><div className="bg-purple-400" style={{ height: `${d.outbound / max * 100}%` }} /><div className="bg-blue-500" style={{ height: `${d.inbound / max * 100}%` }} /></div>)}</div><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{data.daily[0]?.date}</span><span>{data.daily.at(-1)?.date}</span></div></div>
      <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-border bg-card p-5"><h3 className="mb-4 font-semibold">Business number activity</h3>{data.numbers.length === 0 && <p className="text-sm text-muted-foreground">No activity in this period.</p>}<ul className="space-y-3">{data.numbers.map(n => <li key={n.channel_id} className="flex flex-wrap justify-between gap-2 text-sm"><span>{channels.find(c => c.id === n.channel_id)?.label ?? 'Business number'}</span><span>{n.inbound} in · {n.outbound} out</span></li>)}</ul></div><div className="rounded-xl border border-border bg-card p-5"><h3 className="mb-4 font-semibold">Message formats</h3><ul className="space-y-2">{Object.entries(data.formats).sort((a, b) => b[1] - a[1]).map(([kind, count]) => <li key={kind} className="flex justify-between text-sm"><span>{kind}</span><span>{count}</span></li>)}</ul></div></div>
      <details className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold">Daily counts</summary><table className="mt-3 w-full text-left text-sm"><thead><tr><th>Date (UTC)</th><th>Incoming</th><th>Outgoing</th></tr></thead><tbody>{data.daily.map(d => <tr key={d.date}><td>{d.date}</td><td>{d.inbound}</td><td>{d.outbound}</td></tr>)}</tbody></table></details>
    </>}
  </section>
}

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function AgentPerformance({ data, channels }: { data: Report; channels: MonitoringChannel[] }) {
  const name = (id: string) => channels.find(c => c.id === id)?.label ?? 'Business number'
  const waiting = new Map(data.waiting.map(w => [w.channel_id, w]))
  const peak = Math.max(1, ...data.heatmap.flat())
  const ids = [...new Set([...data.agents.map(a => a.channel_id), ...data.waiting.map(w => w.channel_id)])]
  return <>
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-2 p-5 pb-3"><div><h3 className="font-semibold">Agent performance</h3><p className="mt-1 text-xs text-muted-foreground">Response time = time from a customer&apos;s first unanswered message to the agent&apos;s next reply, in this period.</p></div>
        <button className={button} onClick={() => downloadCsv('wacrm-agent-performance.csv', [['Agent', 'Conversations', 'Received', 'Sent', 'Customer messages answered', 'Unanswered in period', 'Waiting now', 'Median response (s)', 'Average response (s)', 'Answered within 5 min', 'Answered within 1 hour'], ...ids.map(id => { const a = data.agents.find(x => x.channel_id === id); return [name(id), a?.conversations ?? 0, a?.inbound ?? 0, a?.outbound ?? 0, a?.answered ?? 0, a?.unanswered ?? 0, waiting.get(id)?.count ?? 0, a?.median_response_seconds ?? '', a?.average_response_seconds ?? '', a?.within_5_min ?? 0, a?.within_1_hour ?? 0] })])}>Export</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-y border-border bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-5 py-2 font-medium">Agent</th><th className="px-3 py-2 font-medium">Waiting now</th><th className="px-3 py-2 font-medium">Median response</th><th className="px-3 py-2 font-medium">Average</th><th className="px-3 py-2 font-medium">Within 5 min</th><th className="px-3 py-2 font-medium">Within 1 hour</th><th className="px-3 py-2 font-medium">Unanswered</th><th className="px-3 py-2 font-medium">Chats</th><th className="px-3 py-2 font-medium">In / Out</th></tr></thead>
        <tbody className="divide-y divide-border">{ids.map(id => { const a = data.agents.find(x => x.channel_id === id); const w = waiting.get(id); const pct = (n = 0) => a?.answered ? `${Math.round(n / a.answered * 100)}%` : '—'
          return <tr key={id}><td className="px-5 py-3 font-medium">{name(id)}</td>
            <td className="px-3 py-3">{w ? <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-red-700" title={`Oldest since ${new Date(w.oldest).toLocaleString()}`}>{w.count}</span> : <span className="text-muted-foreground">0</span>}</td>
            <td className={`px-3 py-3 font-semibold ${(a?.median_response_seconds ?? 0) > 3600 ? 'text-red-600' : (a?.median_response_seconds ?? 0) > 900 ? 'text-amber-600' : 'text-emerald-700'}`}>{formatDuration(a?.median_response_seconds ?? null)}</td>
            <td className="px-3 py-3">{formatDuration(a?.average_response_seconds ?? null)}</td><td className="px-3 py-3">{pct(a?.within_5_min)}</td><td className="px-3 py-3">{pct(a?.within_1_hour)}</td>
            <td className="px-3 py-3">{a?.unanswered ?? 0}</td><td className="px-3 py-3">{a?.conversations ?? 0}</td><td className="px-3 py-3 text-muted-foreground">{a?.inbound ?? 0} / {a?.outbound ?? 0}</td></tr> })}
          {ids.length === 0 && <tr><td colSpan={9} className="px-5 py-4 text-sm text-muted-foreground">No agent activity in this period.</td></tr>}</tbody>
      </table></div>
    </div>
    <div className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">When customers message</h3><p className="mt-1 text-xs text-muted-foreground">Incoming customer messages by day and hour, Pakistan time. Darker = busier.</p>
      <div className="mt-4 overflow-x-auto"><div className="grid min-w-[640px] grid-cols-[40px_repeat(24,minmax(0,1fr))] gap-0.5 text-[10px] text-muted-foreground">
        <span />{Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? h : ''}</span>)}
        {data.heatmap.map((row, d) => <Fragment key={d}><span className="pr-1 text-right leading-5">{days[d]}</span>{row.map((count, h) => <span key={`${d}-${h}`} title={`${days[d]} ${h}:00 — ${count} messages`} className="h-5 rounded-sm" style={{ backgroundColor: count ? `rgba(31, 111, 235, ${0.12 + 0.88 * count / peak})` : 'var(--muted)' }} />)}</Fragment>)}
      </div></div>
    </div>
  </>
}
