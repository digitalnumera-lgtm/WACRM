'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { BadgeCheck, CirclePlus, Pencil, Trash2, X } from 'lucide-react'
import { dayKey, type TrackerDeal, type TrackerPayment, type TrackerView } from '@/lib/tracker/model'
import { api, buttonClass, inputClass, primaryButton, sendJson } from '@/components/monitoring/ui'

type Options = { form: Record<string, string[]>; lists: { agents: string[]; teams: string[]; clientStatus: string[]; payout: string[] } }
export type Changed = (view: TrackerView, result: Record<string, unknown> | null) => void

let optionsCache: Promise<Options> | null = null
export function useOptions() {
  const [options, setOptions] = useState<Options | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    optionsCache ??= api<Options>('/api/tracker/options')
    optionsCache.then(setOptions).catch(e => { optionsCache = null; setError((e as Error).message) })
  }, [])
  return { options, error }
}

/** Sends one change through the Apps Script; it can take up to a minute when ClickUp or Drive is involved. */
export async function change(action: string, input: Record<string, unknown>) {
  return api<{ result: Record<string, unknown> | null; view?: TrackerView }>('/api/tracker/actions', sendJson('POST', { action, input }))
}

const today = () => new Date().toISOString().slice(0, 10)
const label = 'block space-y-1 text-sm'
const hint = 'text-xs text-muted-foreground'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
    <div className={`relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-background p-5 shadow-2xl sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-display text-lg font-semibold">{title}</h2><button className={buttonClass} onClick={onClose} aria-label="Close"><X size={16} /></button></div>
      {children}
    </div>
  </div>
}

function Choice({ name, value, onChange, choices, placeholder = 'Choose…', required }: { name: string; value: string; onChange: (v: string) => void; choices: string[] | undefined; placeholder?: string; required?: boolean }) {
  if (!choices?.length) return <input className={inputClass} value={value} onChange={e => onChange(e.target.value)} aria-label={name} required={required} />
  return <select className={inputClass} value={value} onChange={e => onChange(e.target.value)} aria-label={name} required={required}>
    <option value="">{placeholder}</option>{choices.map(c => <option key={c}>{c}</option>)}
  </select>
}

export function Busy({ busy, error }: { busy: string; error: string }) {
  return <>{busy && <p role="status" className="text-sm text-muted-foreground">{busy}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</>
}

/** The Closed Deal form, inside the CRM. Saved through the main script exactly like a form answer. */
export function AddDealDialog({ data, onClose, onChanged }: { data: TrackerView; onClose: () => void; onChanged: Changed }) {
  const { options, error: loadError } = useOptions()
  const [a, setA] = useState<Record<string, string>>({ 'Date Closed': today(), 'Deal type': '', 'Website taken?': 'No', 'Marketing taken?': 'No', 'Other service taken?': 'No' })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const set = (k: string) => (v: string) => setA(x => ({ ...x, [k]: v }))
  const f = options?.form ?? {}
  const web = a['Website taken?'] === 'Yes', mkt = a['Marketing taken?'] === 'Yes', oth = a['Other service taken?'] === 'Yes'
  const type = a['Website Type'] ?? ''
  const wp = type === 'WordPress Website', custom = type === 'Custom Web Application', shop = type === 'Shopify Store'
  const repeat = /repeat|existing|returning|upsell|renew/i.test(a['Deal type'] ?? '')
  const services = (a['Marketing Services'] ?? '').split(', ').filter(Boolean)
  const total = [web && a['Website Amount (PKR)'], web && a['Hosting provided by'] === 'Company' && a['Hosting Amount (PKR)'], mkt && a['Marketing Amount (PKR)'], oth && a['Other Amount (PKR)']]
    .reduce((s, v) => s + (Number(String(v || '').replace(/,/g, '')) || 0), 0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('Saving the deal in the Sheet… this takes a few seconds.'); setError('')
    // Send only the questions that apply, like the form does.
    const keep = Object.fromEntries(Object.entries(a).filter(([k, v]) => v !== '' && (
      !/^(Website Type|Shopify Store Model|Custom Website|WordPress|Hosting|Website Region|Website Amount)/.test(k) || web) &&
      (!/^Marketing (Services|Region|Start Date|Days|Amount)/.test(k) || mkt) && (!/^Other - |^Other Amount/.test(k) || oth) && (k !== 'Previous Deal ID' || repeat)))
    try {
      const res = await change('addDeal', { answers: keep })
      if (res.view) onChanged(res.view, res.result)
      onClose()
    } catch (err) { setError((err as Error).message); setBusy('') }
  }
  return <Modal title="Add a closed deal" onClose={onClose} wide>
    {!options ? <p className="text-sm text-muted-foreground">{loadError || 'Loading the deal form choices…'}</p> : <form onSubmit={submit} className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Sales agent<Choice name="Sales agent" value={a['Sales Agent'] ?? ''} onChange={set('Sales Agent')} choices={f['Sales Agent'] ?? options.lists.agents} required /></label>
        <label className={label}>Team<Choice name="Team" value={a['Team'] ?? ''} onChange={set('Team')} choices={f['Team'] ?? options.lists.teams} /></label>
        <label className={label}>Deal type<Choice name="Deal type" value={a['Deal type'] ?? ''} onChange={set('Deal type')} choices={f['Deal type']} /></label>
        {repeat && <label className={label}>Previous deal<select className={inputClass} value={a['Previous Deal ID'] ?? ''} onChange={e => set('Previous Deal ID')(e.target.value)}><option value="">Choose…</option>{data.deals.map(d => <option key={d.id} value={d.id}>{d.id} · {d.brand || d.client}</option>)}</select></label>}
        <label className={label}>Client name<input className={inputClass} value={a['Client Name'] ?? ''} onChange={e => set('Client Name')(e.target.value)} required /></label>
        <label className={label}>Business / brand<input className={inputClass} value={a['Business / Brand'] ?? ''} onChange={e => set('Business / Brand')(e.target.value)} /></label>
        <label className={label}>Phone<input className={inputClass} value={a['Phone'] ?? ''} onChange={e => set('Phone')(e.target.value)} required placeholder="03001234567, 971501234567" /></label>
        <label className={label}>Email<input type="email" className={inputClass} value={a['Email'] ?? ''} onChange={e => set('Email')(e.target.value)} /></label>
        <label className={label}>Client country<Choice name="Client country" value={a['Client Country'] ?? ''} onChange={set('Client Country')} choices={f['Client Country']} /></label>
        <label className={label}>Date closed<input type="date" className={inputClass} value={a['Date Closed'] ?? ''} onChange={e => set('Date Closed')(e.target.value)} required /></label>
      </fieldset>

      <Section title="Website" on={web} onToggle={v => set('Website taken?')(v ? 'Yes' : 'No')}>
        <label className={label}>Website type<Choice name="Website type" value={type} onChange={set('Website Type')} choices={f['Website Type']} required /></label>
        {shop && <label className={label}>Shopify store model<Choice name="Shopify store model" value={a['Shopify Store Model'] ?? ''} onChange={set('Shopify Store Model')} choices={f['Shopify Store Model']} /></label>}
        {custom && <label className={`${label} sm:col-span-2`}>What is being built<input className={inputClass} value={a['Custom Website - What is being built'] ?? ''} onChange={e => set('Custom Website - What is being built')(e.target.value)} /></label>}
        {wp && <label className={label}>Site purpose<Choice name="Site purpose" value={a['WordPress - Site purpose'] ?? ''} onChange={set('WordPress - Site purpose')} choices={f['WordPress - Site purpose']} /></label>}
        {wp && a['WordPress - Site purpose'] === 'E-commerce' && <label className={label}>WordPress store model<Choice name="WordPress store model" value={a['WordPress Store Model'] ?? ''} onChange={set('WordPress Store Model')} choices={f['WordPress Store Model']} /></label>}
        {(wp || custom) && <label className={label}>Hosting provided by<Choice name="Hosting provided by" value={a['Hosting provided by'] ?? ''} onChange={set('Hosting provided by')} choices={f['Hosting provided by']} /></label>}
        {(wp || custom) && a['Hosting provided by'] === 'Company' && <label className={label}>Hosting amount (PKR)<input inputMode="numeric" className={inputClass} value={a['Hosting Amount (PKR)'] ?? ''} onChange={e => set('Hosting Amount (PKR)')(e.target.value)} /></label>}
        <label className={label}>Website region<Choice name="Website region" value={a['Website Region'] ?? ''} onChange={set('Website Region')} choices={f['Website Region']} /></label>
        <label className={label}>Website amount (PKR)<input inputMode="numeric" className={inputClass} value={a['Website Amount (PKR)'] ?? ''} onChange={e => set('Website Amount (PKR)')(e.target.value)} required /></label>
      </Section>

      <Section title="Marketing" on={mkt} onToggle={v => set('Marketing taken?')(v ? 'Yes' : 'No')}>
        <div className={`${label} sm:col-span-2`}><span>Marketing services</span><div className="flex flex-wrap gap-2">{(f['Marketing Services'] ?? []).map(s => <label key={s} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${services.includes(s) ? 'border-foreground bg-foreground text-background' : 'border-border'}`}>
          <input type="checkbox" className="sr-only" checked={services.includes(s)} onChange={() => set('Marketing Services')((services.includes(s) ? services.filter(x => x !== s) : [...services, s]).join(', '))} />{s}</label>)}</div></div>
        <label className={label}>Marketing region<Choice name="Marketing region" value={a['Marketing Region'] ?? ''} onChange={set('Marketing Region')} choices={f['Marketing Region']} /></label>
        <label className={label}>Start date<input type="date" className={inputClass} value={a['Marketing Start Date'] ?? ''} onChange={e => set('Marketing Start Date')(e.target.value)} /></label>
        <label className={label}>Days<input inputMode="numeric" className={inputClass} value={a['Marketing Days'] ?? ''} onChange={e => set('Marketing Days')(e.target.value)} /></label>
        <label className={label}>Marketing amount (PKR)<input inputMode="numeric" className={inputClass} value={a['Marketing Amount (PKR)'] ?? ''} onChange={e => set('Marketing Amount (PKR)')(e.target.value)} required /></label>
      </Section>

      <Section title="Other service" on={oth} onToggle={v => set('Other service taken?')(v ? 'Yes' : 'No')}>
        <label className={label}>What was sold<input className={inputClass} value={a['Other - What was sold'] ?? ''} onChange={e => set('Other - What was sold')(e.target.value)} required /></label>
        <label className={label}>Amount (PKR)<input inputMode="numeric" className={inputClass} value={a['Other Amount (PKR)'] ?? ''} onChange={e => set('Other Amount (PKR)')(e.target.value)} required /></label>
      </Section>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Advance received (PKR)<input inputMode="numeric" className={inputClass} value={a['Advance Received (PKR)'] ?? ''} onChange={e => set('Advance Received (PKR)')(e.target.value)} /><span className={hint}>Deal total {total.toLocaleString()}. Upload the proof to the client&apos;s Drive folder.</span></label>
        <label className={label}>Notes<textarea className={inputClass} rows={3} value={a['Notes'] ?? ''} onChange={e => set('Notes')(e.target.value)} /></label>
      </fieldset>
      <p className={hint}>Saved exactly like the Closed Deal form: it gets the next deal number, waits for approval, and the PM email is sent.</p>
      <Busy busy={busy} error={error} />
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button className={primaryButton} disabled={!!busy || (!web && !mkt && !oth)}>{busy ? 'Saving…' : 'Add deal'}</button></div>
    </form>}
  </Modal>
}

