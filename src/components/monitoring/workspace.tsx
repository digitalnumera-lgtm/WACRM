'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { ChartNoAxesCombined, ChevronRight, Columns3, Image as ImageIcon, Inbox, LayoutDashboard, List, LogOut, MessageSquare, Settings, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { MonitoringThread } from '@/lib/monitoring/types'
import type { ThreadWorkflow } from '@/lib/monitoring/workflow-types'
import { can, type MonitoringMe, type Permission } from '@/lib/monitoring/permissions'
import type { Preferences } from '@/lib/monitoring/preferences'
import { Conversation, prefetchConversation, workflowPatch, type ChatSnapshot } from './conversation'
import { ContactPanel } from './contact-panel'
import { ConversationList, emptyFilters, useInbox, type InboxFilters } from './inbox-list'
import { LabelsSettings, useLabels } from './labels'
import { AccessProvider } from './access'
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
const QuickRepliesPanel = dynamic(() => import('./quick-replies').then(m => m.QuickRepliesPanel), { loading })
const BusinessNumbers = dynamic(() => import('./business-numbers').then(m => m.BusinessNumbers), { loading })
const ConnectNumber = dynamic(() => import('./connect-number').then(m => m.ConnectNumber), { loading })
const HistoryImport = dynamic(() => import('./setup-panels').then(m => m.HistoryImport), { loading })
const PortfolioPicker = dynamic(() => import('./setup-panels').then(m => m.PortfolioPicker), { loading })
const RenewMetaAccess = dynamic(() => import('./renew-access').then(m => m.RenewMetaAccess), { loading })
const ChannelManager = dynamic(() => import('./admin-panels').then(m => m.ChannelManager), { loading })
const ReviewEvents = dynamic(() => import('./admin-panels').then(m => m.ReviewEvents), { loading })

type View = 'Inbox' | 'Dashboard' | 'Leads' | 'Contacts' | 'Media' | 'Reports' | 'Logs' | 'Settings'
export type SettingsSection = 'preferences' | 'team' | 'numbers' | 'storage' | 'labels' | 'replies' | 'import' | 'events' | 'access' | 'general'

