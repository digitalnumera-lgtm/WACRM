'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, KeyRound } from 'lucide-react'
import type { TrackerLevel, TrackerView } from '@/lib/tracker/model'
import { ScreenLoader } from '@/components/monitoring/loaders'
import { api, buttonClass, Icon3D, inputClass, primaryButton, sendJson } from '@/components/monitoring/ui'
import { CommissionRates } from './tracker-commission'
import type { Changed } from './tracker-edit'

type Person = { user_id: string; name: string; email: string | null; account_role: string; you: boolean; level: TrackerLevel | null }
type SettingsData = { ready: boolean; connection: { url: string | null; hasKey: boolean; updatedAt: string | null }; script: { version: number; source: string }; people: Person[] }

const LEVELS: { value: Exclude<TrackerLevel, 'owner'> | ''; label: string; hint: string }[] = [
  { value: '', label: 'No access', hint: 'Cannot open Clients' },
  { value: 'view', label: 'View', hint: 'Deals, clients and statuses, no amounts' },
  { value: 'amounts', label: 'View + amounts', hint: 'Also totals, paid, owed and payments' },
  { value: 'full', label: 'Full', hint: 'Also commission, and can add and change deals and payments' },
]

export function TrackerSettings({ level, onConnected, data, onChanged }: { level: TrackerLevel; onConnected: () => void; data: TrackerView | null; onChanged: Changed }) {
  return <div className="max-w-3xl space-y-5">
    {data?.commission && <section className="crm-card space-y-4 p-5">
      <div className="flex items-center gap-3"><Icon3D name="coins" size={36} /><h2 className="font-semibold">Commission rates</h2></div>
      <CommissionRates data={data} onChanged={onChanged} />
    </section>}
    {level === 'owner' ? <OwnerSettings onConnected={onConnected} /> : <p className="crm-card p-5 text-sm text-muted-foreground">Your access: <b className="text-foreground">{LEVELS.find(l => l.value === level)?.label}</b>. The company owner manages the connection and who can see Clients.</p>}
  </div>
}

function OwnerSettings({ onConnected }: { onConnected: () => void }) {
  const [data, setData] = useState<SettingsData | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setData(await api<SettingsData>('/api/tracker/settings')); setError('') } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect -- initial fetch
  if (error && !data) return <p role="alert" className="crm-card p-5 text-sm text-destructive">{error}</p>
  if (!data) return <ScreenLoader kind="settings" />
  if (!data.ready) return <section className="crm-card space-y-2 p-5"><h2 className="font-semibold">One database update needed</h2><p className="text-sm text-muted-foreground">Run <code>supabase/numera/006_client_tracker.sql</code> in the Supabase SQL Editor, then reload this page.</p></section>
  return <>
    <Connection data={data} onSaved={load} onConnected={onConnected} />
    <People people={data.people} onSaved={load} />
  </>
}

