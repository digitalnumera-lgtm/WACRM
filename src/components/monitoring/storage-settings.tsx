'use client'

import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import type { StorageSettings as Settings } from '@/lib/monitoring/storage'
import { api, buttonClass, inputClass, primaryButton, sendJson } from './ui'

type Snapshot = { settings: Settings; usage: { objects: number; bytes: number } | null; plan_bytes: number; ready: boolean; cleanup?: { removed: number; bytes: number } }
const MB = 1024 * 1024
const mb = (bytes: number) => bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(2)} GB` : `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`
const kinds = [
  { id: 'image', label: 'Photos' }, { id: 'audio', label: 'Voice notes' }, { id: 'sticker', label: 'Stickers' },
  { id: 'video', label: 'Videos' }, { id: 'document', label: 'Documents' },
] as const

/** Settings → Storage: saved-media usage, limit, cleanup rules. */
export function StorageSettings() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [form, setForm] = useState<{ cap: string; idleOn: boolean; idle: string; auto: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const load = (value: Snapshot) => {
    setData(value)
    setForm({ cap: String(value.settings.cap_mb), idleOn: value.settings.idle_days !== null, idle: String(value.settings.idle_days ?? 7), auto: value.settings.auto_save })
  }
  useEffect(() => {
    const controller = new AbortController()
    api<Snapshot>('/api/monitoring/storage', { signal: controller.signal }).then(load).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [])
  async function run(request: Promise<Snapshot>, done: (value: Snapshot) => string) {
    setBusy(true); setError(''); setNotice('')
    try { const value = await request; load(value); setNotice(done(value)) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const removed = (value: Snapshot) => value.cleanup?.removed ? `Removed ${value.cleanup.removed} files (${mb(value.cleanup.bytes)}).` : 'Nothing needed removing.'
  const used = data?.usage?.bytes ?? 0
  const cap = (data?.settings.cap_mb ?? 800) * MB
  const percent = Math.min(100, Math.round((used / cap) * 100))

  return <section className="crm-card p-5">
    <div className="flex items-center gap-2"><HardDrive size={18} className="text-primary" /><h2 className="text-lg font-semibold">Media storage</h2></div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {data && !data.ready && <p className="mt-3 text-sm text-amber-700">Storage tools need the latest database update.</p>}
    {data && form && <>
      <div className="mt-4">
        <div className="flex justify-between text-sm"><span><b>{mb(used)}</b> of {mb(cap)} limit · {data.usage?.objects.toLocaleString() ?? 0} files</span><span className="text-muted-foreground">Free plan: {mb(data.plan_bytes)}</span></div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Storage used">
          <div className={`h-full rounded-full ${percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">WhatsApp keeps media for 7 days. Saved copies stay viewable here; opening a chat keeps its media.</p>
      </div>
      <form className="mt-5 grid gap-5 lg:grid-cols-3" onSubmit={e => {
        e.preventDefault()
        void run(api<Snapshot>('/api/monitoring/storage', sendJson('PATCH', { cap_mb: Number(form.cap), idle_days: form.idleOn ? Number(form.idle) : null, auto_save: form.auto })), value => `Saved. ${removed(value)}`)
      }}>
        <fieldset><legend className="text-sm font-medium">Save automatically</legend>
          <div className="mt-2 flex flex-wrap gap-2">{kinds.map(k => <label key={k.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${form.auto.includes(k.id) ? 'border-transparent bg-primary text-primary-foreground' : 'border-border'}`}>
            <input type="checkbox" className="sr-only" checked={form.auto.includes(k.id)} onChange={e => setForm({ ...form, auto: e.target.checked ? [...form.auto, k.id] : form.auto.filter(x => x !== k.id) })} />{k.label}</label>)}</div>
          <p className="mt-2 text-xs text-muted-foreground">Others are saved when opened.</p>
        </fieldset>
        <label className="text-sm font-medium">Storage limit (MB)<input className={`${inputClass} mt-2`} type="number" min={50} max={100000} required value={form.cap} onChange={e => setForm({ ...form, cap: e.target.value })} />
          <span className="mt-2 block text-xs font-normal text-muted-foreground">Over the limit, files from the least recently opened chats are removed first.</span></label>
        <div className="text-sm font-medium">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.idleOn} onChange={e => setForm({ ...form, idleOn: e.target.checked })} />Remove media from chats not opened for</label>
          <div className="mt-2 flex items-center gap-2"><input className={`${inputClass} w-24`} type="number" min={1} max={365} disabled={!form.idleOn} value={form.idle} onChange={e => setForm({ ...form, idle: e.target.value })} /><span className="font-normal">days</span></div>
          <span className="mt-2 block text-xs font-normal text-amber-700">Removed files cannot be reloaded once WhatsApp’s 7 days have passed.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:col-span-3">
          <button className={primaryButton} disabled={busy}>{busy ? 'Working…' : 'Save'}</button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void run(api<Snapshot>('/api/monitoring/storage', sendJson('POST', {})), removed)}>Clean up now</button>
          {notice && <span role="status" className="text-sm text-muted-foreground">{notice}</span>}
          {!notice && data.settings.last_cleanup && <span className="text-xs text-muted-foreground">Last cleanup {new Date(data.settings.last_cleanup.at).toLocaleString()}: {data.settings.last_cleanup.removed} files</span>}
        </div>
      </form>
    </>}
  </section>
}
