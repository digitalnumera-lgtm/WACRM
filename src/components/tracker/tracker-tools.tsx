'use client'

import { useState } from 'react'
import { Activity, Trash2 } from 'lucide-react'
import type { TrackerView } from '@/lib/tracker/model'
import { buttonClass, Icon3D, inputClass } from '@/components/monitoring/ui'
import { Busy, change, DealActions, type Changed } from './tracker-edit'

type Line = { kind: 'ISSUE' | 'CHECK' | 'OK' | 'TEXT'; text: string }
const tone = { ISSUE: 'text-red-600 dark:text-red-400', CHECK: 'text-amber-700 dark:text-amber-400', OK: 'text-emerald-700 dark:text-emerald-400', TEXT: '' }

/** The Sheet's Tools tab: health check and delete a deal. */
export function TrackerTools({ data, onChanged }: { data: TrackerView; onChanged: Changed }) {
  const [lines, setLines] = useState<Line[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [pick, setPick] = useState('')
  const deal = data.deals.find(d => d.id === pick)
  const check = async () => {
    setBusy('Checking the Sheet, forms, ClickUp and Drive… up to two minutes.'); setError(''); setLines(null)
    try {
      const res = await change('healthCheck', {})
      if (res.view) onChanged(res.view, res.result)
      const raw = ((res.result?.lines as string[] | undefined) ?? [])
      setLines(raw.map(t => { const m = /^(ISSUE|CHECK|OK):\s*(.*)$/.exec(t); return m ? { kind: m[1] as Line['kind'], text: m[2] } : { kind: 'TEXT', text: t } }))
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  const count = (k: Line['kind']) => lines?.filter(l => l.kind === k).length ?? 0
  return <div className="grid gap-5 xl:grid-cols-2">
    <section className="crm-card space-y-4 p-5">
      <div className="flex items-center gap-3"><Icon3D name="search" size={36} /><h2 className="font-semibold">Health check</h2></div>
      <button className={buttonClass} disabled={!!busy} onClick={() => void check()}><Activity size={14} />Run health check</button>
      <Busy busy={busy} error={error} />
      {lines && <div className="space-y-2">
        <p className="text-sm font-medium">{count('ISSUE')} to fix · {count('CHECK')} to look at · {count('OK')} fine</p>
        <ul className="max-h-[28rem] space-y-1 overflow-y-auto text-sm">{[...lines].sort((a, b) => ['ISSUE', 'CHECK', 'TEXT', 'OK'].indexOf(a.kind) - ['ISSUE', 'CHECK', 'TEXT', 'OK'].indexOf(b.kind)).map((l, i) =>
          <li key={i} className="flex gap-2"><span className={`w-14 shrink-0 text-xs font-semibold ${tone[l.kind]}`}>{l.kind === 'TEXT' ? '' : l.kind}</span><span>{l.text}</span></li>)}</ul>
      </div>}
    </section>
    <section className="crm-card space-y-4 p-5">
      <div className="flex items-center gap-3"><Icon3D name="wrench" size={36} /><h2 className="font-semibold">Change or delete a deal</h2></div>
      <select className={inputClass} value={pick} onChange={e => setPick(e.target.value)} aria-label="Deal">
        <option value="">Pick a deal…</option>{data.deals.map(d => <option key={d.id} value={d.id}>{d.id} · {d.brand || d.client} · {d.agent}</option>)}
      </select>
      {deal ? <DealActions deal={deal} onChanged={onChanged} /> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Trash2 size={14} />Pick a deal to edit, approve, change status, add a payment or delete it.</p>}
    </section>
  </div>
}
