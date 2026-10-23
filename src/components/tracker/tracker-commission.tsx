'use client'

import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { commissionPeople, commissionStatement, type StatementRow } from '@/lib/tracker/commission'
import type { CommissionDefaults, Payout, TrackerView } from '@/lib/tracker/model'
import { buttonClass, inputClass, primaryButton } from '@/components/monitoring/ui'
import { Busy, Modal, useSubmit, type Changed } from './tracker-edit'

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`
const today = () => new Date().toISOString().slice(0, 10)
const longDate = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const prevDay = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
const label = 'block space-y-1 text-sm'

/** Commission owed up to a date, what was paid, and what is left (over- or under-payments carry forward). */
export function CommissionStatement({ data, canEdit, onChanged }: { data: TrackerView; canEdit: boolean; onChanged: Changed }) {
  const [upTo, setUpTo] = useState(today())
  const [includeDay, setIncludeDay] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [paying, setPaying] = useState<StatementRow | null>(null)
  const c = data.commission
  const rows = useMemo(() => c?.defaults ? commissionStatement({ deals: data.deals, payments: data.payments ?? [], defaults: c.defaults, rates: c.rates, payouts: c.payouts, upTo, includeDay }) : [], [c, data.deals, data.payments, upTo, includeDay])
  if (!c?.defaults) return <p className="crm-card p-6 text-sm text-muted-foreground">Update the connection script to version 3 (Clients → Settings) to see commission statements.</p>
  const total = (k: 'earned' | 'paid' | 'due') => rows.reduce((s, r) => s + r[k], 0)
  return <div className="space-y-4">
    <div className="crm-card flex flex-wrap items-end gap-4 p-4">
      <label className={label}>Statement date<input type="date" className={`${inputClass} w-auto`} value={upTo} onChange={e => setUpTo(e.target.value || today())} /></label>
      <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm"><input type="checkbox" className="size-4" checked={includeDay} onChange={e => setIncludeDay(e.target.checked)} />Count {longDate(upTo)} too</label>
      <p className="pb-2 text-sm text-muted-foreground">Deals fully paid up to {longDate(includeDay ? upTo : prevDay(upTo))}</p>
    </div>
    <div className="crm-card overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Person</th><th className="px-3 py-3 font-medium">Rate</th><th className="px-3 py-3 text-right font-medium">Earned</th><th className="px-3 py-3 text-right font-medium">Paid</th><th className="px-3 py-3 text-right font-medium">To pay</th>{canEdit && <th className="px-4 py-3" />}</tr></thead>
      <tbody>{rows.map(r => { const key = `${r.role}|${r.person}`; const isOpen = open === key; return <Fragment key={key}>
        <tr className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => setOpen(isOpen ? null : key)}>
          <td className="px-4 py-2.5"><span className="flex items-center gap-2">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span className="font-medium">{r.person}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{r.role === 'PM' ? 'Manager' : 'Agent'}</span></span></td>
          <td className="px-3 py-2.5 text-muted-foreground">{r.rate}{r.ownRate != null && <span className="ml-1 text-xs">(own)</span>}</td>
          <td className="px-3 py-2.5 text-right tabular-nums">{rs(r.earned)}</td>
          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{rs(r.paid)}</td>
          <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${r.due > 0 ? 'text-amber-700 dark:text-amber-400' : r.due < 0 ? 'text-sky-700 dark:text-sky-400' : 'text-muted-foreground'}`}>{r.due < 0 ? `${rs(-r.due)} paid ahead` : rs(r.due)}</td>
          {canEdit && <td className="px-4 py-2 text-right" onClick={e => e.stopPropagation()}><button className={buttonClass} onClick={() => setPaying(r)}>Record payment</button></td>}
        </tr>
        {isOpen && <tr className="bg-muted/30"><td colSpan={6} className="px-4 py-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <div><p className="mb-1 text-xs font-medium text-muted-foreground">Earned</p>{r.lines.length ? <ul className="space-y-1 text-xs">{r.lines.map((l, i) => <li key={i} className="flex justify-between gap-3"><span>{longDate(l.day)} · {l.dealId} {l.client}{l.kind === 'refund' ? ' (refund)' : ''} · {Math.round(l.rate * 1000) / 10}% of {rs(l.base)}</span><span className={`tabular-nums ${l.amount < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{rs(l.amount)}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">Nothing up to this date.</p>}</div>
            <div><p className="mb-1 text-xs font-medium text-muted-foreground">Paid</p>{r.payouts.length ? <ul className="space-y-1 text-xs">{r.payouts.map(p => <li key={p.id} className="flex justify-between gap-3"><span>{p.date} · {p.id}{p.note ? ` · ${p.note}` : ''}</span><span className="tabular-nums">{rs(p.amount)}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">No payments recorded.</p>}</div>
          </div>
        </td></tr>}
      </Fragment> })}
      {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No commission up to this date.</td></tr>}
      {rows.length > 0 && <tr className="border-t-2 border-border font-semibold"><td className="px-4 py-2.5" colSpan={2}>Total</td><td className="px-3 py-2.5 text-right tabular-nums">{rs(total('earned'))}</td><td className="px-3 py-2.5 text-right tabular-nums">{rs(total('paid'))}</td><td className="px-3 py-2.5 text-right tabular-nums">{rs(total('due'))}</td>{canEdit && <td />}</tr>}
      </tbody>
    </table></div>
    {paying && <RecordPayout row={paying} upTo={includeDay ? upTo : prevDay(upTo)} onClose={() => setPaying(null)} onChanged={onChanged} />}
  </div>
}

