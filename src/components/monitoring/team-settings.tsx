'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, Pencil, Plus, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react'
import type { MonitoringChannel } from '@/lib/monitoring/types'
import { PERMISSION_GROUPS, type Permission } from '@/lib/monitoring/permissions'
import { api, Avatar, buttonClass, inputClass, primaryButton, sendJson } from './ui'

type Role = { id: string; name: string; description: string | null; permissions: Permission[]; members: number }
type Member = { user_id: string; name: string; email: string | null; account_role: string; full: boolean; role_id: string | null; channel_ids: string[] | null; you: boolean }
type Invite = { id: string; email: string; role_id: string | null; channel_ids: string[] | null; expires_at: string }
type Team = { ready: boolean; domain: string; roles: Role[]; members: Member[]; invites: Invite[] }
type Access = { access: string; channels: string[] | null }

/** Settings → Team & roles (owners and admins). */
export function TeamSettings({ channels }: { channels: MonitoringChannel[] }) {
  const [team, setTeam] = useState<Team | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    api<Team>('/api/monitoring/team', { signal: controller.signal }).then(data => { setTeam(data); setError('') }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [revision])
  const roleName = (m: { full?: boolean; account_role?: string; role_id: string | null }) =>
    m.account_role === 'owner' ? 'Owner' : m.full || m.role_id === null ? 'Admin' : team?.roles.find(r => r.id === m.role_id)?.name ?? 'No role'
  const numbers = (ids: string[] | null) => ids === null ? 'All numbers'
    : !channels.length ? `${ids.length} number${ids.length === 1 ? '' : 's'}`
      : ids.map(id => channels.find(c => c.id === id)?.label ?? 'Removed number').join(', ') || 'No numbers'

  return <section className="rounded-2xl border border-border bg-card p-5">
    <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-primary" /><h2 className="text-lg font-semibold">Team &amp; roles</h2></div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {team && !team.ready && <p className="mt-3 text-sm text-amber-700">Team access needs the latest database update.</p>}
    {team?.ready && <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        <InviteForm team={team} channels={channels} onDone={reload} />
        <div>
          <h3 className="mb-2 text-sm font-semibold">Members · {team.members.length}</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">{team.members.map(m => <MemberRow key={m.user_id} member={m} team={team} channels={channels} label={roleName(m)} numbers={numbers(m.full ? null : m.channel_ids)} onDone={reload} />)}</ul>
        </div>
        {team.invites.length > 0 && <div>
          <h3 className="mb-2 text-sm font-semibold">Pending invitations · {team.invites.length}</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">{team.invites.map(i => <li key={i.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{i.email}</p><p className="text-xs text-muted-foreground">{roleName({ role_id: i.role_id })} · {numbers(i.role_id ? i.channel_ids : null)} · expires {new Date(i.expires_at).toLocaleDateString()}</p></div>
            <button className={buttonClass} onClick={async () => { try { await api(`/api/monitoring/team/invites/${i.id}`, { method: 'DELETE' }); reload() } catch (e) { setError((e as Error).message) } }}>Cancel</button>
          </li>)}</ul>
        </div>}
      </div>
      <Roles roles={team.roles} onDone={reload} />
    </div>}
  </section>
}

