import { requireRole } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { monitoringAdmin } from '@/lib/monitoring/admin'
import { listWabaPhoneNumbers, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { MonitoringInputError, monitoringError, privateJson, readJson, requiredText } from '@/lib/monitoring/http'

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await readJson(request)
    const phone = requiredText(body, 'phone_number_id', 40)
    const waba = requiredText(body, 'waba_id', 40)
    const label = requiredText(body, 'label')
    const accessToken = requiredText(body, 'access_token', 8192)
    if (!/^\d+$/.test(phone) || !/^\d+$/.test(waba)) throw new MonitoringInputError('Meta IDs must contain digits only')
    // These Meta calls are read-only. Never register a number or subscribe an app.
    let info
    try {
      info = await verifyPhoneNumber({ phoneNumberId: phone, accessToken })
      const numbers = await listWabaPhoneNumbers({ wabaId: waba, accessToken })
      if (!numbers.some(number => number.id === phone)) throw new Error('Number mismatch')
    } catch { return privateJson({ error: 'Unable to verify this number with the supplied Numera Meta app credentials.' }, 400) }
    // The existing RPC is service-role only so encrypted tokens are never
    // writable through a browser session. Account comes only from requireRole.
    const result = await monitoringAdmin().rpc('create_monitoring_channel', {
      p_account: accountId, p_phone: phone, p_waba: waba, p_label: label,
      p_display: info.display_phone_number, p_token: encrypt(accessToken),
    })
    if (result.error) {
      if (result.error.code === '23505') return privateJson({ error: 'This number is already configured.' }, 409)
      throw result.error
    }
    return privateJson({ success: true }, 201)
  } catch (error) { return monitoringError(error) }
}
