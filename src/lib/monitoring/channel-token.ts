import { monitoringAdmin } from './admin'
import { decrypt } from '@/lib/whatsapp/encryption'
/** Reuse only a credential attached to the authenticated manager's company. */
export async function existingMonitoringToken(accountId: string): Promise<string> {
  const db = monitoringAdmin()
  const channels = await db.from('monitoring_channels').select('id').eq('account_id', accountId).eq('active', true).order('created_at', { ascending: false }).limit(1)
  if (channels.error || !channels.data?.length) throw new Error('No configured channel')
  const credential = await db.from('monitoring_credentials').select('encrypted_token').eq('channel_id', channels.data[0].id).maybeSingle()
  if (credential.error || !credential.data) throw new Error('No channel credential')
  return decrypt(credential.data.encrypted_token)
}