function Section({ title, on, onToggle, children }: { title: string; on: boolean; onToggle: (v: boolean) => void; children: ReactNode }) {
  return <fieldset className="rounded-2xl border border-border p-4">
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium"><span>{title}</span>
      <input type="checkbox" className="size-4 accent-current" checked={on} onChange={e => onToggle(e.target.checked)} /></label>
    {on && <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>}
  </fieldset>
}

/** Approve, client status, payments and delete for one deal. */
export function DealActions({ deal, onChanged }: { deal: TrackerDeal; onChanged: Changed }) {
  const [open, setOpen] = useState<'edit' | 'status' | 'payment' | 'delete' | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const approve = async () => {
    setBusy('Approving: creating the Drive folder, ClickUp project and logins page… up to a minute.'); setError('')
    try { const res = await change('approve', { dealId: deal.id }); if (res.view) onChanged(res.view, res.result) }
    catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {deal.approved === false && <button className={primaryButton} disabled={!!busy} onClick={() => void approve()}><BadgeCheck size={14} />Approve</button>}
      <button className={buttonClass} disabled={!!busy} onClick={() => setOpen('edit')}><Pencil size={14} />Edit details</button>
      <button className={buttonClass} disabled={!!busy} onClick={() => setOpen('status')}>Client status</button>
      <button className={buttonClass} disabled={!!busy} onClick={() => setOpen('payment')}><CirclePlus size={14} />Payment or refund</button>
      <button className={`${buttonClass} text-destructive`} disabled={!!busy} onClick={() => setOpen('delete')}><Trash2 size={14} />Delete</button>
    </div>
    <Busy busy={busy} error={error} />
    {open === 'edit' && <EditDealDialog deal={deal} onClose={() => setOpen(null)} onChanged={onChanged} />}
    {open === 'status' && <StatusDialog deal={deal} onClose={() => setOpen(null)} onChanged={onChanged} />}
    {open === 'payment' && <PaymentDialog deal={deal} onClose={() => setOpen(null)} onChanged={onChanged} />}
    {open === 'delete' && <DeleteDialog deal={deal} onClose={() => setOpen(null)} onChanged={onChanged} />}
  </div>
}

export function useSubmit(onClose: () => void, onChanged: Changed) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: string, input: Record<string, unknown>) => {
    setBusy(true); setError('')
    try { const res = await change(action, input); if (res.view) onChanged(res.view, res.result); onClose() }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return { busy, error, run }
}

