'use client'

import { Icon3D } from './ui'

type Topic = { icon: string; title: string; when: string; where: string; steps: string[] }

const CRM: Topic[] = [
  { icon: 'combo-chart', title: 'Start of the day', when: 'Every morning', where: 'Dashboard', steps: ['Waiting for an agent now: chats nobody answered', 'New numbers today and each agent’s card', 'Tap an agent card to open their inbox'] },
  { icon: 'inbox', title: 'Check unanswered chats', when: 'During the day', where: 'Inbox → Waiting', steps: ['The red counter shows customer messages without a reply', 'It disappears as soon as the agent replies', 'Drag the list edge to make it wider'] },
  { icon: 'search', title: 'Find a customer', when: 'Any time', where: 'Inbox search', steps: ['Type a name, any part of a message, or a number', '0300…, 92300… and +92 300… all match the same person'] },
  { icon: 'price-tag', title: 'Sort leads', when: 'After reading a chat', where: 'Chat → contact panel', steps: ['Set the lead stage: new, contacted, qualified, won, lost', 'Add labels and a private note', 'Leads board shows every stage at a glance'] },
  { icon: 'picture', title: 'Photos, videos, voice notes', when: 'Proof or files from a chat', where: 'Media', steps: ['Filter by number or customer', 'The ⌄ on any message: info, copy, download'] },
  { icon: 'bar-chart', title: 'Agent performance', when: 'Weekly', where: 'Reports', steps: ['Reply times, waiting chats and volume per agent', 'Message search across every chat'] },
  { icon: 'conference-call', title: 'Give or remove access', when: 'New or leaving staff', where: 'Settings → Team & roles', steps: ['Invite by email with a role and numbers', 'Remove someone: they lose access on their next click'] },
  { icon: 'meta', title: 'A number stopped updating', when: 'No new messages from one agent', where: 'Settings → Meta access', steps: ['Renew Meta access for that number', 'Paused numbers are hidden everywhere until restored'] },
  { icon: 'security-checked', title: 'Keep the account safe', when: 'Once', where: 'Settings → Security', steps: ['Two-step sign-in with an authenticator app', 'Sign out everywhere if a phone is lost'] },
]

const TRACKER: Topic[] = [
  { icon: 'handshake', title: 'A deal was closed', when: 'Agent closes a client', where: 'Closed Deal form, or Deals → Add deal', steps: ['Gets the next deal number and waits for approval', 'The advance goes into the Payment Log', 'Shows here within seconds'] },
  { icon: 'approval', title: 'Approve a deal', when: 'After checking it', where: 'Deals → client → Approve, or tick Approved in the Sheet', steps: ['Creates the Drive folder, ClickUp project and logins page', 'Approving twice never makes two projects'] },
  { icon: 'cash-in-hand', title: 'Money came in or went back', when: 'Payment or refund', where: 'Payment form, or client → Payment or refund', steps: ['Balances and commission update straight away', 'Fix a mistake with the pencil on the payment, or remove it'] },
  { icon: 'contacts', title: 'Fix client details', when: 'Wrong phone, email, amount', where: 'Client → Edit details', steps: ['Same as editing the Deals tab', 'Services text, balances and logins list follow'] },
  { icon: 'verified-account', title: 'Client status', when: 'Onboarding, active, on hold, offboarded', where: 'Client → Client status', steps: ['The ClickUp project status follows', 'Offboarded asks for the date and reason'] },
  { icon: 'coins', title: 'Pay commission', when: 'Pay day', where: 'Commission → Statement', steps: ['Pick the date; tick to count that day too', 'Record what you actually paid', 'Paid more or less: the difference carries to the next statement'] },
  { icon: 'calendar', title: 'Rates', when: 'Target or someone’s rate changes', where: 'Commission → Rates, or Settings', steps: ['Defaults: monthly target, below / at-or-above rates, manager rate', 'Own rate for one person; empty uses the default'] },
  { icon: 'tools', title: 'Health check, delete a deal', when: 'Something looks wrong', where: 'Tools', steps: ['Health check lists what to fix', 'Delete removes the deal everywhere, like the Tools tab'] },
  { icon: 'key', title: 'Who sees Clients', when: 'New finance or project staff', where: 'Settings → Who can open Clients', steps: ['View, View + amounts, or Full', 'Agents have no access unless you give it'] },
]

function Guide({ topics }: { topics: Topic[] }) {
  return <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{topics.map(t => <article key={t.title} className="crm-card flex items-start gap-4 p-5">
    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted/70"><Icon3D name={t.icon} size={30} /></span>
    <div className="min-w-0 space-y-2">
      <h2 className="font-semibold">{t.title}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs"><dt className="text-muted-foreground">When</dt><dd>{t.when}</dd><dt className="text-muted-foreground">Where</dt><dd className="font-medium">{t.where}</dd></dl>
      <ol className="list-decimal space-y-0.5 pl-4 text-sm">{t.steps.map(s => <li key={s}>{s}</li>)}</ol>
    </div>
  </article>)}</div>
}

export const CrmHelp = () => <Guide topics={CRM} />
export const TrackerHelp = () => <Guide topics={TRACKER} />
