'use client'

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { DEFAULT_PREFERENCES, MAX_PINNED, sanitizePreferences, type CrmStyle, type Preferences } from '@/lib/monitoring/preferences'
import { sendJson } from './ui'
import { ActivePill } from './motion'

type Ctx = { prefs: Preferences; update: (patch: Partial<Preferences>) => void; saving: boolean; error: string }
const PreferencesContext = createContext<Ctx>({ prefs: DEFAULT_PREFERENCES, update: () => {}, saving: false, error: '' })

export function PreferencesProvider({ initial, children }: { initial: Preferences; children: ReactNode }) {
  const [prefs, setPrefs] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const changed = useRef(false)
  const timer = useRef<number | null>(null)
  const latest = useRef(prefs)

  // The page renders with the preferences in the session token; fetch the
  // current copy in case they changed on another device.
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/monitoring/preferences', { cache: 'no-store', signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.preferences && !changed.current) { latest.current = sanitizePreferences(data.preferences); setPrefs(latest.current) } })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const update = useCallback((patch: Partial<Preferences>) => {
    changed.current = true
    latest.current = sanitizePreferences({ ...latest.current, ...patch })
    setPrefs(latest.current)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      setSaving(true); setError('')
      try {
        const response = await fetch('/api/monitoring/preferences', sendJson('PUT', { preferences: latest.current }))
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not save preferences.')
      } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
    }, 500)
  }, [])

  return <PreferencesContext.Provider value={{ prefs, update, saving, error }}>{children}</PreferencesContext.Provider>
}

export const usePreferences = () => useContext(PreferencesContext)