function StatusDialog({ deal, onClose, onChanged }: { deal: TrackerDeal; onClose: () => void; onChanged: Changed }) {
  const { options } = useOptions()
  const [status, setStatus] = useState(deal.clientStatus)
  const [offDate, setOffDate] = useState(today())
  const [reason, setReason] = useState(deal.offboardReason)
  const { busy, error, run } = useSubmit(onClose, onChanged)
  const choices = (options?.lists.clientStatus ?? ['Onboarding', 'Active', 'On Hold', 'Offboarded']).filter(s => s !== 'Pending Approval' || deal.approved === false)
  return <Modal title={`Client status · ${deal.id}`} onClose={onClose}>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run('status', { dealId: deal.id, status, offboardDate: status === 'Offboarded' ? offDate : '', offboardReason: status === 'Offboarded' ? reason : '' }) }}>
      <label className={label}>Status<select className={inputClass} value={status} onChange={e => setStatus(e.target.value)} required>{choices.map(s => <option key={s}>{s}</option>)}</select></label>
      {status === 'Offboarded' && <><label className={label}>Offboard date<input type="date" className={inputClass} value={offDate} onChange={e => setOffDate(e.target.value)} /></label>
        <label className={label}>Reason<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></label></>}
      <p className={hint}>Same as changing it on the Approvals tab: the ClickUp project status follows.</p>
      <Busy busy={busy ? 'Saving…' : ''} error={error} />
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button className={primaryButton} disabled={busy || status === deal.clientStatus && status !== 'Offboarded'}>Save</button></div>
    </form>
  </Modal>
}

