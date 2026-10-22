'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight, Check, Copy, KeyRound, PlugZap } from 'lucide-react'
import type { TrackerLevel } from '@/lib/tracker/model'
import { api, buttonClass, inputClass, primaryButton, sendJson } from '@/components/monitoring/ui'
import { rememberPanel } from './panel'

type Person = { user_id: string; name: string; email: string | null; account_role: string; you: boolean; level: TrackerLevel | null }
type SettingsData = { ready: boolean; connection: { url: string | null; hasKey: boolean; updatedAt: string | null }; script: { version: number; source: string }; people: Person[] }

const LEVELS: { value: Exclude<TrackerLevel, 'owner'> | ''; label: string; hint: string }[] = [
  { value: '', label: 'No access', hint: 'Cannot open the Client Tracker' },
  { value: 'view', label: 'View', hint: 'Deals, clients and statuses, no amounts' },
  { value: 'amounts', label: 'View + amounts', hint: 'Also totals, paid, owed and payments' },
  { value: 'full', label: 'Full', hint: 'Also commission, and can add and change deals and payments' },
]

export function TrackerSettings({ level, crm, onConnected }: { level: TrackerLevel; crm: boolean; onConnected: () => void }) {
  return <div className="max-w-3xl space-y-5">
    <PanelSwitch target="crm" available={crm} />
    {level === 'owner' ? <OwnerSettings onConnected={onConnected} /> : <p className="crm-card p-5 text-sm text-muted-foreground">Your access: <b className="text-foreground">{LEVELS.find(l => l.value === level)?.label}</b>. The company owner manages the connection and who can see the Client Tracker.</p>}
  </div>
}

/** The button that moves between the WhatsApp CRM and the Client Tracker. */
export function PanelSwitch({ target, available }: { target: 'crm' | 'tracker'; available: boolean }) {
  if (!available) return null
  const toTracker = target === 'tracker'
  return <section className="crm-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
    <div><h2 className="font-semibold">Panel</h2><p className="text-sm text-muted-foreground">{toTracker ? 'You are in the WhatsApp CRM. The Client Tracker shows deals, clients, payments and commission from the Google Sheet.' : 'You are in the Client Tracker. The WhatsApp CRM shows chats, leads and agents.'}</p></div>
    <a className={primaryButton} href={toTracker ? '/tracker' : '/monitoring'} onClick={() => rememberPanel(toTracker ? 'tracker' : 'crm')}><ArrowLeftRight size={15} />{toTracker ? 'Switch to Client Tracker' : 'Switch to WhatsApp CRM'}</a>
  </section>
}

function OwnerSettings({ onConnected }: { onConnected: () => void }) {
  const [data, setData] = useState<SettingsData | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setData(await api<SettingsData>('/api/tracker/settings')); setError('') } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect -- initial fetch
  if (error && !data) return <p role="alert" className="crm-card p-5 text-sm text-destructive">{error}</p>
  if (!data) return <div className="crm-card h-48 animate-pulse" />
  if (!data.ready) return <section className="crm-card space-y-2 p-5"><h2 className="font-semibold">One database update needed</h2><p className="text-sm text-muted-foreground">Run <code>supabase/numera/006_client_tracker.sql</code> in the Supabase SQL Editor, then reload this page.</p></section>
  return <>
    <Connection data={data} onSaved={load} onConnected={onConnected} />
    <People people={data.people} onSaved={load} />
  </>
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return <button type="button" className={buttonClass} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }) }}>{done ? <Check size={14} /> : <Copy size={14} />}{done ? 'Copied' : label}</button>
}

