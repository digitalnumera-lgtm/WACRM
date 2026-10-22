'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { buttonClass, inputClass, primaryButton, sendJson } from './ui'

type Setup = { id: string; qr: string; secret: string }

/** Keeps the server-side flag in step with Supabase's factor list, then refreshes the session token. */
async function syncTwoStep(supabase: ReturnType<typeof createClient>) {
  await fetch('/api/monitoring/security', sendJson('POST', {})).catch(() => null)
  await supabase.auth.refreshSession().catch(() => null)
}

/** Settings → Security: two-step sign-in and signing out other devices. */
export function SecuritySettings() {
  const supabase = useMemo(() => createClient(), [])
  const [factorId, setFactorId] = useState<string | null | undefined>(undefined)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [code, setCode] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) { setError('Could not check two-step sign-in. Reload the page and try again.'); setFactorId(null); return }
    setFactorId(data.totp.find(f => f.status === 'verified')?.id ?? null)
  }, [supabase])
  useEffect(() => { void load(); void syncTwoStep(supabase) }, [load, supabase])

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const start = () => run(async () => {
    const existing = await supabase.auth.mfa.listFactors()
    for (const f of existing.data?.all ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Numera CRM ${Date.now()}` })
    if (error) throw error
    setSetup({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  })

  const cancel = () => run(async () => {
    if (setup) await supabase.auth.mfa.unenroll({ factorId: setup.id })
    setSetup(null); setCode('')
  })

  const confirm = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    if (!setup) return
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: setup.id, code: code.trim() })
    if (error) throw new Error('That code did not match. Enter the newest 6-digit code from the app.')
    await syncTwoStep(supabase)
    await supabase.auth.signOut({ scope: 'others' })
    setSetup(null); setCode(''); setNotice('Two-step sign-in is on. Other devices were signed out.')
    await load()
  }) }

  const turnOff = () => run(async () => {
    if (!factorId) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) throw new Error(/aal2|assurance/i.test(error.message) ? 'Sign out, sign in again with your code, then try again.' : error.message)
    await syncTwoStep(supabase)
    setConfirmOff(false); setNotice('Two-step sign-in is off.')
    await load()
  })

  const signOutEverywhere = () => run(async () => {
    await supabase.auth.signOut({ scope: 'global' })
    // Full reload so no signed-in state stays in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login'
  })

  const on = !!factorId
  return <section className="crm-card p-6">
    <h2 className="text-lg font-semibold">Security</h2>
    <div className="flex flex-col gap-3 border-b border-border py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className={`flex size-9 items-center justify-center rounded-full ${on ? 'bg-[#C0DD11] text-[#121316]' : 'bg-muted text-muted-foreground'}`}><ShieldCheck size={17} /></span>
        <div><p className="text-sm font-medium">Two-step sign-in</p><p className="text-xs text-muted-foreground">{factorId === undefined ? 'Checking…' : on ? 'On: a code from your authenticator app is needed after your password' : 'Off'}</p></div>
      </div>
      {factorId !== undefined && !setup && (on
        ? confirmOff
          ? <div className="flex gap-2"><button className={`${buttonClass} text-destructive`} disabled={busy} onClick={() => void turnOff()}>{busy ? 'Turning off…' : 'Yes, turn off'}</button><button className={buttonClass} disabled={busy} onClick={() => setConfirmOff(false)}>Cancel</button></div>
          : <button className={buttonClass} disabled={busy} onClick={() => setConfirmOff(true)}>Turn off</button>
        : <button className={primaryButton} disabled={busy} onClick={() => void start()}>{busy ? 'Starting…' : 'Turn on'}</button>)}
    </div>
    {setup && <form onSubmit={confirm} className="grid gap-5 border-b border-border py-5 sm:grid-cols-[180px_1fr]">
      {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns the QR code as an SVG data URL */}
      <img src={setup.qr} alt="QR code for your authenticator app" className="size-44 rounded-2xl bg-white p-2" />
      <div className="space-y-3 text-sm">
        <p>Scan the code with Google Authenticator, Microsoft Authenticator or a similar app, then enter the 6-digit code it shows.</p>
        <p className="text-xs text-muted-foreground">Can’t scan? Enter this key in the app: <span className="select-all break-all font-mono text-foreground">{setup.secret}</span></p>
        <input className={`${inputClass} max-w-40 text-center text-lg tracking-[0.3em]`} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required aria-label="6-digit code"
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
        <div className="flex gap-2"><button className={primaryButton} disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm'}</button><button type="button" className={buttonClass} disabled={busy} onClick={() => void cancel()}>Cancel</button></div>
      </div>
    </form>}
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-medium">Signed-in devices</p><p className="text-xs text-muted-foreground">Signs you out on every phone and computer, including this one</p></div>
      <button className={buttonClass} disabled={busy} onClick={() => void signOutEverywhere()}><LogOut size={14} />Sign out everywhere</button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
  </section>
}