/** Saves the script as a file (works even where copying to the clipboard is blocked). */
function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url; a.download = 'crm-connect.gs'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return <button type="button" className={buttonClass} onClick={() => {
    const ok = () => { setDone(true); setTimeout(() => setDone(false), 1500) }
    const fallback = () => { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { if (document.execCommand('copy')) ok() } finally { t.remove() } }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback()
  }}>{done ? <Check size={14} /> : <Copy size={14} />}{done ? 'Copied' : label}</button>
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
  const [ownKey, setOwnKey] = useState('')
  const saveOwnKey = () => run('own', async () => {
    await api('/api/tracker/settings', sendJson('POST', { action: 'set_key', key: ownKey }))
    setOwnKey(''); setMessage({ ok: true, text: 'Key saved. Now press Test connection.' }); onSaved()
  })
  const test = () => run('test', async () => {
    const result = await api<{ version: number | null; latest: number }>('/api/tracker/settings', sendJson('POST', { action: 'test' }))
    setMessage({ ok: true, text: result.version && result.version < result.latest ? 'Connected, but the script file is out of date. Copy the latest script and deploy a new version.' : 'Connected. The Client Tracker can read the Sheet.' })
    onConnected()
  })
  const connected = !!data.connection.url && data.connection.hasKey
  const filled = data.script.source.replace("const CRM_URL = 'PASTE-CRM-ADDRESS';", `const CRM_URL = '${typeof window === 'undefined' ? '' : window.location.origin}';`)
  const script = key ? filled.replace("const CRM_KEY = 'PASTE-KEY-HERE';", `const CRM_KEY = '${key}';`) : filled
  return <section className="crm-card space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><Icon3D name="plug" size={36} /><h2 className="font-semibold">Google Sheet connection</h2>{connected && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Connected</span>}</div>
      <button className={buttonClass} disabled={!!busy || !connected} onClick={() => void test()}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
    </div>
    {message && <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>{message.text}</p>}
    <details open={!connected} className="text-sm"><summary className="cursor-pointer font-medium">{connected ? `Set up or update the script (version ${data.script.version})` : 'Set up in five steps'}</summary>
    <ol className="mt-4 list-none space-y-5 text-sm">
      <li className="space-y-2"><p className="font-medium">1. Create a private key</p>
        {key ? <div className="space-y-2 rounded-2xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Shown only now. It is already filled into the script in step 2, so you do not need to paste it anywhere else.</p><div className="flex flex-wrap items-center gap-2"><code className="select-all break-all rounded-lg bg-background px-2 py-1 text-xs">{key}</code><CopyButton text={key} label="Copy key" /></div></div>
          : <div className="flex flex-wrap items-center gap-2"><button className={buttonClass} disabled={!!busy} onClick={() => void newKey()}><KeyRound size={14} />{data.connection.hasKey ? 'Create a new key' : 'Create key'}</button>{data.connection.hasKey && <span className="text-xs text-muted-foreground">A key exists. A new key stops the old one working until the script has the new one.</span>}</div>}
      </li>
      <li className="space-y-2"><p className="font-medium">2. Add the script file</p>
        <p className="text-muted-foreground">Open the &quot;Numera Automation&quot; Apps Script project → <b>+</b> next to Files → Script → name it <code>crm-connect</code>. Delete everything in that new file (including <code>function myFunction</code>), paste the whole script and save. Your main <code>numera-crm-v3.gs</code> stays as it is.</p>
        <p className="text-muted-foreground">{key ? 'Your new key and this CRM’s address are already filled in.' : <>Create a key first (step 1) so it is filled in for you, or replace <code>PASTE-KEY-HERE</code> with the key already in your script.</>} About {script.split('\n').length} lines.</p>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={script} label={`Copy script (version ${data.script.version})`} />
          <button type="button" className={buttonClass} onClick={() => download(script)}><Download size={14} />Download crm-connect.gs</button>
        </div>
        <textarea readOnly value={script} onFocus={e => e.currentTarget.select()} aria-label="Script" rows={10} spellCheck={false}
          className="w-full rounded-2xl border border-border bg-muted/60 p-3 font-mono text-[11px] leading-relaxed" />

      </li>
      <li className="space-y-2"><p className="font-medium">3. Deploy it as a web app</p>
        <p className="text-muted-foreground">In Apps Script: <b>Deploy → New deployment</b> → type <b>Web app</b>. Execute as <b>Me</b>, Who has access <b>Anyone</b> (the key keeps it private). Approve the permissions, then copy the <b>Web app URL</b>. After changing the script later, use Deploy → Manage deployments → edit → New version.</p>
        <div className="flex flex-wrap gap-2"><input className={`${inputClass} min-w-0 flex-1`} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" aria-label="Web app URL" /><button className={primaryButton} disabled={!!busy || url.trim() === (data.connection.url ?? '')} onClick={() => void saveUrl()}>{busy === 'url' ? 'Saving…' : 'Save link'}</button></div>
      </li>
      <li className="space-y-2"><p className="font-medium">4. Test</p>
        <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">The test says the script rejected the key?</summary>
          <div className="mt-2 space-y-2"><p className="text-muted-foreground">Copy the key that is in your deployed script (the text between the quotes on the <code>CRM_KEY</code> line) and paste it here. Then the CRM uses the same key and you do not need to deploy again.</p>
            <div className="flex flex-wrap gap-2"><input className={`${inputClass} min-w-0 flex-1 font-mono`} value={ownKey} onChange={e => setOwnKey(e.target.value)} placeholder="Key from the CRM_KEY line" aria-label="Key from the script" autoComplete="off" /><button type="button" className={buttonClass} disabled={!!busy || ownKey.trim().length < 20} onClick={() => void saveOwnKey()}>Use this key</button></div>
            <p className="text-xs text-muted-foreground">Still rejected? The live web app runs the version from the last deploy: after saving the script, use Deploy → Manage deployments → pencil → Version: New version → Deploy.</p></div>
        </details>
        <button className={buttonClass} disabled={!!busy || !connected} onClick={() => void test()}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
      </li>
      <li className="space-y-2"><p className="font-medium">5. Turn on instant updates (once)</p>
        <p className="text-muted-foreground">In Apps Script, open <code>crm-connect.gs</code>, choose <b>crmSetup</b> in the function list next to Run, press <b>Run</b> and allow. Form answers and Sheet edits then show here within seconds.</p>
      </li>
    </ol>
    </details>
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
    <div className="flex items-center gap-3"><Icon3D name="conference-call" size={36} /><h2 className="font-semibold">Who can open Clients</h2></div>
    <ul className="mt-4 divide-y divide-border">{people.map(p => <li key={p.user_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{p.name}{p.you && <span className="text-muted-foreground"> (you)</span>}</p><p className="truncate text-xs text-muted-foreground">{p.email}{p.account_role === 'admin' ? ' · CRM admin' : ''}</p></div>
      {p.level === 'owner' ? <span className="text-sm text-muted-foreground">Owner · always full access</span>
        : <select className={`${inputClass} w-full sm:w-56`} value={p.level ?? ''} disabled={busy === p.user_id} onChange={e => void change(p, e.target.value)} aria-label={`Clients access for ${p.name}`}>
          {LEVELS.map(l => <option key={l.value} value={l.value} title={l.hint}>{l.label}</option>)}
        </select>}
    </li>)}</ul>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </section>
}
