'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, CheckCheck, Clock, Inbox, MailWarning, MessageCircle, Reply, Users } from 'lucide-react'
import type { MonitoringChannel } from '@/lib/monitoring/types'
import type { InboxTab } from './inbox-list'
import { api, waitingFor } from './ui'

type Overview = {
  days: number; workflowReady: boolean
  counts: { unread: number; open: number; resolved: number; waiting: number } | null
  waiting: Record<string, { count: number; oldest: string }>
  volume: { inbound: [number, number]; outbound: [number, number] }
  activeConversations: number
}
const periods = [{ days: 1, label: 'Today' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }]

function Delta({ now, before }: { now: number; before: number }) {
  if (!before && !now) return null
  const change = before ? Math.round(((now - before) / before) * 100) : 100
  const up = change >= 0
  return <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${up ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>
    {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(change)}%</span>
}

function Kpi({ label, value, icon: Icon, children, dark }: { label: string; value: number | undefined; icon: typeof Inbox; children?: ReactNode; dark?: boolean }) {
  return <div className={`rounded-3xl p-5 ${dark ? 'bg-[#121316] text-white dark:bg-[#C0DD11] dark:text-[#121316]' : 'crm-card'}`}>
    <div className="flex items-center justify-between"><span className={`flex size-9 items-center justify-center rounded-full ${dark ? 'bg-white/10 dark:bg-black/10' : 'bg-muted'}`}><Icon size={17} /></span>{children}</div>
    <p className={`mt-5 text-sm ${dark ? 'opacity-70' : 'text-muted-foreground'}`}>{label}</p>
    <p className="font-display mt-1 text-4xl font-semibold tracking-tight">{value === undefined ? '—' : value.toLocaleString()}</p>
  </div>
}

export function Dashboard({ refresh, channels, onTab, onChannel }: { refresh: number; channels: MonitoringChannel[]; onTab: (tab: InboxTab) => void; onChannel: (id: string) => void }) {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api<Overview>(`/api/monitoring/overview?days=${days}`, { signal: controller.signal }).then(d => { setData(d); setError('') }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [days, refresh])
  const counts = data?.counts
  const period = periods.find(p => p.days === days)!.label.toLowerCase()
  const attention: { tab: InboxTab; label: string; value?: number; icon: typeof Inbox; tone: string }[] = [
    { tab: 'waiting', label: 'Waiting for reply', value: counts?.waiting, icon: Clock, tone: 'text-red-600 dark:text-red-400' },
    { tab: 'unread', label: 'Unread', value: counts?.unread, icon: MailWarning, tone: '' },
    { tab: 'open', label: 'Open', value: counts?.open, icon: Inbox, tone: '' },
    { tab: 'resolved', label: 'Done', value: counts?.resolved, icon: CheckCheck, tone: 'text-emerald-600 dark:text-emerald-400' },
  ]
  return <div className="space-y-5">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div role="radiogroup" aria-label="Period" className="inline-flex gap-1 rounded-full bg-card p-1 shadow-sm">
      {periods.map(p => <button key={p.days} role="radio" aria-checked={days === p.days} onClick={() => setDays(p.days)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${days === p.days ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{p.label}</button>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi dark label="Waiting for an agent now" value={counts?.waiting} icon={Clock} />
      <Kpi label={`Messages received · ${period}`} value={data?.volume.inbound[0]} icon={MessageCircle}>{data && <Delta now={data.volume.inbound[0]} before={data.volume.inbound[1]} />}</Kpi>
      <Kpi label={`Agent replies · ${period}`} value={data?.volume.outbound[0]} icon={Reply}>{data && <Delta now={data.volume.outbound[0]} before={data.volume.outbound[1]} />}</Kpi>
      <Kpi label={`Active conversations · ${period}`} value={data?.activeConversations} icon={Users} />
    </div>
    <section className="crm-card p-5">
      <h2 className="font-display text-lg font-semibold">Needs attention</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{attention.map(a => <button key={a.tab} onClick={() => onTab(a.tab)} className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3 text-left hover:bg-muted">
        <a.icon size={18} className={a.tone || 'text-muted-foreground'} /><span className="flex-1 text-sm">{a.label}</span><span className={`text-lg font-semibold ${a.tone}`}>{a.value?.toLocaleString() ?? '—'}</span></button>)}</div>
      {data && !data.workflowReady && <p className="mt-2 text-xs text-muted-foreground">Status counts need the inbox database update.</p>}
    </section>
    <section>
      <h2 className="font-display mb-3 text-lg font-semibold">Agents</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{channels.map(channel => { const w = data?.waiting[channel.id]; return <button key={channel.id} onClick={() => onChannel(channel.id)} className="crm-card p-5 text-left transition-shadow hover:shadow-md">
        <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-full bg-[#121316] text-sm font-bold text-[#C0DD11]">{channel.label.slice(0, 2).toUpperCase()}</span>
          <div className="min-w-0 flex-1"><p className="truncate font-semibold">{channel.label}</p><p className="truncate text-xs text-muted-foreground">{channel.display_number}</p></div></div>
        <div className="mt-4 flex items-end justify-between">
          <div><p className="text-xs text-muted-foreground">Waiting</p><p className={`text-2xl font-semibold ${w?.count ? 'text-red-600 dark:text-red-400' : ''}`}>{w?.count ?? 0}</p></div>
          <p className="text-right text-xs text-muted-foreground">{w ? `Longest ${waitingFor(w.oldest)}` : 'Nobody waiting'}<br />Last activity {channel.last_event_at ? new Date(channel.last_event_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}</p>
        </div>
      </button> })}</div>
    </section>
  </div>
}
