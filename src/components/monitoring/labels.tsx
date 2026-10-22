'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import type { MonitoringLabel } from '@/lib/monitoring/workflow-types'
import { api, buttonClass, inputClass, LabelChip, primaryButton, sendJson } from './ui'

export const labelPalette = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b']

export function useLabels(refresh = 0) {
  const [labels, setLabels] = useState<MonitoringLabel[]>([])
  const [ready, setReady] = useState<boolean | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api<{ labels: MonitoringLabel[]; workflowReady: boolean }>('/api/monitoring/labels', { signal: controller.signal })
      .then(data => { setLabels(data.labels); setReady(data.workflowReady) })
      .catch(() => { if (!controller.signal.aborted) setReady(null) })
    return () => controller.abort()
  }, [refresh, revision])
  const reload = useCallback(() => setRevision(n => n + 1), [])
  return { labels, ready, reload }
}

export function LabelsSettings({ labels, ready, onChanged }: { labels: MonitoringLabel[]; ready: boolean | null; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(labelPalette[5])
  const [description, setDescription] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action(); onChanged() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <section className="crm-card p-6">
    <div className="flex items-center gap-2"><Tag size={18} className="text-primary" /><h3 className="text-base font-semibold">Labels</h3></div>
    <p className="mt-1 text-sm text-muted-foreground">Tag chats and filter the inbox by them.</p>
    {ready === false && <p role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Labels need the inbox database update. Run <code>supabase/numera/001_inbox_workflow.sql</code> in Supabase first.</p>}
    <form className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; void run(async () => { await api('/api/monitoring/labels', sendJson('POST', { name, color, description: description || null })); setName(''); setDescription('') }) }}>
      <label className="text-xs font-medium text-muted-foreground">Name<input className={inputClass} value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="Hot lead" disabled={ready === false} /></label>
      <label className="text-xs font-medium text-muted-foreground">Description (optional)<input className={inputClass} value={description} maxLength={200} onChange={e => setDescription(e.target.value)} disabled={ready === false} /></label>
      <div className="flex items-end"><button className={primaryButton} disabled={busy || !name.trim() || ready === false}><Plus size={16} />Add label</button></div>
      <fieldset className="md:col-span-3"><legend className="mb-1 text-xs font-medium text-muted-foreground">Colour</legend><div className="flex flex-wrap gap-2">{labelPalette.map(c => <button type="button" key={c} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`flex size-7 items-center justify-center rounded-full ring-offset-2 ${color === c ? 'ring-2 ring-primary' : ''}`} style={{ backgroundColor: c }}>{color === c && <Check size={14} className="text-white" />}</button>)}</div></fieldset>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <ul className="mt-5 divide-y divide-border rounded-lg border border-border">{labels.map(label => <li key={label.id} className="flex flex-wrap items-center gap-3 p-3">
      {editing === label.id ? <EditLabel label={label} busy={busy} onCancel={() => setEditing(null)} onSave={value => run(async () => { await api(`/api/monitoring/labels/${label.id}`, sendJson('PATCH', value)); setEditing(null) })} />
        : <><LabelChip label={label} /><span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{label.description}</span>
          <button className={buttonClass} aria-label={`Edit ${label.name}`} onClick={() => setEditing(label.id)}><Pencil size={14} /></button>
          <button className={buttonClass} aria-label={`Delete ${label.name}`} disabled={busy} onClick={() => { if (window.confirm(`Delete “${label.name}”? It is removed from every conversation. Messages are not affected.`)) void run(() => api(`/api/monitoring/labels/${label.id}`, { method: 'DELETE' })) }}><Trash2 size={14} /></button></>}
    </li>)}{labels.length === 0 && <li className="p-4 text-sm text-muted-foreground">No labels yet.</li>}</ul>
  </section>
}

function EditLabel({ label, busy, onSave, onCancel }: { label: MonitoringLabel; busy: boolean; onSave: (value: Partial<MonitoringLabel>) => void; onCancel: () => void }) {
  const [name, setName] = useState(label.name), [color, setColor] = useState(label.color), [description, setDescription] = useState(label.description ?? '')
  return <form className="flex w-full flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); onSave({ name, color, description: description || null }) }}>
    <input aria-label="Label name" className={inputClass + ' max-w-48'} value={name} maxLength={40} onChange={e => setName(e.target.value)} />
    <input aria-label="Label description" className={inputClass + ' max-w-72'} value={description} maxLength={200} onChange={e => setDescription(e.target.value)} />
    <div className="flex gap-1">{labelPalette.map(c => <button type="button" key={c} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`size-5 rounded-full ${color === c ? 'ring-2 ring-primary ring-offset-1' : ''}`} style={{ backgroundColor: c }} />)}</div>
    <button className={primaryButton} disabled={busy || !name.trim()}>Save</button><button type="button" className={buttonClass} onClick={onCancel}>Cancel</button>
  </form>
}

/** Checklist of company labels for one conversation. */
export function LabelPicker({ labels, selected, disabled, onChange }: { labels: MonitoringLabel[]; selected: string[]; disabled?: boolean; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const shown = labels.filter(l => l.name.toLowerCase().includes(query.toLowerCase()))
  return <div className="w-64 p-1">
    <input autoFocus aria-label="Search labels" className={inputClass} placeholder="Search labels" value={query} onChange={e => setQuery(e.target.value)} />
    <ul className="mt-1 max-h-64 overflow-y-auto">{shown.map(label => {
      const on = selected.includes(label.id)
      return <li key={label.id}><button type="button" disabled={disabled} role="menuitemcheckbox" aria-checked={on} onClick={() => onChange(on ? selected.filter(id => id !== label.id) : [...selected, label.id])} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} /><span className="flex-1 truncate">{label.name}</span>{on && <Check size={14} className="text-primary" />}
      </button></li>
    })}</ul>
    {labels.length === 0 && <p className="p-2 text-xs text-muted-foreground">Create labels in Settings → Labels.</p>}
  </div>
}