function PaymentDialog({ deal, onClose, onChanged }: { deal: TrackerDeal; onClose: () => void; onChanged: Changed }) {
  const [kind, setKind] = useState<'Payment' | 'Refund'>('Payment')
  const [amount, setAmount] = useState(deal.money?.remaining && deal.money.remaining > 0 ? String(deal.money.remaining) : '')
  const [date, setDate] = useState(today())
  const [method, setMethod] = useState('')
  const [note, setNote] = useState('')
  const { busy, error, run } = useSubmit(onClose, onChanged)
  return <Modal title={`${kind} · ${deal.id} ${deal.brand || deal.client}`} onClose={onClose}>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run('payment', { dealId: deal.id, kind, amount, date, method, note }) }}>
      <div role="radiogroup" aria-label="Payment or refund" className="inline-flex gap-1 rounded-full bg-muted p-1">{(['Payment', 'Refund'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${kind === k ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{k}</button>)}</div>
      {deal.money && <p className={hint}>Total Rs {deal.money.total.toLocaleString()} · paid Rs {(deal.money.paid ?? 0).toLocaleString()} · owed Rs {Math.max(0, deal.money.remaining ?? 0).toLocaleString()}</p>}
      <label className={label}>Amount (PKR)<input inputMode="numeric" className={inputClass} value={amount} onChange={e => setAmount(e.target.value)} required /></label>
      <label className={label}>Date<input type="date" className={inputClass} value={date} onChange={e => setDate(e.target.value)} required /></label>
      <label className={label}>Method<input className={inputClass} value={method} onChange={e => setMethod(e.target.value)} placeholder="Bank transfer, JazzCash…" /></label>
      <label className={label}>Note<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></label>
      <p className={hint}>Same as the Payment Received form. Upload the proof to the client&apos;s Drive folder.</p>
      <Busy busy={busy ? 'Saving…' : ''} error={error} />
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button className={primaryButton} disabled={busy}>Add {kind.toLowerCase()}</button></div>
    </form>
  </Modal>
}

function DeleteDialog({ deal, onClose, onChanged }: { deal: TrackerDeal; onClose: () => void; onChanged: Changed }) {
  const [typed, setTyped] = useState('')
  const { busy, error, run } = useSubmit(onClose, onChanged)
  const approved = deal.approved !== false && (!!deal.clickupUrl || !!deal.driveUrl)
  return <Modal title={`Delete ${deal.id}?`} onClose={onClose}>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run('deleteDeal', { dealId: deal.id }) }}>
      <p className="text-sm">Removes {deal.id} ({deal.brand || deal.client}) from Deals, Approvals, Client Balances and its payments, like the Tools tab. Later deal numbers that are not approved yet move up to stay in sequence.</p>
      {approved && <p className="rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">This deal is approved: its ClickUp project (or its own subtasks), its Drive folder (to the bin) and its logins page are removed too.</p>}
      <label className={label}>Type {deal.id} to confirm<input className={inputClass} value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} autoComplete="off" /></label>
      <Busy busy={busy ? 'Deleting… up to a minute.' : ''} error={error} />
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button className={`${primaryButton} bg-destructive`} disabled={busy || typed !== deal.id}>Delete deal</button></div>
    </form>
  </Modal>
}

