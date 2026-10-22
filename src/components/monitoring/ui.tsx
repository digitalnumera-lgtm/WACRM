'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { easeOut } from './motion'
import { ArrowDown, ArrowUp, ChevronsUp, Minus, SignalHigh } from 'lucide-react'
import type { ConversationPriority, MonitoringLabel } from '@/lib/monitoring/workflow-types'

export const inputClass = 'w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-foreground/30 focus:ring-2 focus:ring-[var(--hl)]/60'
export const buttonClass = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium transition-[color,background-color,transform] duration-150 hover:bg-muted active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40'
export const primaryButton = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40'

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(value.error ?? 'Unable to load monitoring data.'), { code: value.code, body: value })
  return value as T
}
export const sendJson = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Compact Chatwoot-style relative time: now, 5m, 3h, Yesterday, Mon, 12 Oct. */
export function timeAgo(value: string | null | undefined, now = Date.now()) {
  if (!value) return ''
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return ''
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const date = new Date(at), today = new Date(now)
  if (date.toDateString() === today.toDateString()) return `${Math.floor(seconds / 3600)}h`
  const yesterday = new Date(now - 86400000)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  if (seconds < 6 * 86400) return date.toLocaleDateString(undefined, { weekday: 'short' })
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? { year: '2-digit' } : {}) })
}

/** Waiting duration for a customer who spoke last: 45m, 3h, 2d. */
export function waitingFor(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

const avatarColors = ['bg-[#E9F0C2] text-[#4A5A00]', 'bg-[#E3E8EF] text-[#334155]', 'bg-[#EFE7DA] text-[#6B4F1D]', 'bg-[#DDEEE6] text-[#1F5C45]', 'bg-[#E8E3F1] text-[#4B3F72]'].map(c => `${c} dark:bg-white/10 dark:text-[#E6E7E3]`)
export const colorFor = (seed: string) => avatarColors[Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) % avatarColors.length]
export function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '#'
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase()
}
export function Avatar({ name, seed, size = 'md' }: { name: string; seed: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'size-7 text-xs', md: 'size-10 text-sm', lg: 'size-16 text-xl' }
  return <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${sizes[size]} ${colorFor(seed)}`}>{initials(name)}</span>
}

export function LabelChip({ label, onRemove }: { label: MonitoringLabel; onRemove?: () => void }) {
  return <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs font-medium text-foreground">
    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} /><span className="truncate">{label.name}</span>
    {onRemove && <button type="button" aria-label={`Remove label ${label.name}`} className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={onRemove}>×</button>}
  </span>
}

export const priorityMeta: Record<ConversationPriority, { label: string; className: string; icon: typeof ArrowUp }> = {
  none: { label: 'No priority', className: 'text-muted-foreground', icon: Minus },
  low: { label: 'Low', className: 'text-slate-500', icon: ArrowDown },
  medium: { label: 'Medium', className: 'text-amber-600', icon: SignalHigh },
  high: { label: 'High', className: 'text-orange-600', icon: ArrowUp },
  urgent: { label: 'Urgent', className: 'text-red-600', icon: ChevronsUp },
}
export function PriorityIcon({ priority, size = 14 }: { priority?: ConversationPriority; size?: number }) {
  if (!priority || priority === 'none') return null
  const meta = priorityMeta[priority]
  const Icon = meta.icon
  return <span title={`${meta.label} priority`} className={`inline-flex ${meta.className}`}><Icon size={size} aria-label={`${meta.label} priority`} /></span>
}

/** Small accessible dropdown menu that closes on outside click / Escape. */
export function Menu({ trigger, label, children, align = 'right', disabled, triggerClass = buttonClass }: { trigger: ReactNode; label: string; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; disabled?: boolean; triggerClass?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const click = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', click); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key) }
  }, [open])
  return <div ref={root} className="relative">
    <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} className={triggerClass} onClick={() => setOpen(v => !v)}>{trigger}</button>
    <AnimatePresence>{open && <m.div role="menu" initial={{ opacity: 0, scale: 0.96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }} transition={{ duration: 0.16, ease: easeOut }}
      className={`absolute z-30 mt-1 min-w-48 rounded-2xl border border-border bg-popover p-1.5 shadow-xl ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'}`}>{children(() => setOpen(false))}</m.div>}</AnimatePresence>
  </div>
}
export function MenuItem({ children, onClick, active }: { children: ReactNode; onClick: () => void; active?: boolean }) {
  return <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted ${active ? 'font-semibold' : ''}`}>{children}</button>
}
