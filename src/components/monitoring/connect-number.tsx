'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, CircleAlert, History, LoaderCircle, Smartphone, Users } from 'lucide-react'
import { api, buttonClass, inputClass, primaryButton, sendJson } from './ui'

// Public identifiers; environment variables can override them at build time.
const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || '1121820883867005'
const CONFIG_ID = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID || '1502267518467039'
const SDK_VERSION = process.env.NEXT_PUBLIC_META_SDK_VERSION || 'v26.0'
// WhatsApp Business app onboarding ("coexistence"): the number keeps working
// on the phone and the owner can share chat history and contacts.
function signupExtras(): Record<string, unknown> {
  try { if (process.env.NEXT_PUBLIC_META_ES_EXTRAS) return JSON.parse(process.env.NEXT_PUBLIC_META_ES_EXTRAS) } catch { /* fall back */ }
  return { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }
}

type FacebookSdk = {
  init: (options: Record<string, unknown>) => void
  login: (callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void, options: Record<string, unknown>) => void
}
declare global { interface Window { FB?: FacebookSdk; fbAsyncInit?: () => void } }

let sdkPromise: Promise<FacebookSdk> | null = null
function loadSdk(): Promise<FacebookSdk> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) { resolve(window.FB); return }
    window.fbAsyncInit = () => { window.FB!.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: SDK_VERSION }); resolve(window.FB!) }
    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true; script.defer = true; script.crossOrigin = 'anonymous'
    script.onerror = () => { sdkPromise = null; reject(new Error('Facebook sign-in could not load. Disable ad blockers for this site and try again.')) }
    document.body.appendChild(script)
  })
  return sdkPromise
}

export type SyncAttempt = { ok: boolean; at: string; request_id?: string; code?: number; message?: string }
type Session = { waba_id?: string; phone_number_id?: string; event: string }

export function ConnectNumber({ onConnected }: { onConnected: (channelId: string) => void }) {
  const [label, setLabel] = useState('')
  const [step, setStep] = useState<'idle' | 'popup' | 'saving' | 'done'>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ display_number: string | null; syncs: Record<string, SyncAttempt> } | null>(null)
  const session = useRef<Session | null>(null)

  useEffect(() => {
    // Meta's popup reports the shared WhatsApp account (and number) by postMessage.
    const listener = (event: MessageEvent) => {
      let host = ''
      try { host = new URL(event.origin).hostname } catch { return }
      if (!/(^|\.)facebook\.com$/.test(host)) return
      let data: { type?: string; event?: string; data?: Record<string, string> }
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data } catch { return }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (data.event?.startsWith('FINISH')) session.current = { event: data.event, waba_id: data.data?.waba_id, phone_number_id: data.data?.phone_number_id }
      else if (data.event === 'CANCEL') {
        session.current = null
        setError(data.data?.error_message ? `Meta reported: ${data.data.error_message}` : `The Meta window was closed${data.data?.current_step ? ` at “${data.data.current_step}”` : ''}. Nothing was connected.`)
        setStep('idle')
      }
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [])

  const finish = useCallback(async (code: string) => {
    setStep('saving')
    // The finish message normally arrives first; wait briefly if not. The code
    // expires after about 30 seconds, so do not wait long. Without it, the
    // server finds the shared WhatsApp account from the new access token.
    for (let i = 0; i < 10 && !session.current?.waba_id; i++) await new Promise(r => setTimeout(r, 200))
    const info = session.current
    if (info?.event === 'FINISH_ONLY_WABA') { setError('Only the WhatsApp account was shared, without a phone number. Run Connect again and select the agent’s number.'); setStep('idle'); return }
    try {
      const data = await api<{ channel_id: string; display_number: string | null; syncs: Record<string, SyncAttempt> }>('/api/monitoring/connect', sendJson('POST', { code, waba_id: info?.waba_id, phone_number_id: info?.phone_number_id, label: label.trim(), page_url: window.location.href.split('#')[0] }))
      setResult(data); setStep('done'); onConnected(data.channel_id)
    } catch (e) { setError((e as Error).message); setStep('idle') }
  }, [label, onConnected])

  async function start() {
    if (!label.trim()) { setError('Enter the agent’s name first. It labels this number in the inbox.'); return }
    setError(''); setResult(null); session.current = null; setStep('popup')
    try {
      const FB = await loadSdk()
      // FB.login requires a synchronous callback.
      FB.login(response => {
        const code = response.authResponse?.code
        if (code) void finish(code)
        else setStep(current => { if (current === 'popup') setError('The Meta window was closed before finishing. Nothing was connected.'); return current === 'popup' ? 'idle' : current })
      }, { config_id: CONFIG_ID, response_type: 'code', override_default_response_type: true, extras: signupExtras() })
    } catch (e) { setError((e as Error).message); setStep('idle') }
  }

  return <section className="crm-card p-6">
    <div className="flex items-start gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Smartphone size={20} /></span>
      <div className="min-w-0 flex-1"><h3 className="text-lg font-semibold">Add or reconnect an agent</h3>
        <p className="mt-1 text-sm text-muted-foreground">The one way to add an agent, or to reconnect an existing one and bring in up to 6 months of old chats. The agent keeps using WhatsApp Business on their phone. Reconnecting keeps all chats already in the CRM.</p></div></div>
    <ol className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
      <li className="rounded-lg bg-muted/60 p-3"><b className="text-foreground">1.</b> Enter the agent’s name (use the same name to reconnect) and click Connect.</li>
      <li className="rounded-lg bg-muted/60 p-3"><b className="text-foreground">2.</b> In Meta’s window choose Numera Digital and the agent’s number, then confirm.</li>
      <li className="rounded-lg bg-muted/60 p-3"><b className="text-foreground">3.</b> On the agent’s phone, approve the request and allow chat history sharing.</li>
    </ol>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="min-w-56 flex-1 text-xs font-medium text-muted-foreground">Agent name (label)<input className={inputClass} value={label} maxLength={120} onChange={e => setLabel(e.target.value)} placeholder="e.g. Ali Anwar" disabled={step === 'popup' || step === 'saving'} /></label>
      <button className={`${primaryButton} !bg-[#1877f2] !text-white`} onClick={() => void start()} disabled={step === 'popup' || step === 'saving'}>
        {step === 'popup' ? <><LoaderCircle size={16} className="animate-spin" />Waiting for Meta…</> : step === 'saving' ? <><LoaderCircle size={16} className="animate-spin" />Connecting…</> : 'Connect with Facebook'}
      </button>
    </div>
    {error && <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><CircleAlert size={16} className="mt-0.5 shrink-0" />{error}</p>}
    {result && <div role="status" className="mt-4 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} />{result.display_number ?? 'Number'} connected. New messages now arrive in the inbox.</p>
      <SyncLine icon={<Users size={14} />} name="Contacts" attempt={result.syncs.smb_app_state_sync} />
      <SyncLine icon={<History size={14} />} name="Chat history" attempt={result.syncs.history} />
      <p className="text-xs">Meta sends history in parts over the next minutes to hours. Progress appears on the number below.</p>
    </div>}
  </section>
}

