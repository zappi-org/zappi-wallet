import { OUTGOING_ECASH_SYNC } from '@/core/constants'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { useCallback, useEffect, useRef } from 'react'

type OutgoingEcashRegistry = Pick<ServiceRegistry, 'outgoingEcashLifecycle'>

export interface UseOutgoingEcashReconcilePollerOptions {
  registry: OutgoingEcashRegistry | null | undefined
  enabled: boolean
  isOnline: boolean
  cashuInitPromiseRef: { current: Promise<void> | null }
  intervalMs?: number
}

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

export function useOutgoingEcashReconcilePoller({
  registry,
  enabled,
  isOnline,
  cashuInitPromiseRef,
  intervalMs = OUTGOING_ECASH_SYNC.ACTIVE_POLL_MS,
}: UseOutgoingEcashReconcilePollerOptions): void {
  const inFlightRef = useRef(false)

  const runReconcile = useCallback(async () => {
    if (!enabled || !isOnline || !registry?.outgoingEcashLifecycle) return
    if (!isDocumentVisible()) return
    if (inFlightRef.current) return

    inFlightRef.current = true
    try {
      await cashuInitPromiseRef.current
      await registry.outgoingEcashLifecycle.reconcileOpen()
    } catch (error) {
      console.error('[OutgoingEcashPoller] reconcile failed:', error)
    } finally {
      inFlightRef.current = false
    }
  }, [cashuInitPromiseRef, enabled, isOnline, registry])

  useEffect(() => {
    if (!enabled || !isOnline || !registry?.outgoingEcashLifecycle) return
    if (typeof window === 'undefined') return

    const timer = window.setInterval(() => {
      void runReconcile()
    }, intervalMs)

    const handleVisibilityChange = () => {
      if (isDocumentVisible()) {
        void runReconcile()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, intervalMs, isOnline, registry, runReconcile])
}
