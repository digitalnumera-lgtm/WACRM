import { monitoringError, privateJson } from '@/lib/monitoring/http'
import { TrackerConnectionError } from './connection'

export function trackerError(error: unknown) {
  if (error instanceof TrackerConnectionError) return privateJson({ error: error.message, code: error.code }, error.code === 'not_connected' ? 409 : 502)
  return monitoringError(error)
}
