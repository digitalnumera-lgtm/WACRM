import { requireMonitoring, scopeChannels } from '@/lib/monitoring/team-access'
import { monitoringError, pageNumber, privateJson, readJson } from '@/lib/monitoring/http'
export async function GET(request: Request) {
  try {
    const access = await requireMonitoring('view_contacts')
    const { db: supabase, accountId } = access
    const params = new URL(request.url).searchParams; const page = pageNumber(params.get('page'))
    const search = (params.get('q') ?? '').trim().slice(0, 120).toLowerCase()
    const literal = search.replace(/\\/g, '\\\\').replace(/[%_*]/g, '\\$&').replace(/"/g, '\\"')
    const directory = new Map<string, { phone: string; name: string; email: string | null; threads: { id: string; channel_id: string }[] }>()
    let truncated = false
    // Address-book contacts are shared across every number, so members limited
    // to some numbers only see customers who chatted with those numbers.
    for (const table of access.channelIds === null ? ['contacts', 'monitoring_threads'] : ['monitoring_threads']) {
      for (let offset = 0; offset < 10000; offset += 1000) {
        let query = supabase.from(table).select(table === 'contacts' ? 'id,phone,name,email' : 'id,customer,customer_name,channel_id').eq('account_id', accountId)
        if (table === 'monitoring_threads') query = scopeChannels(access, query)
        if (search) query = query.or(table === 'contacts' ? `phone.ilike."%${literal}%",name.ilike."%${literal}%"` : `customer.ilike."%${literal}%",customer_name.ilike."%${literal}%"`)
        const result = await query.order('id').range(offset, offset + 999)
        if (result.error) throw result.error
        for (const raw of result.data ?? []) {
          const row = raw as unknown as Record<string, string>
          const phone = String(row.phone ?? row.customer).replace(/[+\s()-]/g, '')
          const contact = directory.get(phone) ?? { phone, name: row.name || row.customer_name || phone, email: row.email || null, threads: [] }
          if (table === 'monitoring_threads') contact.threads.push({ id: row.id, channel_id: row.channel_id })
          directory.set(phone, contact)
        }
        if ((result.data?.length ?? 0) < 1000) break
        if (offset === 9000) truncated = true
      }
    }
    const contacts = [...directory.values()].sort((a, b) => a.name.localeCompare(b.name))
    return privateJson({ contacts: contacts.slice(page * 30, page * 30 + 30), total: contacts.length, truncated })
  } catch (error) { return monitoringError(error) }
}
export async function POST(request: Request) {
  try {
    const { db: supabase, accountId, userId } = await requireMonitoring('edit_contacts')
    const body = await readJson(request, 2 * 1024 * 1024)
    if (!Array.isArray(body.contacts) || !body.contacts.length || body.contacts.length > 200) return privateJson({ error: 'Choose 1–200 contacts per batch.' }, 400)
    const contacts = []
    for (const row of body.contacts) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return privateJson({ error: 'Invalid contact row.' }, 400)
      const phone = String(row.phone ?? '').replace(/[+\s()-]/g, '')
      if (!/^\d{6,20}$/.test(phone)) return privateJson({ error: 'Every contact needs an international phone number in the phone column.' }, 400)
      contacts.push({ account_id: accountId, user_id: userId, phone, name: String(row.name ?? phone).slice(0, 200), email: row.email ? String(row.email).slice(0, 254) : null })
    }
    if (body.preview) return privateJson({ count: contacts.length })
    // One lookup and one insert for the whole batch (not two queries per contact).
    const unique = [...new Map(contacts.map(c => [c.phone, c])).values()]
    const existing = await supabase.from('contacts').select('phone_normalized').eq('account_id', accountId).in('phone_normalized', unique.map(c => c.phone))
    if (existing.error) throw existing.error
    const known = new Set((existing.data ?? []).map(r => String(r.phone_normalized)))
    const fresh = unique.filter(c => !known.has(c.phone))
    let added = 0, skipped = contacts.length - fresh.length
    if (fresh.length) {
      const result = await supabase.from('contacts').insert(fresh)
      if (!result.error) added = fresh.length
      else if (result.error.code === '23505') {
        // Someone added one of them meanwhile: fall back to one at a time for this rare case.
        for (const contact of fresh) {
          const one = await supabase.from('contacts').insert(contact)
          if (one.error && one.error.code !== '23505') throw one.error
          if (one.error) skipped++; else added++
        }
      } else throw result.error
    }
    return privateJson({ added, skipped })
  } catch (error) { return monitoringError(error) }
}
