import { LoadingOrb } from '@/components/monitoring/ui'

// Shown straight away on a reload while the server checks the sign-in and reads the settings.
export default function Loading() {
  return <div className="flex min-h-dvh items-center justify-center bg-background"><LoadingOrb /></div>
}