/** The yellow payout cells on Agents / PM Commission. */
export function PayoutDialog({ tab, month, name, current, onClose, onChanged }: { tab: 'agents' | 'pm'; month: string; name: string; current: { status: string; paidOn: string; amount: string; note: string }; onClose: () => void; onChanged: Changed }) {
  const { options } = useOptions()
  const [status, setStatus] = useState(current.status)
  const [paidOn, setPaidOn] = useState(current.paidOn || today())
  const [amount, setAmount] = useState(current.amount.replace(/,/g, ''))
  const [note, setNote] = useState(current.note)
  const { busy, error, run } = useSubmit(onClose, onChanged)
  return <Modal title={`Payout · ${name} · ${month}`} onClose={onClose}>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run('payout', { tab, month, name, status, paidOn: status ? paidOn : '', amountPaid: amount, note }) }}>
      <label className={label}>Payout status<select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}><option value="">Not set</option>{(options?.lists.payout ?? ['Pending', 'Partially Paid', 'On Hold', 'Paid']).map(s => <option key={s}>{s}</option>)}</select></label>
      {status && <label className={label}>Paid on<input type="date" className={inputClass} value={paidOn} onChange={e => setPaidOn(e.target.value)} /></label>}
      <label className={label}>Amount paid (PKR)<input inputMode="numeric" className={inputClass} value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className={label}>Note<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></label>
      <Busy busy={busy ? 'Saving…' : ''} error={error} />
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button className={primaryButton} disabled={busy}>Save</button></div>
    </form>
  </Modal>
}

