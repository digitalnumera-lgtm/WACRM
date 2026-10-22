'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { DEFAULT_PREFERENCES, MAX_PINNED, sanitizePreferences, type Preferences } from '@/lib/monitoring/preferences'
import { sendJson } from './ui'

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

/** Short beep for new waiting chats (Web Audio, no file needed). */
export function playChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.type = 'sine'; osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + 0.4)
    osc.onended = () => void ctx.close()
  } catch { /* Audio may be blocked until the user interacts with the page. */ }
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full bg-muted p-1">
    {options.map(o => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${value === o.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{o.label}</button>)}
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

/** Settings → Preferences (each user's own). */
export function PreferencesSettings() {
  const { prefs, update, saving, error } = usePreferences()
  return <section className="crm-card p-6">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Preferences</h2>
      <span className="text-xs text-muted-foreground" role="status">{error || (saving ? 'Saving…' : <span className="inline-flex items-center gap-1"><Check size={13} />Saved to your account</span>)}</span></div>
    <Row title="Theme"><Segmented label="Theme" value={prefs.theme} onChange={theme => update({ theme })} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /></Row>
    <Row title="Density"><Segmented label="Density" value={prefs.density} onChange={density => update({ density })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} /></Row>
    <Row title="Chat text size"><Segmented label="Chat text size" value={prefs.chatSize} onChange={chatSize => update({ chatSize })} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} /></Row>
    <Row title="Open inbox on"><Segmented label="Default inbox tab" value={prefs.defaultTab} onChange={defaultTab => update({ defaultTab })} options={[{ value: 'open', label: 'Open' }, { value: 'waiting', label: 'Waiting' }, { value: 'unread', label: 'Unread' }, { value: 'all', label: 'All' }]} /></Row>
    <Row title="Sort conversations"><Segmented label="Default sort" value={prefs.defaultSort} onChange={defaultSort => update({ defaultSort })} options={[{ value: 'latest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }]} /></Row>
    <Row title="Time format"><Segmented label="Time format" value={prefs.timeFormat} onChange={timeFormat => update({ timeFormat })} options={[{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]} /></Row>
    <Row title="Sound for new waiting chats"><Switch label="Sound for new waiting chats" checked={prefs.sound} onChange={sound => update({ sound })} /></Row>
    <Row title="Show contact panel"><Switch label="Show contact panel" checked={prefs.contactPanel} onChange={contactPanel => update({ contactPanel })} /></Row>
  </section>
}
