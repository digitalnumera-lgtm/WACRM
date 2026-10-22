'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ExternalLink, FolderOpen, Search, X } from 'lucide-react'
import { signed, type SheetTable, type TrackerDeal, type TrackerView } from '@/lib/tracker/model'
import { CountUp } from '@/components/monitoring/motion'
import { Avatar, buttonClass, inputClass } from '@/components/monitoring/ui'

export const pkr = (n: number | null | undefined) => n == null ? '—' : `Rs ${Math.round(n).toLocaleString()}`
const clientKey = (d: Pick<TrackerDeal, 'clientId' | 'client'>) => d.clientId || d.client
const monthLabel = (m: string) => { if (!m) return ''; const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) }
const field = `${inputClass} w-auto min-w-0`

const statusTone: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  onboarding: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  'on hold': 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  offboarded: 'bg-muted text-muted-foreground',
}
export function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusTone[status.toLowerCase()] ?? 'bg-muted text-foreground'}`}>{status}</span>
}
function PaymentBadge({ status }: { status: string }) {
  if (!status) return null
  const tone = /fully/i.test(status) ? 'text-emerald-700 dark:text-emerald-400' : /refund/i.test(status) ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'
  return <span className={`text-xs font-medium ${tone}`}>{status}</span>
}

function Kpi({ label, value, money, dark, hint }: { label: string; value: number; money?: boolean; dark?: boolean; hint?: ReactNode }) {
  return <div className={`rounded-3xl p-5 ${dark ? 'bg-[var(--ink)] text-[var(--ink-fg)] dark:bg-[var(--hl)] dark:text-[var(--hl-fg)]' : 'crm-card'}`}>
    <p className={`text-sm ${dark ? 'opacity-70' : 'text-muted-foreground'}`}>{label}</p>
    <p className="font-display mt-2 text-3xl font-semibold tracking-tight">{money && <span className="mr-1 text-lg opacity-60">Rs</span>}<CountUp value={value} /></p>
    {hint && <p className={`mt-1 text-xs ${dark ? 'opacity-70' : 'text-muted-foreground'}`}>{hint}</p>}
  </div>
}

/** Progress per team from the ClickUp project (web 2/3 · design 1/1 …). */
function Progress({ deal, compact }: { deal: TrackerDeal; compact?: boolean }) {
  const c = deal.clickup
  if (!c) return compact ? <span className="text-xs text-muted-foreground">—</span> : null
  const teams = Object.entries(c.teams)
  if (compact) {
    const done = teams.reduce((s, [, [d]]) => s + d, 0), total = teams.reduce((s, [, [, t]]) => s + t, 0)
    return <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" title={`ClickUp: ${c.status}`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[var(--hl)]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span>{done}/{total}
    </span>
  }
  return <div className="space-y-1.5">
    <p className="text-xs text-muted-foreground">ClickUp project: <span className="font-medium capitalize text-foreground">{c.status || '—'}</span></p>
    {teams.map(([team, [done, total]]) => <div key={team} className="flex items-center gap-2 text-xs">
      <span className="w-16 capitalize text-muted-foreground">{team}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[var(--hl)]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span>
      <span className="w-8 text-right tabular-nums">{done}/{total}</span>
    </div>)}
  </div>
}

export function TrackerOverview({ data, onClient, onDeals }: { data: TrackerView; onClient: (key: string) => void; onDeals: () => void }) {
  const s = data.summary
  const live = (s.byStatus['Active'] ?? 0) + (s.byStatus['Onboarding'] ?? 0)
  const owed = data.deals.filter(d => (d.money?.remaining ?? 0) > 0).sort((a, b) => (b.money?.remaining ?? 0) - (a.money?.remaining ?? 0))
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi dark label={`Deals closed · ${monthLabel(s.month)}`} value={s.dealsThisMonth} hint={`${s.deals} deals all time`} />
      {s.money ? <>
        <Kpi money label={`Collected · ${monthLabel(s.month)}`} value={s.money.collectedThisMonth} hint={`Rs ${s.money.collectedAllTime.toLocaleString()} all time`} />
        <Kpi money label="Still owed" value={s.money.outstanding} hint={`${s.money.unpaidDeals} deal${s.money.unpaidDeals === 1 ? '' : 's'} not fully paid`} />
        <Kpi money label={`Sales · ${monthLabel(s.month)}`} value={s.money.salesThisMonth} />
      </> : <>
        <Kpi label="Clients" value={s.clients} />
        <Kpi label="Active or onboarding" value={live} />
      </>}
    </section>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section className="crm-card overflow-hidden">
        <h2 className="px-5 pb-2 pt-5 font-semibold">Sales agents</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-5 py-2 font-medium">Agent</th><th className="px-3 py-2 text-right font-medium">This month</th><th className="px-3 py-2 text-right font-medium">All time</th>{s.money && <th className="px-5 py-2 text-right font-medium">Sales this month</th>}</tr></thead>
          <tbody>{s.byAgent.map(a => <tr key={a.agent} className="border-t border-border">
            <td className="px-5 py-2.5"><span className="flex items-center gap-2"><Avatar name={a.agent} seed={a.agent} size="sm" />{a.agent}</span></td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{a.dealsThisMonth}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{a.deals}</td>
            {s.money && <td className="px-5 py-2.5 text-right tabular-nums">{pkr(a.salesThisMonth)}</td>}
          </tr>)}</tbody>
        </table></div>
      </section>
      <section className="crm-card p-5">
        <h2 className="mb-3 font-semibold">Clients by status</h2>
        <div className="flex flex-wrap gap-2">{Object.entries(s.byStatus).sort((a, b) => b[1] - a[1]).map(([status, n]) => <span key={status} className="inline-flex items-center gap-2 rounded-2xl border border-border px-3 py-2 text-sm"><StatusBadge status={status} /><span className="font-semibold tabular-nums">{n}</span></span>)}</div>
        <h2 className="mb-2 mt-6 flex items-center justify-between font-semibold">Latest deals<button className="text-xs font-medium text-muted-foreground underline" onClick={onDeals}>See all</button></h2>
        <ul className="divide-y divide-border">{data.deals.slice(0, 5).map(d => <li key={d.id}><button className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:opacity-80" onClick={() => onClient(clientKey(d))}>
          <span className="min-w-0"><span className="block truncate font-medium">{d.brand || d.client}</span><span className="block truncate text-xs text-muted-foreground">{d.id} · {d.agent} · {d.dateClosed}</span></span><StatusBadge status={d.clientStatus} />
        </button></li>)}</ul>
      </section>
    </div>
    {s.money && owed.length > 0 && <section className="crm-card overflow-hidden">
      <h2 className="px-5 pb-2 pt-5 font-semibold">Still owed</h2>
      <ul className="divide-y divide-border">{owed.map(d => <li key={d.id}><button className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left text-sm hover:bg-muted/50" onClick={() => onClient(clientKey(d))}>
        <span className="min-w-0"><span className="block truncate font-medium">{d.brand || d.client} <span className="font-normal text-muted-foreground">· {d.id}</span></span><span className="block text-xs text-muted-foreground">Paid {pkr(d.money?.paid)} of {pkr(d.money?.total)} · {d.agent}</span></span>
        <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">{pkr(d.money?.remaining)}</span>
      </button></li>)}</ul>
    </section>}
  </div>
}

export function TrackerDeals({ data, openClient, onClient }: { data: TrackerView; openClient: string | null; onClient: (key: string | null) => void }) {
  const [q, setQ] = useState('')
  const [agent, setAgent] = useState('')
  const [status, setStatus] = useState('')
  const [payment, setPayment] = useState('')
  const [month, setMonth] = useState('')
  const money = !!data.summary.money
  const options = useMemo(() => ({
    agents: [...new Set(data.deals.map(d => d.agent).filter(Boolean))].sort(),
    statuses: [...new Set(data.deals.map(d => d.clientStatus).filter(Boolean))].sort(),
    payments: [...new Set(data.deals.map(d => d.money?.paymentStatus ?? '').filter(Boolean))].sort(),
    months: [...new Set(data.deals.map(d => d.month).filter(Boolean))].sort().reverse(),
  }), [data.deals])
  const digits = q.replace(/\D/g, '').replace(/^(92|0)/, '')
  const rows = data.deals.filter(d => (!agent || d.agent === agent) && (!status || d.clientStatus === status) && (!payment || d.money?.paymentStatus === payment) && (!month || d.month === month) &&
    (!q.trim() || [d.id, d.clientId, d.client, d.brand, d.email, d.services].some(v => v.toLowerCase().includes(q.trim().toLowerCase())) || (digits.length >= 5 && d.phone.replace(/\D/g, '').includes(digits))))
  const total = rows.reduce((s, d) => s + (d.money?.total ?? 0), 0), owed = rows.reduce((s, d) => s + Math.max(0, d.money?.remaining ?? 0), 0)
  return <div className="space-y-4">
    <div className="crm-card flex flex-wrap items-center gap-2 p-3">
      <label className="relative min-w-52 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className={`${inputClass} pl-9`} value={q} onChange={e => setQ(e.target.value)} placeholder="Search client, brand, deal, phone" aria-label="Search deals" /></label>
      <select className={field} value={agent} onChange={e => setAgent(e.target.value)} aria-label="Sales agent"><option value="">All agents</option>{options.agents.map(a => <option key={a}>{a}</option>)}</select>
      <select className={field} value={status} onChange={e => setStatus(e.target.value)} aria-label="Client status"><option value="">Any status</option>{options.statuses.map(a => <option key={a}>{a}</option>)}</select>
      {money && <select className={field} value={payment} onChange={e => setPayment(e.target.value)} aria-label="Payment status"><option value="">Any payment</option>{options.payments.map(a => <option key={a}>{a}</option>)}</select>}
      <select className={field} value={month} onChange={e => setMonth(e.target.value)} aria-label="Month closed"><option value="">Any month</option>{options.months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
    </div>
    <p className="px-1 text-sm text-muted-foreground">{rows.length} deal{rows.length === 1 ? '' : 's'}{money && <> · total {pkr(total)} · still owed {pkr(owed)}</>}</p>
    <div className="crm-card overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr>
          <th className="px-4 py-3 font-medium">Client</th><th className="px-3 py-3 font-medium">Deal</th><th className="px-3 py-3 font-medium">Agent</th><th className="px-3 py-3 font-medium">Closed</th><th className="px-3 py-3 font-medium">Status</th>
          {money && <><th className="px-3 py-3 text-right font-medium">Total</th><th className="px-3 py-3 text-right font-medium">Owed</th></>}<th className="px-4 py-3 font-medium">Work</th>
        </tr></thead>
        <tbody>{rows.map(d => <tr key={d.id} onClick={() => onClient(clientKey(d))} className="cursor-pointer border-t border-border hover:bg-muted/40">
          <td className="max-w-64 px-4 py-2.5"><span className="block truncate font-medium">{d.brand || d.client}</span><span className="block truncate text-xs text-muted-foreground">{d.client}{d.clientId && ` · ${d.clientId}`}</span></td>
          <td className="px-3 py-2.5"><span className="block font-medium">{d.id}</span><span className="block max-w-52 truncate text-xs text-muted-foreground" title={d.services}>{d.services}</span></td>
          <td className="px-3 py-2.5 whitespace-nowrap">{d.agent}<span className="block text-xs text-muted-foreground">{d.team && d.team !== d.agent ? `Team ${d.team}` : ''}</span></td>
          <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{d.dateClosed}</td>
          <td className="px-3 py-2.5"><StatusBadge status={d.clientStatus} />{d.approved === false && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">Waiting for approval</span>}</td>
          {money && <><td className="px-3 py-2.5 text-right tabular-nums">{pkr(d.money?.total)}</td><td className={`px-3 py-2.5 text-right tabular-nums ${(d.money?.remaining ?? 0) > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{(d.money?.remaining ?? 0) > 0 ? pkr(d.money?.remaining) : 'Paid'}</td></>}
          <td className="px-4 py-2.5"><Progress deal={d} compact /></td>
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No deals match these filters.</td></tr>}</tbody>
      </table>
    </div>
    {openClient && <ClientSheet data={data} clientKey={openClient} onClose={() => onClient(null)} />}
  </div>
}

