'use client'

import { useCallback, useEffect, useState } from 'react'
import { leadStatuses, type MonitoringChannel, type MonitoringThread } from '@/lib/monitoring/types'
import { useCan } from './access'
import { PreviewIcon, previewText } from './inbox-list'
import { api, Avatar, PriorityIcon, sendJson, timeAgo } from './ui'

type Stage = typeof leadStatuses[number]
type Column = { threads: MonitoringThread[]; total: number }
const accents: Record<Stage, string> = { new: 'bg-slate-400', contacted: 'bg-sky-500', qualified: 'bg-amber-500', won: 'bg-emerald-500', lost: 'bg-rose-500' }

/** Kanban of conversations by lead stage; drag a card to change its stage. */
export function LeadsBoard({ channels, refresh, onOpen }: { channels: MonitoringChannel[]; refresh: number; onOpen: (id: string) => void }) {
  const canMove = useCan('edit_lead_stage')
  const [channel, setChannel] = useState('')
  const [columns, setColumns] = useState<Partial<Record<Stage, Column>>>({})
  const [error, setError] = useState('')
  const [over, setOver] = useState<Stage | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(leadStatuses.map(stage => api<{ threads: MonitoringThread[]; total: number | null }>(`/api/monitoring?scroll=1&tab=all&status=${stage}${channel ? `&channel=${channel}` : ''}`, { signal: controller.signal })
      .then(d => [stage, { threads: d.threads, total: d.total ?? d.threads.length }] as const)))
      .then(rows => { setColumns(Object.fromEntries(rows)); setError('') })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [channel, refresh])

  const move = useCallback(async (id: string, to: Stage) => {
    const from = leadStatuses.find(s => columns[s]?.threads.some(t => t.id === id))
    if (!from || from === to) return
    const thread = columns[from]!.threads.find(t => t.id === id)!
    const shift = (state: typeof columns, a: Stage, b: Stage, item: MonitoringThread) => ({ ...state,
      [a]: { threads: state[a]!.threads.filter(t => t.id !== id), total: state[a]!.total - 1 },
      [b]: { threads: [{ ...item, lead_status: b }, ...(state[b]?.threads ?? [])], total: (state[b]?.total ?? 0) + 1 } })
    setColumns(state => shift(state, from, to, thread))
    try { await api(`/api/monitoring/threads/${id}`, sendJson('PATCH', { lead_status: to })) }
    catch (e) { setError((e as Error).message); setColumns(state => shift(state, to, from, thread)) }
  }, [columns])

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      {[{ id: '', label: 'All agents' }, ...channels.map(c => ({ id: c.id, label: c.label }))].map(c => <button key={c.id} onClick={() => setChannel(c.id)}
        className={`rounded-full px-3 py-1.5 text-sm font-medium ${channel === c.id ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground shadow-sm hover:text-foreground'}`}>{c.label}</button>)}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:px-0">
      {leadStatuses.map(stage => { const col = columns[stage]; return <section key={stage} aria-label={`${stage} leads`}
        onDragOver={e => { if (canMove) { e.preventDefault(); setOver(stage) } }} onDragLeave={() => setOver(o => o === stage ? null : o)}
        onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) void move(id, stage) }}
        className={`flex w-72 shrink-0 snap-start flex-col rounded-3xl p-2 transition-colors lg:w-auto ${over === stage ? 'bg-primary/10' : 'bg-card/60'}`}>
        <header className="flex items-center justify-between px-2 py-2"><h3 className="flex items-center gap-2 text-sm font-semibold capitalize"><span className={`size-2 rounded-full ${accents[stage]}`} />{stage}</h3><span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold shadow-sm">{col?.total ?? '…'}</span></header>
        <ul className="space-y-2">{col?.threads.map(t => { const name = t.customer_name || `+${t.customer}`; return <li key={t.id} draggable={canMove} onDragStart={e => e.dataTransfer.setData('text/plain', t.id)}>
          <button onClick={() => onOpen(t.id)} className="w-full rounded-2xl border border-border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center gap-2"><Avatar name={name} seed={t.customer} size="sm" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span><PriorityIcon priority={t.priority} /></div>
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground"><PreviewIcon preview={t.last_preview} />{previewText(t.last_preview) || 'Media message'}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span className="truncate">{channels.find(c => c.id === t.channel_id)?.label}</span><span>{timeAgo(t.last_message_at)}</span></div>
          </button></li> })}
          {col && !col.threads.length && <li className="rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No leads</li>}
          {col && col.total > col.threads.length && <li className="px-2 text-center text-xs text-muted-foreground">Showing latest {col.threads.length} of {col.total}</li>}
        </ul>
      </section> })}
    </div>
  </div>
}
