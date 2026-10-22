'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { ChartNoAxesCombined, Columns3, Image as ImageIcon, Inbox, LayoutDashboard, LogOut, MessageSquare, Settings, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { MonitoringThread } from '@/lib/monitoring/types'
import type { ThreadWorkflow } from '@/lib/monitoring/workflow-types'
import { can, type MonitoringMe, type Permission } from '@/lib/monitoring/permissions'
import type { Preferences } from '@/lib/monitoring/preferences'
import { Conversation, prefetchConversation, workflowPatch, type ChatSnapshot } from './conversation'
import { ContactPanel } from './contact-panel'
import { ConversationList, emptyFilters, previewText, useInbox, type InboxFilters } from './inbox-list'
import { LabelsSettings, useLabels } from './labels'
import { AccessProvider } from './access'
import { SectionBoundary } from './error-boundary'
import { playChime, PreferencesProvider, PreferencesSettings, useDarkMode, usePreferences } from './preferences'
import { MonitoringSettings } from './settings-panel'
import { api, buttonClass } from './ui'

const loading = () => <div className="crm-card h-48 animate-pulse" />
const Dashboard = dynamic(() => import('./dashboard').then(m => m.Dashboard), { loading })
const LeadsBoard = dynamic(() => import('./leads-board').then(m => m.LeadsBoard), { loading })
const ContactsPanel = dynamic(() => import('./contacts-panel').then(m => m.ContactsPanel), { loading })
const MediaLibrary = dynamic(() => import('./media-library').then(m => m.MediaLibrary), { loading })
const ReportsPanel = dynamic(() => import('./activity-panels').then(m => m.ReportsPanel), { loading })
const MessageBrowser = dynamic(() => import('./activity-panels').then(m => m.MessageBrowser), { loading })
const TeamSettings = dynamic(() => import('./team-settings').then(m => m.TeamSettings), { loading })
const StorageSettings = dynamic(() => import('./storage-settings').then(m => m.StorageSettings), { loading })
const SecuritySettings = dynamic(() => import('./security-settings').then(m => m.SecuritySettings), { loading })
const QuickRepliesPanel = dynamic(() => import('./quick-replies').then(m => m.QuickRepliesPanel), { loading })
const BusinessNumbers = dynamic(() => import('./business-numbers').then(m => m.BusinessNumbers), { loading })
const ConnectNumber = dynamic(() => import('./connect-number').then(m => m.ConnectNumber), { loading })
const HistoryImport = dynamic(() => import('./setup-panels').then(m => m.HistoryImport), { loading })
const PortfolioPicker = dynamic(() => import('./setup-panels').then(m => m.PortfolioPicker), { loading })
const RenewMetaAccess = dynamic(() => import('./renew-access').then(m => m.RenewMetaAccess), { loading })
const ChannelManager = dynamic(() => import('./admin-panels').then(m => m.ChannelManager), { loading })
const ReviewEvents = dynamic(() => import('./admin-panels').then(m => m.ReviewEvents), { loading })

type View = 'Inbox' | 'Dashboard' | 'Leads' | 'Contacts' | 'Media' | 'Reports' | 'Settings'
export type SettingsSection = 'preferences' | 'security' | 'team' | 'numbers' | 'storage' | 'labels' | 'replies' | 'import' | 'events' | 'access' | 'general'