function ClientSheet({ data, clientKey: key, onClose }: { data: TrackerView; clientKey: string; onClose: () => void }) {
  const deals = data.deals.filter(d => clientKey(d) === key)
  const first = deals[0]
  if (!first) return null
  const ids = new Set(deals.map(d => d.id))
  const payments = (data.payments ?? []).filter(p => ids.has(p.dealId))
  const phones = [...new Set(deals.flatMap(d => d.phone.split(/[,/]| {2,}/).map(p => p.trim()).filter(Boolean)))]
  const lifetime = deals.reduce((s, d) => s + (d.money?.total ?? 0), 0)
  const paid = deals.reduce((s, d) => s + (d.money?.paid ?? 0), 0)
  return <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`Client ${first.client}`}>
    <button aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
    <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-background p-5 shadow-2xl sm:rounded-l-3xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3"><Avatar name={first.brand || first.client} seed={key} size="lg" /><div>
          <h2 className="font-display text-xl font-semibold">{first.brand || first.client}</h2>
          <p className="text-sm text-muted-foreground">{first.client}{first.clientId && ` · ${first.clientId}`}{first.country && ` · ${first.country}`}</p>
        </div></div>
        <button className={buttonClass} onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {phones.length > 0 && <><dt className="text-muted-foreground">Phone</dt><dd>{phones.join(' · ')}</dd></>}
        {first.email && <><dt className="text-muted-foreground">Email</dt><dd className="break-all">{first.email}</dd></>}
        <dt className="text-muted-foreground">Deals</dt><dd>{deals.length}</dd>
        {data.summary.money && <><dt className="text-muted-foreground">Lifetime</dt><dd>{pkr(lifetime)} <span className="text-muted-foreground">· paid {pkr(paid)}</span></dd></>}
      </dl>
      <div className="mt-5 space-y-4">{deals.map(d => <section key={d.id} className="crm-card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">{d.id} <span className="font-normal text-muted-foreground">· {d.dealType || 'Deal'} · {d.dateClosed}</span></p><StatusBadge status={d.clientStatus} />
        </div>
        <p className="text-sm">{d.services}</p>
        <p className="text-xs text-muted-foreground">Closed by {d.agent}{d.team && ` · Team ${d.team}`}{d.approved === false ? ' · waiting for approval' : ''}{d.offboardDate && ` · offboarded ${d.offboardDate}`}{d.offboardReason && ` (${d.offboardReason})`}</p>
        {d.marketing && <p className="text-xs text-muted-foreground">Marketing: {d.marketing.services}{d.marketing.days && ` · ${d.marketing.days} days`}{d.marketing.start && ` · ${d.marketing.start} → ${d.marketing.end}`}{d.marketing.status && ` · ${d.marketing.status}`}</p>}
        {d.money && <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted/50 p-3 text-center text-sm">
          <div><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold tabular-nums">{pkr(d.money.total)}</p></div>
          <div><p className="text-xs text-muted-foreground">Paid</p><p className="font-semibold tabular-nums">{pkr(d.money.paid)}</p></div>
          <div><p className="text-xs text-muted-foreground">Owed</p><p className={`font-semibold tabular-nums ${(d.money.remaining ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : ''}`}>{pkr(d.money.remaining)}</p></div>
          <p className="col-span-3"><PaymentBadge status={d.money.paymentStatus} />{d.money.fullyPaidOn && <span className="text-xs text-muted-foreground"> · {d.money.fullyPaidOn}</span>}</p>
        </div>}
        <Progress deal={d} />
        {d.notes && <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs">{d.notes}</p>}
        <div className="flex flex-wrap gap-2">
          {d.clickupUrl && <a className={buttonClass} href={d.clickupUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />ClickUp project</a>}
          {d.driveUrl && <a className={buttonClass} href={d.driveUrl} target="_blank" rel="noopener noreferrer"><FolderOpen size={14} />Drive folder</a>}
        </div>
      </section>)}</div>
      {payments.length > 0 && <section className="mt-5">
        <h3 className="mb-2 font-semibold">Payments</h3>
        <ul className="crm-card divide-y divide-border">{payments.map(p => <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span><span className="font-medium">{p.type || 'Payment'}</span> <span className="text-muted-foreground">· {p.dealId} · {p.date}{p.collectedBy && ` · ${p.collectedBy}`}</span>{p.note && <span className="block text-xs text-muted-foreground">{p.note}</span>}</span>
          <span className={`font-semibold tabular-nums ${signed(p) < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{pkr(signed(p))}</span>
        </li>)}</ul>
      </section>}
    </aside>
  </div>
}

export function TrackerPayments({ data, onClient }: { data: TrackerView; onClient: (key: string) => void }) {
  const [q, setQ] = useState('')
  const [month, setMonth] = useState('')
  const payments = data.payments ?? []
  const months = [...new Set(payments.map(p => p.month).filter(Boolean))].sort().reverse()
  const byDeal = new Map(data.deals.map(d => [d.id, d]))
  const rows = payments.filter(p => (!month || p.month === month) && (!q.trim() || [p.id, p.dealId, p.client, p.collectedBy, p.type, p.note].some(v => v.toLowerCase().includes(q.trim().toLowerCase()))))
  const net = rows.reduce((s, p) => s + signed(p), 0)
  return <div className="space-y-4">
    <div className="crm-card flex flex-wrap items-center gap-2 p-3">
      <label className="relative min-w-52 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className={`${inputClass} pl-9`} value={q} onChange={e => setQ(e.target.value)} placeholder="Search client, deal, payment, who collected" aria-label="Search payments" /></label>
      <select className={field} value={month} onChange={e => setMonth(e.target.value)} aria-label="Month"><option value="">Any month</option>{months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
    </div>
    <p className="px-1 text-sm text-muted-foreground">{rows.length} payment{rows.length === 1 ? '' : 's'} · collected {pkr(net)}{month ? ` in ${monthLabel(month)}` : ''}</p>
    <div className="crm-card overflow-x-auto"><table className="w-full min-w-[680px] text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Date</th><th className="px-3 py-3 font-medium">Client</th><th className="px-3 py-3 font-medium">Type</th><th className="px-3 py-3 font-medium">Collected by</th><th className="px-3 py-3 font-medium">Method</th><th className="px-4 py-3 text-right font-medium">Amount</th></tr></thead>
      <tbody>{rows.map(p => { const d = byDeal.get(p.dealId); return <tr key={p.id} className={`border-t border-border ${d ? 'cursor-pointer hover:bg-muted/40' : ''}`} onClick={() => d && onClient(clientKey(d))}>
        <td className="whitespace-nowrap px-4 py-2.5">{p.date}<span className="block text-xs text-muted-foreground">{p.id}</span></td>
        <td className="px-3 py-2.5"><span className="block font-medium">{d?.brand || p.client}</span><span className="block text-xs text-muted-foreground">{p.dealId}</span></td>
        <td className="px-3 py-2.5">{p.type}{p.note && <span className="block max-w-56 truncate text-xs text-muted-foreground" title={p.note}>{p.note}</span>}</td>
        <td className="px-3 py-2.5">{p.collectedBy}</td>
        <td className="px-3 py-2.5 text-muted-foreground">{p.method || '—'}</td>
        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${signed(p) < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{pkr(signed(p))}</td>
      </tr> })}
      {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No payments match.</td></tr>}</tbody>
    </table></div>
  </div>
}

export function TrackerCommission({ data }: { data: TrackerView }) {
  const tabs = [['agents', 'Sales agents'], ['pm', 'PM commission'], ['owner', 'Owner deals']] as const
  const [tab, setTab] = useState<(typeof tabs)[number][0]>('agents')
  const table = data.commission?.[tab] ?? null
  return <div className="space-y-4">
    <div role="tablist" aria-label="Commission" className="inline-flex gap-1 rounded-full bg-card p-1 shadow-sm">
      {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
    </div>
    {table ? <SheetGrid table={table} /> : <p className="crm-card p-6 text-sm text-muted-foreground">This tab was not found in the Sheet.</p>}
  </div>
}

/** A Sheet tab shown as it is, newest records first. */
function SheetGrid({ table }: { table: SheetTable }) {
  const note = table.notes?.find(n => n.length > 60)
  const numeric = (h: string) => /PKR|Deals|Rate|Commission|Paid|Sales|Earned|Remaining|Total/i.test(h) && !/Status|Note|On$/i.test(h)
  return <div className="space-y-3">
    {note && <details className="crm-card px-4 py-3 text-sm"><summary className="cursor-pointer font-medium">How this is worked out</summary><p className="mt-2 text-muted-foreground">{note}</p></details>}
    <div className="crm-card overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr>{table.headers.map(h => <th key={h} className={`whitespace-nowrap px-3 py-3 font-medium ${numeric(h) ? 'text-right' : ''}`}>{h.replace(' (PKR)', '')}</th>)}</tr></thead>
      <tbody>{[...table.rows].reverse().map((row, i) => <tr key={i} className="border-t border-border">{table.headers.map((h, j) => <td key={h} className={`whitespace-nowrap px-3 py-2 ${numeric(h) ? 'text-right tabular-nums' : ''} ${j === 0 ? 'font-medium' : ''}`}>{row[j] || <span className="text-muted-foreground">—</span>}</td>)}</tr>)}</tbody>
    </table></div>
  </div>
}