const darkQuery = '(prefers-color-scheme: dark)'
function subscribe(callback: () => void) {
  const media = window.matchMedia(darkQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
/** 'system' follows the device setting. */
export function useDarkMode(theme: Preferences['theme']) {
  const systemDark = useSyncExternalStore(subscribe, () => window.matchMedia(darkQuery).matches, () => false)
  return theme === 'dark' || (theme === 'system' && systemDark)
}

export function useClock() {
  const { prefs } = usePreferences()
  return useCallback((value: string | number | Date, withDate = false) => new Date(value).toLocaleString([], {
    ...(withDate ? { day: 'numeric', month: 'short' } : {}), hour: 'numeric', minute: '2-digit', hour12: prefs.timeFormat === '12h',
  }), [prefs.timeFormat])
}

export function togglePinned(pinned: string[], id: string) {
  return pinned.includes(id) ? pinned.filter(x => x !== id) : [id, ...pinned].slice(0, MAX_PINNED)
}

// One shared audio context, unlocked by the first click or key press on the
// page (browsers block sound until the user has interacted).
let audio: AudioContext | null = null
function audioContext() {
  if (typeof window === 'undefined') return null
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  audio ??= new Ctx()
  return audio
}
if (typeof window !== 'undefined') {
  const unlock = () => { void audioContext()?.resume() }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

/** Two short notes for a new customer message (Web Audio, no file needed). */
export function playChime() {
  const ctx = audioContext()
  if (!ctx) return
  void ctx.resume().then(() => {
    const start = ctx.currentTime
    for (const [offset, frequency] of [[0, 784], [0.14, 1047]] as const) {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start + offset); osc.stop(start + offset + 0.32)
    }
  }).catch(() => {})
}

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const id = useId()
  return <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full bg-muted p-1">
    {options.map(o => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
      className={`relative isolate rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${value === o.value ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
      {value === o.value && <ActivePill id={`${id}-pill`} className="rounded-full bg-primary shadow-sm" />}{o.label}</button>)}
  </div>
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-b border-border py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-medium">{title}</p>{children}</div>
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
    <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
  </button>
}

// Swatch colours only; the real palettes live in globals.css ([data-style]).
const styleSwatches: { id: CrmStyle; name: string; canvas: string; card: string; ink: string; accent: string }[] = [
  { id: 'numera', name: 'Numera', canvas: '#f0f2ec', card: '#ffffff', ink: '#121316', accent: '#c0dd11' },
  { id: 'lavender', name: 'Lavender', canvas: 'linear-gradient(135deg, #dfe5ff, #f7e4f5)', card: '#ffffff', ink: '#1d1a3a', accent: '#5b3df5' },
  { id: 'blue', name: 'Clear blue', canvas: '#eef2f9', card: '#ffffff', ink: '#0f172a', accent: '#2563eb' },
  { id: 'glass', name: 'Glass', canvas: 'linear-gradient(135deg, #d4e1f3, #edf0d8)', card: 'rgb(255 255 255 / 0.6)', ink: '#0e1116', accent: '#f2e64d' },
  { id: 'mono', name: 'Mono', canvas: '#f3f2ee', card: '#ffffff', ink: '#151515', accent: '#151515' },
  { id: 'sky', name: 'Sky', canvas: 'linear-gradient(180deg, #c6daf1, #edf3f9)', card: '#ffffff', ink: '#1c2633', accent: '#2f7fe0' },
]

function StylePicker({ value, onChange }: { value: CrmStyle; onChange: (v: CrmStyle) => void }) {
  return <div role="radiogroup" aria-label="Style" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
    {styleSwatches.map(s => <button key={s.id} type="button" role="radio" aria-checked={value === s.id} onClick={() => onChange(s.id)}
      className={`group rounded-2xl p-1.5 text-left transition-shadow ${value === s.id ? 'ring-2 ring-primary' : 'ring-1 ring-border hover:ring-muted-foreground/40'}`}>
      <span aria-hidden="true" className="flex h-20 gap-1.5 rounded-xl p-2" style={{ background: s.canvas }}>
        <span className="flex w-4 flex-col items-center gap-1 rounded-md py-1" style={{ background: s.ink }}><span className="size-2 rounded-full" style={{ background: s.accent === s.ink ? '#ffffff' : s.accent }} /></span>
        <span className="flex flex-1 flex-col justify-between rounded-md p-1.5 shadow-sm" style={{ background: s.card }}>
          <span className="h-1.5 w-3/4 rounded-full" style={{ background: s.ink, opacity: 0.8 }} />
          <span className="h-1.5 w-1/2 rounded-full" style={{ background: s.ink, opacity: 0.25 }} />
          <span className="h-3 w-8 self-end rounded-full" style={{ background: s.accent }} />
        </span>
      </span>
      <span className="flex items-center justify-between px-1 pb-0.5 pt-2 text-sm font-medium">{s.name}{value === s.id && <Check size={14} />}</span>
    </button>)}
  </div>
}

/** Settings → Preferences (each user's own). */
export function PreferencesSettings() {
  const { prefs, update, saving, error } = usePreferences()
  return <section className="crm-card p-6">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Preferences</h2>
      <span className="text-xs text-muted-foreground" role="status">{error || (saving ? 'Saving…' : <span className="inline-flex items-center gap-1"><Check size={13} />Saved to your account</span>)}</span></div>
    <div className="border-b border-border py-4"><p className="mb-3 text-sm font-medium">Style</p><StylePicker value={prefs.style} onChange={style => update({ style })} /></div>
    <Row title="Light or dark"><Segmented label="Light or dark" value={prefs.theme} onChange={theme => update({ theme })} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /></Row>
    <Row title="Density"><Segmented label="Density" value={prefs.density} onChange={density => update({ density })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} /></Row>
    <Row title="Chat text size"><Segmented label="Chat text size" value={prefs.chatSize} onChange={chatSize => update({ chatSize })} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} /></Row>
    <Row title="Open inbox on"><Segmented label="Default inbox tab" value={prefs.defaultTab} onChange={defaultTab => update({ defaultTab })} options={[{ value: 'open', label: 'Open' }, { value: 'waiting', label: 'Waiting' }, { value: 'unread', label: 'Unread' }, { value: 'all', label: 'All' }]} /></Row>
    <Row title="Sort conversations"><Segmented label="Default sort" value={prefs.defaultSort} onChange={defaultSort => update({ defaultSort })} options={[{ value: 'latest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }]} /></Row>
    <Row title="Time format"><Segmented label="Time format" value={prefs.timeFormat} onChange={timeFormat => update({ timeFormat })} options={[{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]} /></Row>
    <Row title="Sound for new messages"><div className="flex items-center gap-3"><button type="button" className="text-xs font-medium underline" onClick={playChime}>Play sound</button><Switch label="Sound for new messages" checked={prefs.sound} onChange={sound => { update({ sound }); if (sound) playChime() }} /></div></Row>
    <Row title="Desktop notifications"><DesktopNotifications enabled={prefs.notify} onChange={notify => update({ notify })} /></Row>
    <Row title="Show contact panel"><Switch label="Show contact panel" checked={prefs.contactPanel} onChange={contactPanel => update({ contactPanel })} /></Row>
  </section>
}

const noSubscribe = () => () => {}
function DesktopNotifications({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const [note, setNote] = useState('')
  const permission = useSyncExternalStore(noSubscribe, () => notificationsSupported() ? Notification.permission : 'unsupported', () => 'unsupported')
  if (permission === 'unsupported') return <span className="text-xs text-muted-foreground">Not available in this browser</span>
  async function toggle(next: boolean) {
    setNote('')
    if (!next) { onChange(false); return }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    if (permission === 'granted') { onChange(true); new Notification('Notifications are on', { body: 'You’ll be told when a customer sends a new message.', icon: '/icon' }) }
    else setNote('Blocked by the browser. Allow notifications for this site in the address bar, then try again.')
  }
  return <div className="flex flex-col items-start gap-1 sm:items-end"><Switch label="Desktop notifications" checked={enabled && permission === 'granted'} onChange={v => void toggle(v)} />{note && <span className="max-w-xs text-xs text-destructive">{note}</span>}</div>
}