function AccessPicker({ value, onChange, roles, channels }: { value: Access; onChange: (v: Access) => void; roles: Role[]; channels: MonitoringChannel[] }) {
  const admin = value.access === 'admin'
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm font-medium">Role<select className={`${inputClass} mt-1`} value={value.access} onChange={e => onChange({ ...value, access: e.target.value })}>
      <option value="" disabled>Choose a role</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}<option value="admin">Admin (full access)</option></select></label>
    <fieldset className="text-sm font-medium" disabled={admin}><legend>Numbers they can see</legend>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Chip on={admin || value.channels === null} onClick={() => onChange({ ...value, channels: value.channels === null ? [] : null })}>All numbers</Chip>
        {!admin && value.channels !== null && channels.map(c => <Chip key={c.id} on={value.channels!.includes(c.id)} onClick={() => onChange({ ...value, channels: value.channels!.includes(c.id) ? value.channels!.filter(x => x !== c.id) : [...value.channels!, c.id] })}>{c.label}</Chip>)}
      </div>
    </fieldset>
  </div>
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${on ? 'border-[#121316] bg-[#121316] text-white' : 'border-border hover:bg-muted'}`}>{on && <Check size={12} />}{children}</button>
}

const accessBody = (v: Access) => ({ access: v.access, channel_ids: v.access === 'admin' ? null : v.channels })
const accessReady = (v: Access) => !!v.access && (v.access === 'admin' || v.channels === null || v.channels.length > 0)

function InviteForm({ team, channels, onDone }: { team: Team; channels: MonitoringChannel[]; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [access, setAccess] = useState<Access>({ access: team.roles[0]?.id ?? '', channels: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState<{ url: string; email: string } | null>(null)
  const [copied, setCopied] = useState(false)
  return <form className="space-y-3 rounded-xl border border-border bg-muted/30 p-4" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError(''); setLink(null); setCopied(false)
    try {
      const data = await api<{ url: string; invite: Invite }>('/api/monitoring/team/invites', sendJson('POST', { email, ...accessBody(access) }))
      setLink({ url: data.url, email: data.invite.email }); setEmail(''); onDone()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>
    <h3 className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={16} />Invite a team member</h3>
    <input className={inputClass} type="email" required placeholder={`name@${team.domain}`} aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} />
    <AccessPicker value={access} onChange={setAccess} roles={team.roles} channels={channels} />
    <button className={primaryButton} disabled={busy || !email || !accessReady(access)}>{busy ? 'Creating…' : 'Create invite link'}</button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {link && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
      <p>Send this link to <b>{link.email}</b>. It works once, for that email only, for 7 days.</p>
      <div className="mt-2 flex gap-2"><input readOnly aria-label="Invite link" className={`${inputClass} bg-white`} value={link.url} onFocus={e => e.target.select()} />
        <button type="button" className={buttonClass} onClick={() => { void navigator.clipboard?.writeText(link.url); setCopied(true) }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button></div>
    </div>}
  </form>
}

function MemberRow({ member, team, channels, label, numbers, onDone }: { member: Member; team: Team; channels: MonitoringChannel[]; label: string; numbers: string; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<Access>({ access: member.full ? 'admin' : member.role_id ?? '', channels: member.channel_ids })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = member.account_role === 'owner' || member.you
  async function act(request: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await request(); setEditing(false); onDone() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <li className="p-3 text-sm">
    <div className="flex flex-wrap items-center gap-3">
      <Avatar name={member.name} seed={member.email ?? member.user_id} size="sm" />
      <div className="min-w-[9rem] flex-1"><p className="truncate font-medium">{member.name}{member.you && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</p><p className="truncate text-xs text-muted-foreground">{member.email}</p></div>
      <div className="order-last basis-full pl-10 sm:order-none sm:basis-auto sm:pl-0 sm:text-right"><p className="font-medium">{label}</p><p className="text-xs text-muted-foreground">{numbers}</p></div>
      {!locked && <div className="flex gap-1">
        <button className={`${buttonClass} px-2`} aria-label={`Edit ${member.name}`} onClick={() => setEditing(v => !v)}><Pencil size={14} /></button>
        <button className={`${buttonClass} px-2`} aria-label={`Remove ${member.name}`} disabled={busy} onClick={() => { if (window.confirm(`Remove ${member.name} from the team? Their login will no longer open this CRM.`)) void act(() => api(`/api/monitoring/team/members/${member.user_id}`, { method: 'DELETE' })) }}><Trash2 size={14} /></button>
      </div>}
    </div>
    {editing && <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
      <AccessPicker value={value} onChange={setValue} roles={team.roles} channels={channels} />
      <div className="flex gap-2"><button className={primaryButton} disabled={busy || !accessReady(value)} onClick={() => void act(() => api(`/api/monitoring/team/members/${member.user_id}`, sendJson('PATCH', accessBody(value))))}>Save</button><button className={buttonClass} onClick={() => setEditing(false)}>Cancel</button></div>
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </li>
}

function Roles({ roles, onDone }: { roles: Role[]; onDone: () => void }) {
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const [error, setError] = useState('')
  return <div>
    <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Roles · {roles.length}</h3><button className={buttonClass} onClick={() => setEditing('new')}><Plus size={14} />New role</button></div>
    {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
    {editing && <RoleEditor role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onDone() }} />}
    <ul className="space-y-2">{roles.map(r => <li key={r.id} className="rounded-xl border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.description || `${r.permissions.length} permissions`} · {r.members} member{r.members === 1 ? '' : 's'}</p></div>
        <button className={`${buttonClass} px-2`} aria-label={`Edit role ${r.name}`} onClick={() => setEditing(r)}><Pencil size={14} /></button>
        <button className={`${buttonClass} px-2`} aria-label={`Delete role ${r.name}`} onClick={async () => { if (!window.confirm(`Delete the role “${r.name}”?`)) return; try { await api(`/api/monitoring/team/roles/${r.id}`, { method: 'DELETE' }); setError(''); onDone() } catch (e) { setError((e as Error).message) } }}><Trash2 size={14} /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">{PERMISSION_GROUPS.flatMap(g => g.items).filter(i => r.permissions.includes(i.key)).map(i => <span key={i.key} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">{i.label}</span>)}</div>
    </li>)}</ul>
    {!roles.length && <p className="text-sm text-muted-foreground">Create a role, then invite people with it.</p>}
  </div>
}

function RoleEditor({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? ['view_inbox', 'view_media'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (key: Permission) => setPermissions(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key])
  return <form className="mb-3 space-y-3 rounded-xl border border-primary/40 bg-card p-4 shadow-sm" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('')
    try { await api(role ? `/api/monitoring/team/roles/${role.id}` : '/api/monitoring/team/roles', sendJson(role ? 'PATCH' : 'POST', { name, description, permissions })); onSaved() }
    catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>
    <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">{role ? 'Edit role' : 'New role'}</h4><button type="button" aria-label="Close" className="text-muted-foreground" onClick={onClose}><X size={16} /></button></div>
    <input className={inputClass} required maxLength={60} placeholder="Role name, e.g. Sales supervisor" aria-label="Role name" value={name} onChange={e => setName(e.target.value)} />
    <input className={inputClass} maxLength={200} placeholder="Short description (optional)" aria-label="Description" value={description} onChange={e => setDescription(e.target.value)} />
    {PERMISSION_GROUPS.map(group => <fieldset key={group.title}><legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</legend>
      <div className="mt-1 space-y-1">{group.items.map(item => { const always = item.key === 'view_inbox'; return <label key={item.key} title={item.hint} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
        <span>{item.label}</span>
        <input type="checkbox" role="switch" className="size-4 accent-[#121316]" checked={always || permissions.includes(item.key)} disabled={always} onChange={() => toggle(item.key)} />
      </label> })}</div>
    </fieldset>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button className={primaryButton} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save role'}</button>
  </form>
}