const EDIT_FIELDS: { key: string; label: string; type?: 'date' | 'number' | 'textarea'; value: (d: TrackerDeal) => string }[] = [
  { key: 'Client', label: 'Client name', value: d => d.client },
  { key: 'Business / Brand', label: 'Business / brand', value: d => d.brand },
  { key: 'Phone', label: 'Phone', value: d => d.phone },
  { key: 'Email', label: 'Email', value: d => d.email },
  { key: 'Country', label: 'Country', value: d => d.country },
  { key: 'Sales Agent', label: 'Sales agent', value: d => d.agent },
  { key: 'Team', label: 'Team', value: d => d.team },
  { key: 'Date Closed', label: 'Date closed', type: 'date', value: d => dayKey(d.dateClosed) },
  { key: 'Website Amount', label: 'Website amount (PKR)', type: 'number', value: d => d.money ? String(d.money.website || '') : '' },
  { key: 'Hosting Amount', label: 'Hosting amount (PKR)', type: 'number', value: d => d.money ? String(d.money.hosting || '') : '' },
  { key: 'Marketing Amount', label: 'Marketing amount (PKR)', type: 'number', value: d => d.money ? String(d.money.marketing || '') : '' },
  { key: 'Other Amount', label: 'Other amount (PKR)', type: 'number', value: d => d.money ? String(d.money.other || '') : '' },
  { key: 'Marketing Days', label: 'Marketing days', type: 'number', value: d => d.marketing?.days ?? '' },
  { key: 'Marketing Start', label: 'Marketing start', type: 'date', value: d => dayKey(d.marketing?.start ?? '') },
  { key: 'Notes', label: 'Notes', type: 'textarea', value: d => d.notes },
]

/** Same as editing the deal's row on the Deals tab: services, balances and commission follow. */
function EditDealDialog({ deal, onClose, onChanged }: { deal: TrackerDeal; onClose: () => void; onChanged: Changed }) {
  const { options } = useOptions()
  const fields = EDIT_FIELDS.filter(f => (f.type !== 'number' || deal.money || f.key === 'Marketing Days') && (!f.key.startsWith('Marketing') || deal.marketing || f.key === 'Marketing Amount'))
  const start = Object.fromEntries(fields.map(f => [f.key, f.value(deal)]))
  const [v, setV] = useState<Record<string, string>>(start)
  const { busy, error, run } = useSubmit(onClose, onChanged)
  const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== start[k]))
  const choices: Record<string, string[] | undefined> = { 'Sales Agent': options?.lists.agents, Team: options?.lists.teams, Country: options?.form['Client Country'] }
  return <Modal title={`Edit ${deal.id} · ${deal.brand || deal.client}`} onClose={onClose} wide>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run('editDeal', { dealId: deal.id, fields: changed }) }}>
      <div className="grid gap-3 sm:grid-cols-2">{fields.map(f => <label key={f.key} className={`${label} ${f.type === 'textarea' ? 'sm:col-span-2' : ''}`}>{f.label}
        {f.type === 'textarea' ? <textarea className={inputClass} rows={3} value={v[f.key]} onChange={e => setV(x => ({ ...x, [f.key]: e.target.value }))} />
          : choices[f.key]?.length ? <Choice name={f.label} value={v[f.key]} onChange={val => setV(x => ({ ...x, [f.key]: val }))} choices={[...new Set([v[f.key], ...(choices[f.key] ?? [])].filter(Boolean))]} />
            : <input type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'number' ? 'numeric' : undefined} className={inputClass} value={v[f.key]} onChange={e => setV(x => ({ ...x, [f.key]: e.target.value }))} />}
      </label>)}</div>
      <Busy busy={busy ? 'Saving in the Sheet…' : ''} error={error} />
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button className={primaryButton} disabled={busy || !Object.keys(changed).length}>Save {Object.keys(changed).length || ''} change{Object.keys(changed).length === 1 ? '' : 's'}</button></div>
    </form>
  </Modal>
}

