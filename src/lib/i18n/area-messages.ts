// Which translations the browser needs for a page. The full English file is
// about 130 KB; Chats and Clients use none of it and the sign-in pages only a
// few sections, so they no longer download the rest with every page.
type Messages = Record<string, unknown>

const AREAS: { test: RegExp; keep: string[] | null }[] = [
  { test: /^\/(monitoring|tracker)(\/|$)/, keep: [] },
  { test: /^\/(login|signup|forgot-password|reset-password)(\/|$)/, keep: ['LoginPage', 'SignupPage', 'ForgotPasswordPage', 'ResetPasswordPage', 'Common'] },
  { test: /^\/join(\/|$)/, keep: ['JoinPage', 'Settings.roles', 'Common'] },
]

export function messagesForPath(all: Messages, path: string): Messages {
  const area = AREAS.find(a => a.test.test(path))
  return area?.keep ? pick(all, area.keep) : all
}

/** Keeps the listed sections; "A.b" keeps only b inside A. */
export function pick(all: Messages, keys: string[]): Messages {
  const out: Messages = {}
  for (const key of keys) {
    const [top, sub] = key.split('.')
    if (!(top in all)) continue
    if (!sub) { out[top] = all[top]; continue }
    out[top] = { ...((out[top] as Messages | undefined) ?? {}), [sub]: (all[top] as Messages | undefined)?.[sub] }
  }
  return out
}