const nav: { name: View; label: string; icon: typeof Inbox; need: Permission }[] = [
  { name: 'Inbox', label: 'Inbox', icon: Inbox, need: 'view_inbox' },
  { name: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard, need: 'view_reports' },
  { name: 'Leads', label: 'Leads board', icon: Columns3, need: 'view_inbox' },
  { name: 'Contacts', label: 'Contacts', icon: Users, need: 'view_contacts' },
  { name: 'Media', label: 'Media', icon: ImageIcon, need: 'view_media' },
  { name: 'Reports', label: 'Reports', icon: ChartNoAxesCombined, need: 'view_reports' },
  { name: 'Logs', label: 'Message logs', icon: List, need: 'view_inbox' },
]
const sections: { id: SettingsSection; label: string; allowed: (me: MonitoringMe) => boolean }[] = [
  { id: 'preferences', label: 'Preferences', allowed: () => true },
  { id: 'team', label: 'Team & roles', allowed: me => me.full },
  { id: 'numbers', label: 'Business numbers', allowed: me => can(me, 'manage_numbers') },
  { id: 'storage', label: 'Media storage', allowed: me => can(me, 'manage_settings') },
  { id: 'labels', label: 'Labels', allowed: me => can(me, 'manage_labels') },
  { id: 'replies', label: 'Saved replies', allowed: me => me.full },
  { id: 'access', label: 'Meta access', allowed: me => can(me, 'manage_numbers') },
  { id: 'import', label: 'Import history', allowed: me => can(me, 'manage_numbers') },
  { id: 'events', label: 'Events for review', allowed: me => can(me, 'manage_numbers') },
  { id: 'general', label: 'Management replies', allowed: me => me.full },
]

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
  const { prefs, update } = usePreferences()
  const dark = useDarkMode(prefs.theme)
  const [view, setView] = useState<View>(initialView)
  const [section, setSection] = useState<SettingsSection>(() => initialSection && sections.some(s => s.id === initialSection && s.allowed(me)) ? initialSection : 'preferences')
  const [filters, setFilters] = useState<InboxFilters>(() => ({ ...emptyFilters, tab: prefs.defaultTab, sort: prefs.defaultSort }))
  const [selected, setSelected] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [replyEnabled, setReplyEnabled] = useState<boolean | null>(null)
  const [contactOpen, setContactOpen] = useState(() => prefs.contactPanel && (typeof window === 'undefined' || window.matchMedia('(min-width: 1280px)').matches))
  const [details, setDetails] = useState<Record<string, MonitoringThread>>({})
  const settingsRevision = useRef(0)
  const [chatCache] = useState(() => new Map<string, ChatSnapshot>())
  const inbox = useInbox(filters, refresh)
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

  // Chime when more customers start waiting for a reply.
  const waitingCount = inbox.counts?.waiting
  const lastWaiting = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (waitingCount === undefined) return
    if (prefs.sound && lastWaiting.current !== undefined && waitingCount > lastWaiting.current) playChime()
    lastWaiting.current = waitingCount
  }, [waitingCount, prefs.sound])

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
        onPrefetch={id => prefetchConversation(id, chatCache)} hidden={!!selected} pinned={prefs.pinned} onPin={pinned => update({ pinned })} refresh={refresh} />
      <section aria-label="Conversation" className={`min-h-0 min-w-0 overflow-hidden md:rounded-3xl md:border md:border-border md:shadow-sm ${selected ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'}`}>
        {selected ? <Conversation key={selected} id={selected} thread={selectedThread} channels={inbox.channels} repliesEnabled={replyEnabled === true && me.full} workflowReady={workflowReady}
          cache={chatCache} contactOpen={contactOpen} onToggleContact={() => setContactOpen(v => !v)} onBack={() => setSelected(null)}
          onPatched={value => patch(selected, value)} onLoaded={onLoaded} onChanged={bump} />
          : <div className="chat-wallpaper flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-muted-foreground"><span className="flex size-16 items-center justify-center rounded-3xl bg-card shadow-sm"><MessageSquare size={28} /></span><p className="font-medium text-foreground">Select a conversation</p><p className="max-w-xs text-sm"><kbd className="rounded border border-border bg-card px-1">j</kbd> / <kbd className="rounded border border-border bg-card px-1">k</kbd> to move, <kbd className="rounded border border-border bg-card px-1">/</kbd> to search</p></div>}
      </section>
      {contactOpen && selectedThread && <div className="fixed inset-0 z-40 bg-black/30 xl:static xl:z-auto xl:bg-transparent" onClick={e => { if (e.target === e.currentTarget) setContactOpen(false) }}>
        <div className="ml-auto h-full w-[min(340px,92vw)] overflow-hidden xl:w-auto xl:rounded-3xl xl:border xl:border-border xl:shadow-sm"><ContactPanel key={selectedThread.id} thread={selectedThread} channels={inbox.channels} labels={labels} workflowReady={workflowReady}
          onPatched={value => patch(selectedThread.id, value)} onOpenThread={setSelected} onClose={() => setContactOpen(false)} /></div>
      </div>}
    </main>
      : <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
          <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{accountName}</p><h1 className="text-3xl font-semibold tracking-tight">{view === 'Logs' ? 'Message logs' : view === 'Leads' ? 'Leads board' : view}</h1></div>
            <div className="flex items-center gap-2"><button className={`${buttonClass} rounded-full`} onClick={bump}>Refresh</button><span className="md:hidden"><MonitoringSignOut compact /></span></div></header>
          {view === 'Dashboard' && <Dashboard refresh={refresh} channels={inbox.channels} onTab={tab => showInbox({ tab, sort: tab === 'waiting' ? 'oldest' : prefs.defaultSort })} onChannel={id => showInbox({ tab: 'all', channel: id })} />}
          {view === 'Leads' && <LeadsBoard channels={inbox.channels} refresh={refresh} onOpen={open} />}
          {view === 'Contacts' && <ContactsPanel channels={inbox.channels} onOpen={open} />}
          {view === 'Media' && <MediaLibrary channels={inbox.channels} refresh={refresh} onOpen={open} />}
          {view === 'Reports' && <ReportsPanel channels={inbox.channels} refresh={refresh} />}
          {view === 'Logs' && <MessageBrowser channels={inbox.channels} refresh={refresh} onOpen={open} />}
          {view === 'Settings' && <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="Settings" className="crm-card flex gap-1 overflow-x-auto p-2 lg:sticky lg:top-0 lg:flex-col lg:self-start">
              {sections.filter(s => s.allowed(me)).map(s => <button key={s.id} onClick={() => setSection(s.id)} aria-current={section === s.id ? 'page' : undefined}
                className={`flex shrink-0 items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left text-sm font-medium ${section === s.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{s.label}<ChevronRight size={14} className="hidden lg:block" /></button>)}
            </nav>
            <div className="min-w-0 space-y-5">
              {section === 'preferences' && <PreferencesSettings />}
              {section === 'team' && me.full && <TeamSettings channels={inbox.channels} />}
              {section === 'numbers' && can(me, 'manage_numbers') && <Panel><ConnectNumber onConnected={bump} /><BusinessNumbers channels={inbox.channels} refresh={refresh} onSaved={bump} onOpen={id => showInbox({ tab: 'all', channel: id })} />
                <details className="crm-card p-4"><summary className="cursor-pointer text-sm font-medium text-muted-foreground">Advanced: add a number without chat history</summary>
                  <div className="mt-4 space-y-6"><div><h4 className="text-sm font-semibold">From the Meta business portfolio</h4><PortfolioPicker onSaved={bump} /></div><div><h4 className="text-sm font-semibold">By phone number ID and token</h4><ChannelManager channels={inbox.channels} onSaved={bump} /></div></div></details></Panel>}
              {section === 'storage' && can(me, 'manage_settings') && <StorageSettings />}
              {section === 'labels' && can(me, 'manage_labels') && <LabelsSettings labels={labels} ready={labelsReady} onChanged={() => { reloadLabels(); bump() }} />}
              {section === 'replies' && me.full && <QuickRepliesPanel />}
              {section === 'access' && can(me, 'manage_numbers') && <RenewMetaAccess channels={inbox.channels} />}
              {section === 'import' && can(me, 'manage_numbers') && <HistoryImport channels={inbox.channels} onSaved={bump} />}
              {section === 'events' && can(me, 'manage_numbers') && <ReviewEvents channels={inbox.channels} />}
              {section === 'general' && me.full && <MonitoringSettings enabled={replyEnabled} onSaved={enabled => { settingsRevision.current++; setReplyEnabled(enabled); bump() }} />}
            </div>
          </div>}
        </div>
      </main>}
  </div>
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>
}