function RecordPayout({ row, upTo, onClose, onChanged }: { row: StatementRow; upTo: string; onClose: () => void; onChanged: Changed }) {
  const [amount, setAmount] = useState(row.due > 0 ? String(row.due) : '')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const { busy, error, run } = useSubmit(onClose, onChanged)
  const left = row.due - (Number(amount.replace(/,/g, '')) || 0)
  return <Modal title={`Payment to ${row.person}`} onClose={onClose}>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run('addPayout', { name: row.person, role: row.role, amount, date, upTo, note }) }}>
      <p className="text-sm text-muted-foreground">To pay up to {longDate(upTo)}: <b className="text-foreground">{rs(row.due)}</b></p>
      <label className={label}>Amount paid (PKR)<input inputMode="numeric" className={inputClass} value={amount} onChange={e => setAmount(e.target.value)} required autoFocus /></label>
      <p className="text-xs text-muted-foreground">{left > 0 ? `${rs(left)} stays to pay.` : left < 0 ? `${rs(-left)} paid ahead: it is taken off the next commission.` : 'Fully settled.'}</p>
      <label className={label}>Paid on<input type="date" className={inputClass} value={date} onChange={e => setDate(e.target.value)} required /></label>
      <label className={label}>Note<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} placeholder="Bank transfer, cash…" /></label>
      <Busy busy={busy ? 'Saving to the Commission Payouts tab…' : ''} error={error} />
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button className={primaryButton} disabled={busy}>Save payment</button></div>
    </form>
  </Modal>
}

