import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Public health check: is the app up, and how far away is the database?
 * Returns only timings (no data). `db_ms` is the fastest of three round trips
 * to Supabase from this server, which every page load pays several times.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const times: number[] = []
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    try { await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: 'no-store', signal: AbortSignal.timeout(5000) }) } catch { return NextResponse.json({ ok: false, error: 'db_unreachable' }, { status: 503 }) }
    times.push(Math.round(performance.now() - start))
  }
  return NextResponse.json({ ok: true, db_ms: Math.min(...times), db_samples: times })
}