const nav: { name: View; label: string; icon: typeof Inbox; need: Permission }[] = [
  { name: 'Inbox', label: 'Inbox', icon: Inbox, need: 'view_inbox' },
  { name: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard, need: 'view_reports' },
  { name: 'Leads', label: 'Leads board', icon: Columns3, need: 'view_inbox' },
  { name: 'Contacts', label: 'Contacts', icon: Users, need: 'view_contacts' },
  { name: 'Media', label: 'Media', icon: ImageIcon, need: 'view_media' },
  { name: 'Reports', label: 'Reports', icon: ChartNoAxesCombined, need: 'view_inbox' },
]
type Section = { id: SettingsSection; label: string; group: 'You' | 'Workspace' | 'Advanced'; allowed: (me: MonitoringMe, replies: boolean) => boolean }
const sections: Section[] = [
  { id: 'preferences', label: 'Preferences', group: 'You', allowed: () => true },
  { id: 'security', label: 'Security', group: 'You', allowed: () => true },
  { id: 'team', label: 'Team & roles', group: 'Workspace', allowed: me => me.full },
  { id: 'numbers', label: 'Business numbers', group: 'Workspace', allowed: me => can(me, 'manage_numbers') },
  { id: 'labels', label: 'Labels', group: 'Workspace', allowed: me => can(me, 'manage_labels') },
  { id: 'storage', label: 'Media storage', group: 'Workspace', allowed: me => can(me, 'manage_settings') },
  { id: 'access', label: 'Meta access', group: 'Advanced', allowed: me => can(me, 'manage_numbers') },
  { id: 'import', label: 'Import history', group: 'Advanced', allowed: me => can(me, 'manage_numbers') },
  { id: 'events', label: 'Events for review', group: 'Advanced', allowed: me => can(me, 'manage_numbers') },
  { id: 'general', label: 'Replying from the CRM', group: 'Advanced', allowed: me => me.full },
  { id: 'replies', label: 'Saved replies', group: 'Advanced', allowed: (me, replies) => me.full && replies },
]
type Latest = { id: string; channel_id: string; customer: string; customer_name: string | null; last_message_at: string; last_preview: string | null }

