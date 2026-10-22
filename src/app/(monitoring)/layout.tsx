import { Funnel_Display, Funnel_Sans } from 'next/font/google'

// Numera brand type for the CRM workspace.
const sans = Funnel_Sans({ subsets: ['latin'], variable: '--font-funnel-sans', display: 'swap' })
const display = Funnel_Display({ subsets: ['latin'], variable: '--font-funnel-display', weight: ['500', '600', '700'], display: 'swap' })

export default function MonitoringLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${sans.variable} ${display.variable}`}>{children}</div>
}
