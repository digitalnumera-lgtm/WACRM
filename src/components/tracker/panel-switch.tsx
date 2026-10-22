'use client'

import { ArrowLeftRight } from 'lucide-react'
import { rememberPanel } from './panel'

/** Sidebar button above Settings that moves between the WhatsApp CRM and the Client Tracker. */
export function PanelSwitchButton({ to }: { to: 'crm' | 'tracker' }) {
  const label = to === 'tracker' ? 'Switch to Client Tracker' : 'Switch to WhatsApp CRM'
  return <a href={to === 'tracker' ? '/tracker' : '/monitoring'} onClick={() => rememberPanel(to)} aria-label={label} title={label}
    className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground">
    <ArrowLeftRight size={18} />
  </a>
}