export function MonitoringSignOut({ compact }: { compact?: boolean }) {
  const [error, setError] = useState('')
  const router = useRouter()
  const signOut = async () => {
    const result = await createClient().auth.signOut()
    if (result.error) { setError('Unable to sign out. Please try again.'); return }
    router.replace('/login'); router.refresh()
  }
  return <>{compact
    ? <button onClick={signOut} aria-label="Sign out" title="Sign out" className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"><LogOut size={18} /></button>
    : <button className={buttonClass} onClick={signOut}>Sign out</button>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</>
}

export function MonitoringWorkspace(props: { accountName: string; me: MonitoringMe; preferences: Preferences; initialView?: 'Inbox' | 'Settings'; initialSection?: SettingsSection }) {
  return <PreferencesProvider initial={props.preferences}><AccessProvider me={props.me}><Workspace {...props} /></AccessProvider></PreferencesProvider>
}

function Workspace({ accountName, me, initialView = 'Inbox', initialSection }: { accountName: string; me: MonitoringMe; initialView?: 'Inbox' | 'Settings'; initialSection?: SettingsSection }) {
  const { prefs } = usePreferences()
  const dark = useDarkMode(prefs.theme)
  const [view, setView] = useState<View>(initialView)
  const [section, setSection] = useState<SettingsSection>(() => initialSection && sections.some(s => s.id === initialSection && s.allowed(me, true)) ? initialSection : 'preferences')
  const [reportsTab, setReportsTab] = useState<'activity' | 'log'>('activity')
  const [filters, setFilters] = useState<InboxFilters>(() => ({ ...emptyFilters, tab: prefs.defaultTab, sort: prefs.defaultSort }))
  const [selected, setSelected] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [replyEnabled, setReplyEnabled] = useState<boolean | null>(null)
  const [contactOpen, setContactOpen] = useState(() => prefs.contactPanel && (typeof window === 'undefined' || window.matchMedia('(min-width: 1280px)').matches))
  const [details, setDetails] = useState<Record<string, MonitoringThread>>({})
  const settingsRevision = useRef(0)
  const [chatCache] = useState(() => new Map<string, ChatSnapshot>())
  const inbox = useInbox(filters, refresh)
  // Paused or removed numbers only appear in Settings → Business numbers.
  const liveChannels = useMemo(() => inbox.channels.filter(c => c.active), [inbox.channels])
  // Labels and settings load once; changes made here reload them explicitly.
  const { labels, ready: labelsReady, reload: reloadLabels } = useLabels(0)
  const workflowReady = inbox.workflowReady
  const bump = useCallback(() => setRefresh(n => n + 1), [])

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setRefresh(n => n + 1) }, 30000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!me.full) return
    const controller = new AbortController()
    const revision = settingsRevision.current
    api<{ management_replies_enabled: boolean }>('/api/monitoring/settings', { signal: controller.signal })
      .then(data => { if (revision === settingsRevision.current) setReplyEnabled(data.management_replies_enabled) })
      .catch(() => { if (!controller.signal.aborted) setReplyEnabled(null) })
    return () => controller.abort()
  }, [me.full])

  // New customer messages: sound, desktop notification and a list refresh.
  const live = useRef({ prefs, selected, channels: inbox.channels })
  useEffect(() => { live.current = { prefs, selected, channels: inbox.channels } })
  useEffect(() => {
    let since: string | null = null
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const data = await api<{ threads: Latest[]; changed?: boolean; now: string }>(`/api/monitoring/latest${since ? `?since=${encodeURIComponent(since)}` : ''}`)
        const fresh = since ? data.threads : []
        const changed = !!since && (data.changed ?? fresh.length > 0)
        since = data.now
        if (!changed || stopped) return
        // Any activity (including agent replies) refreshes counters; only customer messages alert.
        if (!fresh.length) { setRefresh(n => n + 1); return }
        const { prefs: p, selected: open, channels } = live.current
        if (p.sound) playChime()
        if (p.notify && 'Notification' in window && Notification.permission === 'granted') {
          for (const t of fresh.slice(0, 3)) {
            if (!document.hidden && t.id === open) continue
            const agent = channels.find(c => c.id === t.channel_id)?.label
            const note = new Notification(`${t.customer_name || `+${t.customer}`}${agent ? ` → ${agent}` : ''}`, { body: previewText(t.last_preview) || 'New message', tag: t.id, icon: '/icon' })
            note.onclick = () => { window.focus(); setSelected(t.id); setView('Inbox'); note.close() }
          }
        }
        setRefresh(n => n + 1)
      } catch { /* Try again on the next tick. */ }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 15000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [])

  const selectedThread = selected ? inbox.threads.find(t => t.id === selected) ?? details[selected] : undefined
  const patch = useCallback((id: string, value: Partial<MonitoringThread>) => {
    inbox.patchThread(id, value)
    setDetails(old => old[id] ? { ...old, [id]: { ...old[id], ...value } } : old)
  }, [inbox])
  const onLoaded = useCallback((thread: MonitoringThread) => {
    if (inbox.threads.some(t => t.id === thread.id)) return
    setDetails(old => old[thread.id]?.state !== undefined ? old : { ...old, [thread.id]: { ...old[thread.id], ...thread } })
    if (!workflowReady) return
    api<{ workflows: Record<string, ThreadWorkflow> }>(`/api/monitoring/workflow?ids=${thread.id}`)
      .then(data => { const w = data.workflows[thread.id]; if (w) setDetails(old => ({ ...old, [thread.id]: { ...thread, ...old[thread.id], ...workflowPatch(w) } })) })
      .catch(() => {})
  }, [inbox.threads, workflowReady])
  const open = useCallback((id: string) => { setSelected(id); setView('Inbox') }, [])
  const showInbox = useCallback((patch: Partial<InboxFilters>) => { setFilters({ ...emptyFilters, sort: prefs.defaultSort, ...patch }); setView('Inbox') }, [prefs.defaultSort])

  // Keyboard: j/k next/previous conversation, "/" search, Esc back to list.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (view !== 'Inbox' || event.metaKey || event.ctrlKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable) return
      if (event.key === '/') { event.preventDefault(); document.getElementById('inbox-search')?.focus(); return }
      if (event.key === 'Escape') { setSelected(null); return }
      if (event.key !== 'j' && event.key !== 'k') return
      const index = inbox.threads.findIndex(t => t.id === selected)
      const next = inbox.threads[event.key === 'j' ? index + 1 : Math.max(0, index - 1)]
      if (next) {
        event.preventDefault(); setSelected(next.id)
        const after = inbox.threads[inbox.threads.indexOf(next) + (event.key === 'j' ? 1 : -1)]
        if (after) prefetchConversation(after.id, chatCache)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [view, inbox.threads, selected, chatCache])

  const views = nav.filter(n => can(me, n.need))
  const navButton = (name: View, label: string, Icon: typeof Inbox) => <button key={name} onClick={() => setView(name)} aria-label={label} title={label} aria-current={view === name ? 'page' : undefined}
    className={`relative flex size-11 shrink-0 items-center justify-center rounded-full transition-colors ${view === name ? 'bg-[#121316] text-[#C0DD11] shadow-md dark:bg-[#C0DD11] dark:text-[#121316]' : 'text-muted-foreground hover:bg-card hover:text-foreground'}`}>
    <Icon size={19} />{name === 'Inbox' && (inbox.counts?.waiting ?? 0) > 0 && view !== 'Inbox' && <span className="absolute right-1 top-1 size-2.5 rounded-full bg-red-500 ring-2 ring-background" />}
  </button>
  const chatOpenOnPhone = view === 'Inbox' && !!selected

  return <div data-density={prefs.density} data-chat-size={prefs.chatSize} className={`monitoring-panel flex h-dvh flex-col overflow-hidden text-foreground md:flex-row md:gap-3 md:p-3 ${dark ? 'dark' : ''}`}>
    <aside aria-label="Workspace" className={`order-last shrink-0 items-center gap-1 border-t border-border bg-card/90 px-2 py-1.5 backdrop-blur md:order-first md:flex md:w-14 md:flex-col md:border-0 md:bg-transparent md:p-0 md:py-1 ${chatOpenOnPhone ? 'hidden md:flex' : 'flex'}`}>
      <div title={accountName} className="hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-[#121316] text-lg font-black text-[#C0DD11] md:mb-4 md:flex">N</div>
      <nav className="flex flex-1 items-center justify-around gap-1 overflow-x-auto md:flex-col md:justify-start md:overflow-visible">
        {views.map(v => navButton(v.name, v.label, v.icon))}
        <span className="hidden md:block md:flex-1" />
        {navButton('Settings', 'Settings', Settings)}
      </nav>
      <div className="hidden md:block"><MonitoringSignOut compact /></div>
    </aside>

    {view === 'Inbox' ? <main className={`grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] md:gap-3 ${contactOpen && selectedThread ? 'lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)_320px]' : 'lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]'}`}>
      <ConversationList inbox={inbox} filters={filters} setFilters={setFilters} labels={labels} selected={selected} onSelect={setSelected}
        onPrefetch={id => prefetchConversation(id, chatCache)} hidden={!!selected} pinned={prefs.pinned} refresh={refresh} />
      <section aria-label="Conversation" className={`min-h-0 min-w-0 overflow-hidden md:rounded-3xl md:border md:border-border md:shadow-sm ${selected ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'}`}>
        {selected ? <SectionBoundary resetKey={selected}><Conversation key={selected} id={selected} thread={selectedThread} channels={inbox.channels} repliesEnabled={replyEnabled === true && me.full} workflowReady={workflowReady}
          cache={chatCache} contactOpen={contactOpen} onToggleContact={() => setContactOpen(v => !v)} onBack={() => setSelected(null)}
          onPatched={value => patch(selected, value)} onLoaded={onLoaded} onChanged={bump} /></SectionBoundary>
          : <div className="chat-wallpaper flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-muted-foreground"><span className="flex size-16 items-center justify-center rounded-3xl bg-card shadow-sm"><MessageSquare size={28} /></span><p className="font-medium text-foreground">Select a conversation</p><p className="max-w-xs text-sm"><kbd className="rounded border border-border bg-card px-1">j</kbd> / <kbd className="rounded border border-border bg-card px-1">k</kbd> to move, <kbd className="rounded border border-border bg-card px-1">/</kbd> to search</p></div>}
      </section>
      {contactOpen && selectedThread && <div className="fixed inset-0 z-40 bg-black/30 xl:static xl:z-auto xl:bg-transparent" onClick={e => { if (e.target === e.currentTarget) setContactOpen(false) }}>
        <div className="ml-auto h-full w-[min(340px,92vw)] overflow-hidden xl:w-auto xl:rounded-3xl xl:border xl:border-border xl:shadow-sm"><ContactPanel key={selectedThread.id} thread={selectedThread} channels={inbox.channels} labels={labels} workflowReady={workflowReady}
          onPatched={value => patch(selectedThread.id, value)} onOpenThread={setSelected} onClose={() => setContactOpen(false)} /></div>
      </div>}
    </main>
      : <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
          <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-muted-foreground">{accountName}</p><h1 className="font-display text-3xl font-semibold tracking-tight">{view === 'Leads' ? 'Leads board' : view}</h1></div>
            <span className="md:hidden"><MonitoringSignOut compact /></span></header>
          <SectionBoundary resetKey={`${view}:${section}:${reportsTab}`}>
          {view === 'Dashboard' && <Dashboard refresh={refresh} channels={liveChannels} onTab={tab => showInbox({ tab, sort: tab === 'waiting' ? 'oldest' : prefs.defaultSort })} onChannel={id => showInbox({ tab: 'all', channel: id })} />}
          {view === 'Leads' && <LeadsBoard channels={liveChannels} refresh={refresh} onOpen={open} />}
          {view === 'Contacts' && <ContactsPanel channels={liveChannels} onOpen={open} />}
          {view === 'Media' && <MediaLibrary channels={liveChannels} refresh={refresh} onOpen={open} />}
          {view === 'Reports' && <div className="space-y-5">
            <div role="tablist" aria-label="Reports" className="inline-flex gap-1 rounded-full bg-card p-1 shadow-sm">
              {([['activity', 'Activity & agents', 'view_reports'], ['log', 'Message search', 'view_inbox']] as const).filter(([, , need]) => can(me, need)).map(([id, label]) =>
                <button key={id} role="tab" aria-selected={reportsTab === id || !can(me, 'view_reports')} onClick={() => setReportsTab(id)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${reportsTab === id || !can(me, 'view_reports') ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
            </div>
            {reportsTab === 'activity' && can(me, 'view_reports') ? <ReportsPanel channels={liveChannels} refresh={refresh} /> : <MessageBrowser channels={liveChannels} refresh={refresh} onOpen={open} />}
          </div>}
          {view === 'Settings' && <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="Settings" className="crm-card flex gap-1 overflow-x-auto p-2 lg:sticky lg:top-0 lg:flex-col lg:gap-0.5 lg:self-start">
              {(['You', 'Workspace', 'Advanced'] as const).map(group => { const items = sections.filter(s => s.group === group && s.allowed(me, replyEnabled === true)); return items.length ? <div key={group} className="flex gap-1 lg:block lg:pb-2">
                <p className="hidden px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground lg:block">{group}</p>
                {items.map(s => <button key={s.id} onClick={() => setSection(s.id)} aria-current={section === s.id ? 'page' : undefined}
                  className={`flex w-full shrink-0 items-center rounded-2xl px-3 py-2 text-left text-sm font-medium ${section === s.id ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-muted'}`}>{s.label}</button>)}
              </div> : null })}
            </nav>
            <div className="min-w-0 space-y-5">
              {section === 'preferences' && <PreferencesSettings />}
              {section === 'security' && <SecuritySettings />}
              {section === 'team' && me.full && <TeamSettings channels={liveChannels} />}
              {section === 'numbers' && can(me, 'manage_numbers') && <Panel><ConnectNumber onConnected={bump} /><BusinessNumbers channels={inbox.channels} refresh={refresh} onSaved={bump} onOpen={id => showInbox({ tab: 'all', channel: id })} />
                <details className="crm-card p-4"><summary className="cursor-pointer text-sm font-medium text-muted-foreground">Advanced: add a number without chat history</summary>
                  <div className="mt-4 space-y-6"><div><h4 className="text-sm font-semibold">From the Meta business portfolio</h4><PortfolioPicker onSaved={bump} /></div><div><h4 className="text-sm font-semibold">By phone number ID and token</h4><ChannelManager channels={inbox.channels} onSaved={bump} /></div></div></details></Panel>}
              {section === 'storage' && can(me, 'manage_settings') && <StorageSettings />}
              {section === 'labels' && can(me, 'manage_labels') && <LabelsSettings labels={labels} ready={labelsReady} onChanged={() => { reloadLabels(); bump() }} />}
              {section === 'replies' && me.full && <QuickRepliesPanel />}
              {section === 'access' && can(me, 'manage_numbers') && <RenewMetaAccess channels={liveChannels} />}
              {section === 'import' && can(me, 'manage_numbers') && <HistoryImport channels={liveChannels} onSaved={bump} />}
              {section === 'events' && can(me, 'manage_numbers') && <ReviewEvents channels={liveChannels} />}
              {section === 'general' && me.full && <MonitoringSettings enabled={replyEnabled} onSaved={enabled => { settingsRevision.current++; setReplyEnabled(enabled); bump() }} />}
            </div>
          </div>}
          </SectionBoundary>
        </div>
      </main>}
  </div>
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>
}
