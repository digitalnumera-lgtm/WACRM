import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider, useTranslations } from 'next-intl'
import messages from '../../../messages/en.json'
import { AreaTranslations } from './area-translations'

vi.mock('next-intl/server', () => ({ getMessages: async () => messages, getLocale: async () => 'en' }))

function SignupHeading() {
  const t = useTranslations('SignupPage')
  return createElement('h1', null, t('titleJoin'))
}

function LoginHeading() {
  const t = useTranslations('LoginPage')
  return createElement('h1', null, t('titleAccept'))
}

describe('route-local translations', () => {
  it('renders signup text even when the preserved root has only invite translations', async () => {
    const content = await AreaTranslations({ path: '/signup', children: createElement(SignupHeading) })
    const html = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={{ JoinPage: messages.JoinPage }} timeZone="UTC">{content}</NextIntlClientProvider>)
    expect(html).toBe(renderToStaticMarkup(createElement('h1', null, messages.SignupPage.titleJoin)))
    expect(html).not.toContain('SignupPage.titleJoin')
  })

  it('renders login text even when the preserved root has no auth translations', async () => {
    const content = await AreaTranslations({ path: '/login', children: createElement(LoginHeading) })
    const html = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={{}} timeZone="UTC">{content}</NextIntlClientProvider>)
    expect(html).toBe(renderToStaticMarkup(createElement('h1', null, messages.LoginPage.titleAccept)))
    expect(html).not.toContain('LoginPage.titleAccept')
  })

  it('supplies invite and role messages after leaving an authentication page', async () => {
    const content = await AreaTranslations({ path: '/join', children: 'invite' })
    expect(content.props.messages).toEqual({ JoinPage: messages.JoinPage, Settings: { roles: messages.Settings.roles } })
  })
})
