/** Dedicated management reply transport. Its caller must authenticate an admin,
 * resolve the company-owned thread and atomically reserve the request first.
 * This does not enable the legacy agent, campaign or automation transports.
 */
export type ReplyOutcome = { state: 'accepted'; meta_id: string } | { state: 'rejected'; code: number | null } | { state: 'uncertain' }
export async function submitManagementText(phoneId: string, token: string, customer: string, text: string): Promise<ReplyOutcome> {
  if (!/^\d+$/.test(phoneId) || !/^\d{6,20}$/.test(customer) || !text.trim() || [...text].length > 4096) throw new Error('Invalid reply')
  try {
    const response = await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: customer, type: 'text', text: { preview_url: false, body: text } }),
    })
    const data = await response.json()
    if (response.ok && typeof data.messages?.[0]?.id === 'string') return { state: 'accepted', meta_id: data.messages[0].id }
    // Only an explicit Graph client error proves rejection. Timeouts, proxy
    // errors and malformed responses cannot prove that no message was sent.
    if (response.status >= 400 && response.status < 500 && typeof data.error?.code === 'number') return { state: 'rejected', code: data.error.code }
    return { state: 'uncertain' }
  } catch { return { state: 'uncertain' } }
}