export function SyncLine({ icon, name, attempt }: { icon: ReactNode; name: string; attempt?: SyncAttempt }) {
  return <p className="flex items-start gap-2 text-xs">{icon}<span><b>{name}:</b> {!attempt ? 'not requested' : attempt.ok ? 'requested from Meta ✓' : `request failed — ${attempt.message ?? 'unknown error'}`}</span></p>
}

export type ConnectStatus = {
  connected: { at: string; display_number: string | null; token_source: string } | null
  syncs: Record<string, SyncAttempt>
  retry: Record<string, boolean>
  progress: { chunks: number; messages: number; progress: number | null; phases: number[]; declined: boolean; contacts: number; last_received_at: string | null }
}

/** Per-number history progress shown on Business numbers. */
export function HistoryStatus({ channelId, status, onRetried }: { channelId: string; status?: ConnectStatus; onRetried: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  if (!status) return null
  const { connected, syncs, retry, progress } = status
  if (!connected && !progress.chunks && !progress.contacts) return <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Added manually, so old chats were not imported. Use <b>Add or reconnect an agent</b> above with this agent’s name to bring in up to 6 months of history.</p>
  const done = (progress.progress ?? 0) >= 100
  const pct = Math.max(0, Math.min(100, progress.progress ?? 0))
  async function again(type: string) {
    setBusy(type); setError('')
    try { await api('/api/monitoring/connect/sync', sendJson('POST', { channel_id: channelId, sync_type: type })); onRetried() }
    catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  return <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
    <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 font-semibold"><History size={14} />Chat history from Meta</span>
      <span className={progress.declined ? 'text-red-700' : done ? 'text-emerald-700' : 'text-muted-foreground'}>{progress.declined ? 'Declined on phone' : done ? 'Complete' : progress.chunks ? `${pct}%` : syncs.history?.ok ? 'Waiting for Meta…' : 'Not started'}</span></div>
    {!progress.declined && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${done ? 100 : pct}%` }} /></div>}
    <p className="text-muted-foreground">{progress.messages.toLocaleString()} messages · {progress.contacts.toLocaleString()} contacts received{progress.last_received_at ? ` · last update ${new Date(progress.last_received_at).toLocaleString()}` : ''}{connected ? ` · connected ${new Date(connected.at).toLocaleString()}` : ''}</p>
    {progress.declined && <p className="text-red-700">History sharing was turned off on the phone. To share it, reconnect the number and allow chat history on the phone.</p>}
    {(['smb_app_state_sync', 'history'] as const).map(type => syncs[type] && !syncs[type].ok && <div key={type} className="flex flex-wrap items-center justify-between gap-2">
      <SyncLine icon={type === 'history' ? <History size={14} /> : <Users size={14} />} name={type === 'history' ? 'History request' : 'Contacts request'} attempt={syncs[type]} />
      {retry[type] && <button className={`${buttonClass} px-2 py-1 text-xs`} disabled={busy !== null} onClick={() => void again(type)}>{busy === type ? 'Retrying…' : 'Retry'}</button>}
    </div>)}
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>
}
