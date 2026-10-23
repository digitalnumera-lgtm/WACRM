import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'

/**
 * Sends translations to the browser only for the areas that use them, and only
 * the parts they need: the full English file is about 130 KB and used to ride
 * along with every page, including Chats and Clients, which use none of it.
 */
export async function IntlProvider({ children, only }: { children: React.ReactNode; only?: string[] }) {
  const all = await getMessages() as Record<string, unknown>
  const messages = only ? pick(all, only) : all
  return <NextIntlClientProvider messages={messages as never}>{children}</NextIntlClientProvider>
}

/** Keeps the listed namespaces; "A.b" keeps only b inside A. */
function pick(all: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const [top, sub] = key.split('.')
    if (!(top in all)) continue
    if (!sub) { out[top] = all[top]; continue }
    const inner = (all[top] ?? {}) as Record<string, unknown>
    out[top] = { ...(out[top] as object ?? {}), [sub]: inner[sub] }
  }
  return out
}
