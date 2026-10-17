import { existingMonitoringToken } from '@/lib/monitoring/channel-token'
import { requireRole } from '@/lib/auth/account'
import { monitoringError, privateJson, readJson, requiredText } from '@/lib/monitoring/http'

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await readJson(request)
    const business = requiredText(body, 'business_id', 40)
    let token: string
    try { token = body.access_token ? requiredText(body, 'access_token', 8192) : await existingMonitoringToken(accountId) } catch { return privateJson({ error: 'Enter a valid Meta access token to load portfolio numbers.' }, 400) }
    if (!/^\d+$/.test(business)) return privateJson({ error: 'Invalid business portfolio ID.' }, 400)
    async function list(path: string, fields: string) {
      const items: Record<string, string>[] = []
      let after = ''
      for (let page = 0; page < 20; page++) {
        const url = new URL(`https://graph.facebook.com/v26.0/${path}`)
        url.searchParams.set('fields', fields); url.searchParams.set('limit', '100')
        if (after) url.searchParams.set('after', after)
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
        const result = await response.json()
        if (!response.ok) throw new Error('Meta access unavailable')
        items.push(...result.data)
        if (!result.paging?.next) return items
        after = result.paging.cursors?.after
        if (!after) throw new Error('Incomplete Meta results')
      }
      throw new Error('Too many accounts')
    }
    try {
      const accounts = await list(`${business}/owned_whatsapp_business_accounts`, 'id,name')
      const numbers = []
      for (const account of accounts) {
        if (!/^\d+$/.test(account.id)) continue
        const phones = await list(`${account.id}/phone_numbers`, 'id,display_phone_number,verified_name')
        numbers.push(...phones.map(phone => ({ phone_number_id: phone.id, display_number: phone.display_phone_number, label: phone.verified_name || account.name, waba_id: account.id })))
      }
      return privateJson({ numbers })
    } catch { return privateJson({ error: 'Meta could not list this portfolio. Check token expiry, business_management permission, and WhatsApp account access.' }, 400) }
  } catch (error) { return monitoringError(error) }
}