/** Every commission payment recorded (the Commission Payouts tab). */
export function CommissionPayouts({ payouts, canEdit, onChanged }: { payouts: Payout[]; canEdit: boolean; onChanged: Changed }) {
  const [removing, setRemoving] = useState<Payout | null>(null)
  return <div className="crm-card overflow-x-auto">
    <table className="w-full min-w-[640px] text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Paid on</th><th className="px-3 py-3 font-medium">Person</th><th className="px-3 py-3 font-medium">Statement up to</th><th className="px-3 py-3 font-medium">Note</th><th className="px-3 py-3 text-right font-medium">Amount</th>{canEdit && <th className="px-4 py-3" />}</tr></thead>
      <tbody>{payouts.map(p => <tr key={p.id} className="border-t border-border">
        <td className="whitespace-nowrap px-4 py-2.5">{p.date}<span className="block text-xs text-muted-foreground">{p.id}</span></td>
        <td className="px-3 py-2.5">{p.person}<span className="block text-xs text-muted-foreground">{p.role === 'PM' ? 'Manager' : 'Agent'}{p.addedBy ? ` · by ${p.addedBy}` : ''}</span></td>
        <td className="px-3 py-2.5 text-muted-foreground">{p.upTo || '—'}</td>
        <td className="px-3 py-2.5 text-muted-foreground">{p.note || '—'}</td>
        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{rs(p.amount)}</td>
        {canEdit && <td className="px-4 py-2 text-right"><button className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Remove ${p.id}`} onClick={() => setRemoving(p)}><Trash2 size={14} /></button></td>}
      </tr>)}
      {payouts.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No commission payments recorded yet. Use Record payment on the statement.</td></tr>}</tbody>
    </table>
    {removing && <RemovePayout payout={removing} onClose={() => setRemoving(null)} onChanged={onChanged} />}
  </div>
}

function RemovePayout({ payout, onClose, onChanged }: { payout: Payout; onClose: () => void; onChanged: Changed }) {
  const { busy, error, run } = useSubmit(onClose, onChanged)
  return <Modal title={`Remove ${payout.id}?`} onClose={onClose}>
    <p className="text-sm">Removes the payment of {rs(payout.amount)} to {payout.person} on {payout.date}. It is added back to what is still to pay.</p>
    <Busy busy={busy ? 'Removing…' : ''} error={error} />
    <div className="mt-4 flex justify-end gap-2"><button className={buttonClass} onClick={onClose}>Cancel</button><button className={`${primaryButton} bg-destructive`} disabled={busy} onClick={() => void run('deletePayout', { payoutId: payout.id })}>Remove</button></div>
  </Modal>
}

/** Default commission numbers (Sheet cells) and each person's own rate (Commission Settings tab). */
export function CommissionRates({ data, onChanged }: { data: TrackerView; onChanged: Changed }) {
  const c = data.commission
  if (!c?.defaults) return <p className="text-sm text-muted-foreground">Update the connection script to version 3 to edit commission rates here.</p>
  return <div className="space-y-5">
    <Defaults defaults={c.defaults} onChanged={onChanged} />
    <div>
      <p className="mb-2 text-sm font-medium">Own rate per person</p>
      <ul className="divide-y divide-border rounded-2xl border border-border">{commissionPeople(data.deals, c.defaults).map(p => {
        const own = c.rates.find(r => r.person === p.person && r.role === p.role)
        return <PersonRateRow key={`${p.role}|${p.person}`} person={p.person} role={p.role} rate={own?.rate ?? null} fallback={p.role === 'PM' ? `${c.defaults!.pmRate * 100}%` : `${c.defaults!.rateBelow * 100}% / ${c.defaults!.rateAbove * 100}%`} onChanged={onChanged} />
      })}</ul>
    </div>
  </div>
}

function Defaults({ defaults, onChanged }: { defaults: CommissionDefaults; onChanged: Changed }) {
  const start = { target: String(defaults.target), rateBelow: String(defaults.rateBelow * 100), rateAbove: String(defaults.rateAbove * 100), pmRate: String(defaults.pmRate * 100) }
  const [v, setV] = useState(start)
  const { busy, error, run } = useSubmit(() => undefined, onChanged)
  const dirty = JSON.stringify(v) !== JSON.stringify(start)
  const field = (k: keyof typeof v, text: string, suffix: string) => <label className={label}>{text}<span className="flex items-center gap-1"><input inputMode="decimal" className={inputClass} value={v[k]} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} /><span className="text-muted-foreground">{suffix}</span></span></label>
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run('commissionDefaults', v) }}>
    <div className="grid gap-3 sm:grid-cols-4">
      {field('target', 'Monthly target', 'PKR')}{field('rateBelow', 'Below target', '%')}{field('rateAbove', 'At or above', '%')}{field('pmRate', 'Manager rate', '%')}
    </div>
    <Busy busy={busy ? 'Saving to the Sheet…' : ''} error={error} />
    {dirty && <button className={primaryButton} disabled={busy}>Save defaults</button>}
  </form>
}

function PersonRateRow({ person, role, rate, fallback, onChanged }: { person: string; role: 'Agent' | 'PM'; rate: number | null; fallback: string; onChanged: Changed }) {
  const start = rate == null ? '' : String(Math.round(rate * 10000) / 100)
  const [value, setValue] = useState(start)
  const { busy, error, run } = useSubmit(() => undefined, onChanged)
  return <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
    <span className="text-sm"><b className="font-medium">{person}</b> <span className="text-xs text-muted-foreground">{role === 'PM' ? 'Manager' : 'Agent'}</span></span>
    <span className="flex items-center gap-2">
      <input inputMode="decimal" className={`${inputClass} w-24 text-right`} value={value} onChange={e => setValue(e.target.value)} placeholder={fallback} aria-label={`Own rate for ${person}`} />
      <span className="text-sm text-muted-foreground">%</span>
      {value !== start && <button className={buttonClass} disabled={busy} onClick={() => void run('personRate', { name: person, role, rate: value })}>{busy ? 'Saving…' : value ? 'Save' : 'Use default'}</button>}
    </span>
    {error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
  </li>
}
