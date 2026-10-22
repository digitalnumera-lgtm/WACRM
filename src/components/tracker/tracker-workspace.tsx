'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { BadgeDollarSign, Briefcase, LayoutDashboard, RefreshCw, Settings, Wallet } from 'lucide-react'
import type { Preferences } from '@/lib/monitoring/preferences'
import { atLeast, type TrackerLevel, type TrackerView } from '@/lib/tracker/model'
import { MonitoringSignOut } from '@/components/monitoring/workspace'
import { ActivePill, MotionRoot } from '@/components/monitoring/motion'
import { PreferencesProvider, useDarkMode, usePreferences } from '@/components/monitoring/preferences'
import { api, buttonClass, timeAgo } from '@/components/monitoring/ui'
import { rememberPanel } from './panel'

const loading = () => <div className="crm-card h-48 animate-pulse" />
const Overview = dynamic(() => import('./tracker-pages').then(m => m.TrackerOverview), { loading })
const Deals = dynamic(() => import('./tracker-pages').then(m => m.TrackerDeals), { loading })
const Payments = dynamic(() => import('./tracker-pages').then(m => m.TrackerPayments), { loading })
const Commission = dynamic(() => import('./tracker-pages').then(m => m.TrackerCommission), { loading })
const TrackerSettings = dynamic(() => import('./tracker-settings').then(m => m.TrackerSettings), { loading })

export type TrackerPage = 'Overview' | 'Deals' | 'Payments' | 'Commission' | 'Settings'

export function TrackerWorkspace(props: { accountName: string; level: TrackerLevel; crm: boolean; preferences: Preferences }) {
  return <PreferencesProvider initial={props.preferences}><Workspace {...props} /></PreferencesProvider>
}

/** Loads the tracker data, refreshes it every minute while the page is open. */
function useTracker() {
  const [data, setData] = useState<TrackerView | null>(null)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const load = useCallback(async (force = false) => {
    if (running.current) return
    running.current = true; setBusy(true)
    try { setData(await api<TrackerView>(`/api/tracker${force ? '?refresh=1' : ''}`)); setError(null) }
    catch (e) { setError({ message: (e as Error).message, code: (e as { code?: string }).code }) }
    finally { running.current = false; setBusy(false) }
  }, [])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (!document.hidden) void load() }, 60_000)
    return () => window.clearInterval(timer)
  }, [load])
  return { data, error, busy, reload: load, setData }
}

function Workspace({ accountName, level, crm }: { accountName: string; level: TrackerLevel; crm: boolean }) {
  const { prefs } = usePreferences()
  const dark = useDarkMode(prefs.theme)
  const [page, setPage] = useState<TrackerPage>('Overview')
  const [openClient, setOpenClient] = useState<string | null>(null)
  const tracker = useTracker()
  const canEdit = atLeast(level, 'full')
  useEffect(() => { rememberPanel('tracker') }, [])

  const pages: { name: TrackerPage; label: string; icon: typeof Settings; min: TrackerLevel }[] = [
    { name: 'Overview', label: 'Overview', icon: LayoutDashboard, min: 'view' },
    { name: 'Deals', label: 'Deals & clients', icon: Briefcase, min: 'view' },
    { name: 'Payments', label: 'Payments', icon: Wallet, min: 'amounts' },
    { name: 'Commission', label: 'Commission', icon: BadgeDollarSign, min: 'full' },
  ]
  const nav = (name: TrackerPage, label: string, Icon: typeof Settings) => <button key={name} onClick={() => setPage(name)} aria-label={label} title={label} aria-current={page === name ? 'page' : undefined}
    className={`relative isolate flex size-11 shrink-0 items-center justify-center rounded-full transition-colors ${page === name ? 'text-[var(--ink-accent)] dark:text-[var(--hl-fg)]' : 'text-muted-foreground hover:bg-card hover:text-foreground'}`}>
    {page === name && <ActivePill id="tracker-nav" className="rounded-full bg-[var(--ink)] shadow-md dark:bg-[var(--hl)]" />}
    <Icon size={19} />
  </button>
  const showClient = (clientKey: string) => { setOpenClient(clientKey); setPage('Deals') }
  const title = pages.find(p => p.name === page)?.label ?? 'Settings'
  const d = tracker.data

  return <MotionRoot><div data-density={prefs.density} data-style={prefs.style} className={`monitoring-panel flex h-dvh flex-col overflow-hidden text-foreground md:flex-row md:gap-3 md:p-3 ${dark ? 'dark' : ''}`}>
    <aside aria-label="Client Tracker" className="order-last flex shrink-0 items-center gap-1 border-t border-border bg-card/90 px-2 py-1.5 backdrop-blur md:order-first md:w-14 md:flex-col md:border-0 md:bg-transparent md:p-0 md:py-1">
      <div title={accountName} role="img" aria-label="Numera Digital" className="brand-mark hidden h-11 w-9 shrink-0 md:mb-4 md:block" />
      <nav className="flex flex-1 items-center justify-around gap-1 md:flex-col md:justify-start">
        {pages.filter(p => atLeast(level, p.min)).map(p => nav(p.name, p.label, p.icon))}
        <span className="hidden md:block md:flex-1" />
        {nav('Settings', 'Settings', Settings)}
      </nav>
      <div className="hidden md:block"><MonitoringSignOut compact /></div>
    </aside>
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:rounded-3xl md:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Client Tracker</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        </div>
        {page !== 'Settings' && <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {d && <span title={new Date(d.fetchedAt).toLocaleString()}>Updated {timeAgo(d.fetchedAt) === 'now' ? 'just now' : `${timeAgo(d.fetchedAt)} ago`}</span>}
          <button className={buttonClass} disabled={tracker.busy} onClick={() => void tracker.reload(true)}><RefreshCw size={14} className={tracker.busy ? 'animate-spin' : ''} />Refresh</button>
        </div>}
      </header>
      {page !== 'Settings' && d?.stale && <p role="status" className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Showing the last copy of the Sheet. {d.stale}</p>}
      {page === 'Settings' ? <TrackerSettings level={level} crm={crm} onConnected={() => void tracker.reload(true)} />
        : !d ? tracker.error ? <NotReady error={tracker.error} owner={level === 'owner'} onSettings={() => setPage('Settings')} /> : loading()
          : <>
            {page === 'Overview' && <Overview data={d} onClient={showClient} onDeals={() => setPage('Deals')} />}
            {page === 'Deals' && <Deals data={d} openClient={openClient} onClient={setOpenClient} canEdit={canEdit} onChanged={view => tracker.setData(view)} />}
            {page === 'Payments' && d.payments && <Payments data={d} onClient={showClient} />}
            {page === 'Commission' && d.commission && <Commission data={d} canEdit={canEdit} onChanged={view => tracker.setData(view)} />}
          </>}
    </main>
  </div></MotionRoot>
}

function NotReady({ error, owner, onSettings }: { error: { message: string; code?: string }; owner: boolean; onSettings: () => void }) {
  const setup = error.code === 'not_connected'
  return <div className="crm-card max-w-xl space-y-3 p-6">
    <h2 className="text-lg font-semibold">{setup ? 'Connect the Sheet first' : 'The Sheet could not be read'}</h2>
    <p className="text-sm text-muted-foreground">{setup && !owner ? 'The company owner needs to connect the Client Tracker to the Google Sheet.' : error.message}</p>
    {owner && <button className={buttonClass} onClick={onSettings}>Open Settings</button>}
  </div>
}
