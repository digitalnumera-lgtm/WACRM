import { OrbitRing } from '@/components/monitoring/loaders'

// Shown straight away on a reload while the server checks the sign-in. CSS-only, so it moves before any script loads.
export default function Loading() {
  return <div className="flex min-h-dvh items-center justify-center bg-background text-primary"><OrbitRing className="size-10" /></div>
}