/** Edit or remove one Payment Log row. */
export function PaymentRowActions({ payment, onChanged }: { payment: TrackerPayment; onChanged: Changed }) {
  const [open, setOpen] = useState<'edit' | 'delete' | null>(null)
  return <span className="inline-flex gap-1">
    <button type="button" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${payment.id}`} title="Edit" onClick={() => setOpen('edit')}><Pencil size={13} /></button>
    <button type="button" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Remove ${payment.id}`} title="Remove" onClick={() => setOpen('delete')}><Trash2 size={13} /></button>
    {open === 'edit' && <EditPaymentDialog payment={payment} onClose={() => setOpen(null)} onChanged={onChanged} />}
    {open === 'delete' && <RemovePaymentDialog payment={payment} onClose={() => setOpen(null)} onChanged={onChanged} />}
  </span>
}

function EditPaymentDialog({ payment, onClose, onChanged }: { payment: TrackerPayment; onClose: () => void; onChanged: Changed }) {
  const refund = /refund/i.test(payment.type) || payment.amount < 0
  const [kind, setKind] = useState<'Payment' | 'Refund'>(refund ? 'Refund' : 'Payment')
  const [amount, setAmount] = useState(String(Math.abs(payment.amount)))
  const [date, setDate] = useState(dayKey(payment.date))
  const [method, setMethod] = useState(payment.method)
  const [note, setNote] = useState(payment.note)
  const { busy, error, run } = useSubmit(onClose, onChanged)
  return <Modal title={`Edit ${payment.id} · ${payment.dealId}`} onClose={onClose}>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run('editPayment', { paymentId: payment.id, kind, amount, date, method, note }) }}>
      <div role="radiogroup" aria-label="Payment or refund" className="inline-flex gap-1 rounded-full bg-muted p-1">{(['Payment', 'Refund'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${kind === k ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{k}</button>)}</div>
      <label className={label}>Amount (PKR)<input inputMode="numeric" className={inputClass} value={amount} onChange={e => setAmount(e.target.value)} required /></label>
      <label className={label}>Date<input type="date" className={inputClass} value={date} onChange={e => setDate(e.target.value)} required /></label>
      <label className={label}>Method<input className={inputClass} value={method} onChange={e => setMethod(e.target.value)} /></label>
      <label className={label}>Note<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></label>
      <Busy busy={busy ? 'Saving…' : ''} error={error} />
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button className={primaryButton} disabled={busy}>Save</button></div>
    </form>
  </Modal>
}

function RemovePaymentDialog({ payment, onClose, onChanged }: { payment: TrackerPayment; onClose: () => void; onChanged: Changed }) {
  const { busy, error, run } = useSubmit(onClose, onChanged)
  return <Modal title={`Remove ${payment.id}?`} onClose={onClose}>
    <p className="text-sm">Removes the {payment.type || 'payment'} of Rs {Math.abs(payment.amount).toLocaleString()} on {payment.date} for {payment.dealId} from the Payment Log. Balances and commission update.</p>
    <Busy busy={busy ? 'Removing…' : ''} error={error} />
    <div className="mt-4 flex justify-end gap-2"><button type="button" className={buttonClass} onClick={onClose}>Cancel</button><button className={`${primaryButton} bg-destructive`} disabled={busy} onClick={() => void run('deletePayment', { paymentId: payment.id })}>Remove</button></div>
  </Modal>
}
