import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Bound native thread pools before Next/SWC initializes. These settings apply
// only to the build subprocess; runtime configuration and secrets are inherited.
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', '--webpack'], {
  stdio: 'inherit',
  env: { ...process.env, TOKIO_WORKER_THREADS: '2', RAYON_NUM_THREADS: '2' },
})
if (result.error) console.error('Unable to start Next.js build:', result.error.message)
if (result.signal) console.error(`Next.js build stopped by ${result.signal}`)
process.exit(result.status ?? 1)
