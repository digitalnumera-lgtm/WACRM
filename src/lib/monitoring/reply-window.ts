export const customerMessageKinds = ['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'interactive', 'button']
export function replyWindow(lastInbound: string | null, now = Date.now()) {
  const timestamp = lastInbound ? Date.parse(lastInbound) : NaN
  const expires = timestamp + 24 * 60 * 60 * 1000
  return { open: Number.isFinite(timestamp) && timestamp <= now && expires > now, expires_at: Number.isFinite(expires) ? new Date(expires).toISOString() : null }
}
