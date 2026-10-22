import { requireMonitoring, scopeChannels } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { MonitoringInputError, monitoringError, privateJson, readJson, WorkflowSchemaMissing } from '@/lib/monitoring/http'
import { missingWorkflowSchema } from '@/lib/monitoring/inbox'

const profileColumns = 'customer,name,email,company,city,notes,updated_at'
const fields = { name: 120, email: 200, company: 120, city: 120, notes: 2000 } as const

function customerId(value: unknown) {
  const customer = String(value ?? '').replace(/[+\s()-]/g, '')
  if (!/^[0-9]{6,20}$/.test(customer)) throw new MonitoringInputError('Invalid customer number')
  return customer
}

// Contact panel: editable details for one customer plus every conversation
// that customer has with any of this company's business numbers.
export async function GET(request: Request) {
  try {
    const access = await requireMonitoring('view_contacts')
    const { db: supabase, accountId } = access
    const customer = customerId(new URL(request.url).searchParams.get('customer'))
    const [threads, profile] = await Promise.all([
      scopeChannels(access, supabase.from('monitoring_threads').select('id,channel_id,lead_status,last_message_at,last_preview,last_direction,message_count,customer_name')
        .eq('account_id', accountId).eq('customer', customer)).order('last_message_at', { ascending: false }).limit(50),
      monitoringAdmin().from('monitoring_contact_profiles').select(profileColumns).eq('account_id', accountId).eq('customer', customer).maybeSingle(),
    ])
    if (threads.error) throw threads.error
    if (!access.full && !threads.data?.length) return privateJson({ error: 'Contact not found.' }, 404)
    const ready = !(profile.error && missingWorkflowSchema(profile.error))
    if (profile.error && ready) throw profile.error
    return privateJson({ profile: profile.data ?? null, conversations: threads.data, workflowReady: ready })
  } catch (error) { return monitoringError(error) }
}

export async function PUT(request: Request) {
  try {
    const access = await requireMonitoring('edit_contacts')
    const { db: supabase, accountId, userId } = access
    const body = await readJson(request)
    const customer = customerId(body.customer)
    // Only customers who actually have a conversation with this company.
    const known = await scopeChannels(access, supabase.from('monitoring_threads').select('id').eq('account_id', accountId).eq('customer', customer)).limit(1)
    if (known.error) throw known.error
    if (!known.data?.length) return privateJson({ error: 'Contact not found.' }, 404)
    const values: Record<string, string | null> = {}
    for (const [key, max] of Object.entries(fields)) {
      const value = body[key]
      if (value === undefined) continue
      if (value !== null && (typeof value !== 'string' || value.length > max)) throw new MonitoringInputError(`${key} must be ${max} characters or fewer.`)
      values[key] = typeof value === 'string' && value.trim() ? value.trim() : null
    }
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) throw new MonitoringInputError('Enter a valid email address.')
    // Two people editing the same contact: the second save is refused (409)
    // instead of silently overwriting the first. expected_updated_at is the
    // version the editor started from (null = no saved details yet).
    const admin = monitoringAdmin()
    const row = { ...values, updated_by: userId, updated_at: new Date().toISOString() }
    const expected = body.expected_updated_at
    if (expected !== undefined && expected !== null && typeof expected !== 'string') throw new MonitoringInputError('Invalid contact version.')
    const table = () => admin.from('monitoring_contact_profiles')
    const result = expected === undefined
      ? await table().upsert({ account_id: accountId, customer, ...row }, { onConflict: 'account_id,customer' }).select(profileColumns).maybeSingle()
      : expected === null
        ? await table().insert({ account_id: accountId, customer, ...row }).select(profileColumns).maybeSingle()
        : await table().update(row).eq('account_id', accountId).eq('customer', customer).eq('updated_at', expected).select(profileColumns).maybeSingle()
    const conflict = (result.error as { code?: string } | null)?.code === '23505'
    if (result.error && !conflict && missingWorkflowSchema(result.error)) throw new WorkflowSchemaMissing()
    if (result.error && !conflict) throw result.error
    if (conflict || !result.data) {
      const current = await table().select(profileColumns).eq('account_id', accountId).eq('customer', customer).maybeSingle()
      return privateJson({ error: 'Someone else changed this contact while you were editing. Their version is shown now; make your change again.', code: 'conflict', profile: current.data ?? null }, 409)
    }
    return privateJson({ profile: result.data })
  } catch (error) { return monitoringError(error) }
}
