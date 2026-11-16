import { useEffect, useState, useCallback, useRef } from 'react'
import type { LiveTelemetry } from './types'

export function useLiveData(pollIntervalMs = 20_000) {
  const [telemetry, setTelemetry] = useState<LiveTelemetry | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const isMounted = useRef(true)

  const fetchLive = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setLoading(true)
      const endpoint = isRefresh ? '/api/live/refresh' : '/api/live'
      const options = isRefresh ? { method: 'POST' } : { method: 'GET' }
      const res = await fetch(endpoint, options)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      const data = await res.json()
      const payload: LiveTelemetry = isRefresh && data.data ? data.data : data
      if (isMounted.current) {
        setTelemetry(payload)
        setError(null)
        setLastFetched(new Date())
      }
    } catch (err: any) {
      if (isMounted.current) {
        console.warn('[LiveData] Fetch error:', err.message)
        setError(err.message)
      }
    } finally {
      if (isMounted.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    isMounted.current = true
    void fetchLive()
    const timer = setInterval(() => {
      void fetchLive()
    }, pollIntervalMs)
    return () => {
      isMounted.current = false
      clearInterval(timer)
    }
  }, [fetchLive, pollIntervalMs])

  return {
    telemetry,
    loading,
    error,
    lastFetched,
    refresh: () => fetchLive(true),
  }
}
