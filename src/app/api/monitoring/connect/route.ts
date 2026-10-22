import { assertAllNumbers, requireMonitoring } from '@/lib/monitoring/team-access'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { MonitoringInputError, monitoringError, privateJson, readJson, requiredText } from '@/lib/monitoring/http'
import { ConnectError, exchangeSignupCode, readConnection, requestSync, sharedWhatsAppAccounts, SYNC_TYPES, writeConnection, type ConnectionRecord } from '@/lib/monitoring/connect'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { listWabaPhoneNumbers, subscribeWabaToApp, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

export const runtime = 'nodejs'

/**
 * Completes "Connect number" (Meta Embedded Signup for WhatsApp Business app
 * numbers): exchange the one-time code, verify the number, subscribe this app
 * to the account's webhooks, add or refresh the CRM channel, then request the
 * one-time contacts and chat-history sync. The number is never re-registered,
 * so the agent's WhatsApp Business app keeps working.
 */
export async function POST(request: Request) {
  try {
    const access = await requireMonitoring('manage_numbers')
    assertAllNumbers(access)
    const { accountId, userId } = access
    const body = await readJson(request)
    const code = requiredText(body, 'code', 2048)
    const reportedWaba = typeof body.waba_id === 'string' && body.waba_id ? body.waba_id : null
    const label = requiredText(body, 'label', 120)
    const requestedPhone = typeof body.phone_number_id === 'string' && body.phone_number_id ? body.phone_number_id : null
    if ((reportedWaba && !/^\d+$/.test(reportedWaba)) || (requestedPhone && !/^\d+$/.test(requestedPhone))) throw new MonitoringInputError('Meta IDs must contain digits only')

    let token: string
    try { token = await exchangeSignupCode(code) } catch (error) {
      if (error instanceof ConnectError) return privateJson({ error: error.message }, error.status)
      return privateJson({ error: 'Meta could not be reached. Please run Connect again.' }, 503)
    }

    // Meta's popup normally reports the WhatsApp account. If it did not, read
    // the account(s) the business shared from the new token instead.
    let waba = reportedWaba
    if (!waba) {
      const shared = await sharedWhatsAppAccounts(token).catch(() => [] as string[])
      if (shared.length === 1) waba = shared[0]
      else if (shared.length > 1) {
        const owners: string[] = []
        for (const id of shared.slice(0, 20)) {
          const numbers = await listWabaPhoneNumbers({ wabaId: id, accessToken: token }).catch(() => [])
          if (requestedPhone ? numbers.some(n => n.id === requestedPhone) : numbers.length > 0) owners.push(id)
        }
        if (owners.length === 1) waba = owners[0]
        else return privateJson({ error: `Meta shared ${shared.length} WhatsApp accounts. Run Connect again and select only this agent’s WhatsApp account and number.` }, 400)
      } else return privateJson({ error: 'Meta did not share a WhatsApp account. Run Connect again and, in Meta’s window, select the agent’s WhatsApp Business account and number.' }, 400)
    }

    // Resolve the number inside the shared WhatsApp account. A coexistence
    // finish event may omit the phone ID; a single-number account is unambiguous.
    let phone: string, display: string | null
    try {
      const numbers = await listWabaPhoneNumbers({ wabaId: waba, accessToken: token })
      const match = requestedPhone ? numbers.find(n => n.id === requestedPhone) : numbers.length === 1 ? numbers[0] : undefined
      if (!match) {
        return privateJson({ error: numbers.length > 1 && !requestedPhone ? 'This WhatsApp account has several numbers. Run Connect again and choose one number.' : 'The selected number was not found in that WhatsApp account.' }, 400)
      }
      phone = match.id
      display = (await verifyPhoneNumber({ phoneNumberId: phone, accessToken: token })).display_phone_number ?? match.display_phone_number ?? null
    } catch { return privateJson({ error: 'Meta did not allow access to this WhatsApp account. Run Connect again and grant access to the number.' }, 400) }

    try { await subscribeWabaToApp({ wabaId: waba, accessToken: token }) }
    catch { return privateJson({ error: 'Meta did not allow the CRM to receive this account’s messages (webhook subscription failed). Nothing was saved.' }, 502) }

    const db = monitoringAdmin()
    const existing = await db.from('monitoring_channels').select('id,account_id,active').eq('phone_number_id', phone)
    if (existing.error) throw existing.error
    if (existing.data?.some(c => c.account_id !== accountId)) return privateJson({ error: 'This number belongs to another CRM workspace.' }, 409)
    let channelId = existing.data?.[0]?.id as string | undefined
    let tokenSource: ConnectionRecord['token_source'] = 'embedded_signup'
    if (channelId) {
      // Keep a working saved credential (e.g. a permanent system-user token);
      // otherwise store the newly issued one.
      const saved = await db.from('monitoring_credentials').select('encrypted_token').eq('channel_id', channelId).maybeSingle()
      let keep = false
      if (!saved.error && saved.data) {
        try { await verifyPhoneNumber({ phoneNumberId: phone, accessToken: decrypt(saved.data.encrypted_token) }); keep = true } catch { keep = false }
      }
      if (keep) tokenSource = 'existing'
      else {
        const credential = await db.from('monitoring_credentials').upsert({ channel_id: channelId, encrypted_token: encrypt(token) }, { onConflict: 'channel_id' })
        if (credential.error) throw credential.error
      }
      const update = await db.from('monitoring_channels').update({ active: true, label, waba_id: waba, ...(display ? { display_number: display } : {}) }).eq('account_id', accountId).eq('id', channelId)
      if (update.error) throw update.error
    } else {
      const created = await db.rpc('create_monitoring_channel', { p_account: accountId, p_phone: phone, p_waba: waba, p_label: label, p_display: display ?? phone, p_token: encrypt(token) })
      if (created.error) throw created.error
      const row = await db.from('monitoring_channels').select('id').eq('account_id', accountId).eq('phone_number_id', phone).maybeSingle()
      if (row.error || !row.data) throw row.error ?? new Error('Channel not found after creation')
      channelId = row.data.id as string
    }

    // Request contacts first, then history (Meta's documented order). Each can
    // run only once per onboarding, so a previous success is never repeated.
    const previous = await readConnection(db, accountId, channelId)
    const reconnected = !previous || previous.waba_id !== waba || Date.now() - Date.parse(previous.connected_at) > 60_000
    const record: ConnectionRecord = { connected_at: new Date().toISOString(), connected_by: userId, waba_id: waba, phone_number_id: phone, display_number: display, token_source: tokenSource, syncs: reconnected ? {} : previous!.syncs }
    for (const type of SYNC_TYPES) if (!record.syncs[type]?.ok) record.syncs[type] = await requestSync(phone, token, type)
    await writeConnection(db, accountId, channelId, record)
    return privateJson({ channel_id: channelId, display_number: display, syncs: record.syncs }, 201)
  } catch (error) { return monitoringError(error) }
}