function Connection({ data, onSaved, onConnected }: { data: SettingsData; onSaved: () => void; onConnected: () => void }) {
  const [url, setUrl] = useState(data.connection.url ?? '')
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setMessage(null)
    try { await action() } catch (e) { setMessage({ ok: false, text: (e as Error).message }) } finally { setBusy('') }
  }
  const newKey = () => run('key', async () => {
    const result = await api<{ key: string }>('/api/tracker/settings', sendJson('POST', { action: 'new_key' }))
    setKey(result.key); onSaved()
  })
  const saveUrl = () => run('url', async () => {
    await api('/api/tracker/settings', sendJson('POST', { url })); setMessage({ ok: true, text: 'Link saved.' }); onSaved()
  })
  const test = () => run('test', async () => {
    const result = await api<{ version: number | null; latest: number }>('/api/tracker/settings', sendJson('POST', { action: 'test' }))
    setMessage({ ok: true, text: result.version && result.version < result.latest ? 'Connected, but the script file is out of date. Copy the latest script and deploy a new version.' : 'Connected. The Client Tracker can read the Sheet.' })
    onConnected()
  })
  const connected = !!data.connection.url && data.connection.hasKey
  return <section className="crm-card space-y-5 p-5">
    <div><h2 className="flex items-center gap-2 font-semibold"><PlugZap size={17} />Google Sheet connection</h2>
      <p className="text-sm text-muted-foreground">{connected ? 'Connected to the Numera Client Tracker Sheet through Apps Script.' : 'Connect the Numera Client Tracker Sheet in four steps.'} Changes made here (by you or people with Full access) run your main script&apos;s own functions, so ClickUp, Drive, balances, commission and emails work exactly as with the forms.</p></div>
    <ol className="space-y-5 text-sm">
      <li className="space-y-2"><p className="font-medium">1. Create a private key</p>
        {key ? <div className="space-y-2 rounded-2xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Shown only now. Paste it into the script in step 2, in place of PASTE-KEY-HERE.</p><div className="flex flex-wrap items-center gap-2"><code className="select-all break-all rounded-lg bg-background px-2 py-1 text-xs">{key}</code><CopyButton text={key} label="Copy key" /></div></div>
          : <div className="flex flex-wrap items-center gap-2"><button className={buttonClass} disabled={!!busy} onClick={() => void newKey()}><KeyRound size={14} />{data.connection.hasKey ? 'Create a new key' : 'Create key'}</button>{data.connection.hasKey && <span className="text-xs text-muted-foreground">A key exists. A new key stops the old one working until the script has the new one.</span>}</div>}
      </li>
      <li className="space-y-2"><p className="font-medium">2. Add the script file</p>
        <p className="text-muted-foreground">Open the &quot;Numera Automation&quot; Apps Script project → <b>+</b> next to Files → Script → name it <code>crm-connect</code>. Paste the script, put the key between the quotes on the <code>CRM_KEY</code> line, and save. Your main <code>numera-crm-v3.gs</code> stays as it is.</p>
        <div className="flex flex-wrap gap-2"><CopyButton text={data.script.source} label={`Copy script (version ${data.script.version})`} /></div>
        <details><summary className="cursor-pointer text-xs text-muted-foreground">Show the script</summary><pre className="mt-2 max-h-72 overflow-auto rounded-2xl bg-muted/60 p-3 text-[11px] leading-relaxed">{data.script.source}</pre></details>
      </li>
      <li className="space-y-2"><p className="font-medium">3. Deploy it as a web app</p>
        <p className="text-muted-foreground">In Apps Script: <b>Deploy → New deployment</b> → type <b>Web app</b>. Execute as <b>Me</b>, Who has access <b>Anyone</b> (the key keeps it private). Approve the permissions, then copy the <b>Web app URL</b>. After changing the script later, use Deploy → Manage deployments → edit → New version.</p>
        <div className="flex flex-wrap gap-2"><input className={`${inputClass} min-w-0 flex-1`} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" aria-label="Web app URL" /><button className={primaryButton} disabled={!!busy || url.trim() === (data.connection.url ?? '')} onClick={() => void saveUrl()}>{busy === 'url' ? 'Saving…' : 'Save link'}</button></div>
      </li>
      <li className="space-y-2"><p className="font-medium">4. Test</p>
        <button className={buttonClass} disabled={!!busy || !connected} onClick={() => void test()}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
      </li>
    </ol>
    {message && <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>{message.text}</p>}
  </section>
}

function People({ people, onSaved }: { people: Person[]; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const change = async (person: Person, level: string) => {
    setBusy(person.user_id); setError('')
    try { await api('/api/tracker/access', sendJson('PUT', { user_id: person.user_id, level: level || null })); onSaved() }
    catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  return <section className="crm-card p-5">
    <h2 className="font-semibold">Who can open the Client Tracker</h2>
    <p className="text-sm text-muted-foreground">Separate from WhatsApp CRM roles. Everyone starts with no access. Changes apply on the person&apos;s next click. To remove someone from the whole CRM, use WhatsApp CRM → Settings → Team &amp; roles.</p>
    <ul className="mt-4 divide-y divide-border">{people.map(p => <li key={p.user_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{p.name}{p.you && <span className="text-muted-foreground"> (you)</span>}</p><p className="truncate text-xs text-muted-foreground">{p.email}{p.account_role === 'admin' ? ' · CRM admin' : ''}</p></div>
      {p.level === 'owner' ? <span className="text-sm text-muted-foreground">Owner · always full access</span>
        : <select className={`${inputClass} w-full sm:w-56`} value={p.level ?? ''} disabled={busy === p.user_id} onChange={e => void change(p, e.target.value)} aria-label={`Client Tracker access for ${p.name}`}>
          {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}: {l.hint}</option>)}
        </select>}
    </li>)}</ul>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </section>
}
