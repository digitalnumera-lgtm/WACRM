'use client'

import { useEffect, useState } from 'react'
import type { ThreadWorkflow } from '@/lib/monitoring/workflow-types'

export function useThreadWorkflows(ids: string, refresh: number) {
  const [workflows, setWorkflows] = useState<Record<string, ThreadWorkflow>>({})
  const [error, setError] = useState('')
  useEffect(() => {
    if (!ids) return
    const controller = new AbortController()
    const values = ids.split(',')
    async function load() {
      try {
        // Bound requests and metadata query size while preserving unlimited
        // conversation scrolling. Never block the primary inbox request.
        for (let index = 0; index < values.length; index += 100) {
          const response = await fetch(`/api/monitoring/workflow?ids=${values.slice(index, index + 100).join(',')}`, { cache: 'no-store', signal: controller.signal })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || 'Unable to load conversation status.')
          if (controller.signal.aborted) return
          setWorkflows(old => ({ ...old, ...data.workflows }))
        }
        setError('')
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message) }
    }
    void load()
    return () => controller.abort()
  }, [ids, refresh])
  return { workflows, error, setWorkflows }
}
