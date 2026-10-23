import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { messagesForPath } from './area-messages'

/** Root layouts persist during navigation; each route group supplies its own messages. */
export async function AreaTranslations({ path, children }: { path: string; children: ReactNode }) {
  const [all, locale] = await Promise.all([getMessages(), getLocale()])
  const messages = messagesForPath(all, path)
  return <NextIntlClientProvider locale={locale} messages={messages as never}>{children}</NextIntlClientProvider>
}
