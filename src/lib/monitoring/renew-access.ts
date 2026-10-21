import { MediaFailure, metaResponseFailure } from './media-errors'

type NumberAccess = { phone_number_id: string; waba_id: string }
// Read-only verification. Never register numbers, modify subscriptions or
// follow provider-supplied URLs with the submitted token.
export async function verifyRenewedAccess(numbers: NumberAccess[], token: string) {
  const groups = new Map<string, Set<string>>()
  for (const number of numbers) {
    if (!/^\d+$/.test(number.phone_number_id) || !/^\d+$/.test(number.waba_id)) throw new Error('Invalid stored Meta identifiers')
    if (!groups.has(number.waba_id)) groups.set(number.waba_id, new Set())
    groups.get(number.waba_id)!.add(number.phone_number_id)
  }
  for (const [waba, wanted] of groups) {
    let after = ''
    for (let page = 0; page < 20 && wanted.size; page++) {
      const url = new URL(`https://graph.facebook.com/v26.0/${waba}/phone_numbers`)
      url.searchParams.set('fields', 'id'); url.searchParams.set('limit', '100')
      if (after) url.searchParams.set('after', after)
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw await metaResponseFailure(response)
      const data = await response.json()
      if (!Array.isArray(data.data)) throw new MediaFailure('meta_access_denied')
      for (const phone of data.data) wanted.delete(String(phone.id))
      if (!wanted.size || !data.paging?.next) break
      if (typeof data.paging?.cursors?.after !== 'string' || !data.paging.cursors.after) throw new MediaFailure('meta_access_denied')
      after = data.paging.cursors.after
    }
    if (wanted.size) throw new MediaFailure('meta_access_denied')
  }
}
