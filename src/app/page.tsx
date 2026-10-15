import { redirect } from 'next/navigation'
import { monitoringOnly } from '@/lib/monitoring/policy'

export default function RootPage() {
  redirect(monitoringOnly() ? '/monitoring' : '/dashboard')
}
