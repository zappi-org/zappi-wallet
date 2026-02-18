import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import {
  selectSyncState,
  selectLastSyncAt,
  selectAnchor,
  selectPendingRetries,
  selectFailedSwapsCount,
  selectSyncProgress,
  selectHasPendingItems,
  selectConfiguredRelays,
} from '@/store/selectors'
import { SyncService } from '@/services/sync/sync.service'

/**
 * Hook for sync operations
 */
export function useSync() {
  const { t } = useTranslation()
  const syncServiceRef = useRef<SyncService | null>(null)

  // Get sync service singleton
  const getSyncService = useCallback(() => {
    if (!syncServiceRef.current) {
      syncServiceRef.current = new SyncService()
    }
    return syncServiceRef.current
  }, [])

  // Store state
  const syncState = useAppStore(selectSyncState)
  const lastSyncAt = useAppStore(selectLastSyncAt)
  const anchor = useAppStore(selectAnchor)
  const pendingRetries = useAppStore(selectPendingRetries)
  const failedSwapsCount = useAppStore(selectFailedSwapsCount)
  const syncProgress = useAppStore(selectSyncProgress)
  const hasPendingItems = useAppStore(selectHasPendingItems)
  const configuredRelays = useAppStore(selectConfiguredRelays)

  // Store actions
  const setSyncState = useAppStore((state) => state.setSyncState)
  const setLastSyncAt = useAppStore((state) => state.setLastSyncAt)
  const setAnchor = useAppStore((state) => state.setAnchor)
  const setPendingRetries = useAppStore((state) => state.setPendingRetries)
  const setSyncProgress = useAppStore((state) => state.setSyncProgress)
  const resetSyncProgress = useAppStore((state) => state.resetSyncProgress)
  const addToast = useAppStore((state) => state.addToast)

  /**
   * Load sync status from service
   */
  const loadSyncStatus = useCallback(async () => {
    const syncService = getSyncService()
    const status = await syncService.getSyncStatus()

    if (status.lastSyncAt) {
      setLastSyncAt(status.lastSyncAt)
    }
    setPendingRetries(status.pendingRetries)

    const currentAnchor = await syncService.getAnchor()
    setAnchor(currentAnchor)
  }, [getSyncService, setLastSyncAt, setPendingRetries, setAnchor])

  /**
   * Update the sync anchor
   */
  const updateAnchor = useCallback(
    async (timestamp?: number) => {
      const syncService = getSyncService()
      const ts = timestamp ?? Math.floor(Date.now() / 1000)
      await syncService.updateAnchor(ts)
      const newAnchor = await syncService.getAnchor()
      setAnchor(newAnchor)
    },
    [getSyncService, setAnchor]
  )

  /**
   * Reconstruct state (sync missed events)
   */
  const reconstructState = useCallback(
    async (relays?: string[]) => {
      setSyncState('syncing')
      resetSyncProgress()

      try {
        const syncService = getSyncService()
        const targetRelays = relays ?? configuredRelays

        if (targetRelays.length === 0) {
          addToast({
            type: 'warning',
            message: t('toast.noRelays'),
          })
          return null
        }

        const result = await syncService.reconstructState(targetRelays)

        setLastSyncAt(Date.now())
        setSyncState('completed')

        if (result.eventsProcessed > 0) {
          addToast({
            type: 'success',
            message: t('toast.syncComplete', { count: result.eventsProcessed }),
          })
        }

        if (result.errors.length > 0) {
          addToast({
            type: 'warning',
            message: t('toast.syncErrors', { count: result.errors.length }),
          })
        }

        return result
      } catch {
        setSyncState('error')
        addToast({
          type: 'error',
          message: t('toast.syncFailed'),
        })
        return null
      }
    },
    [
      getSyncService,
      configuredRelays,
      setSyncState,
      setLastSyncAt,
      resetSyncProgress,
      addToast,
      t,
    ]
  )

  /**
   * Retry failed swaps
   */
  const retryFailedSwaps = useCallback(async () => {
    setSyncState('syncing')

    try {
      const syncService = getSyncService()
      const result = await syncService.retryFailedSwaps()

      // Reload sync status to get updated counts
      await loadSyncStatus()

      setSyncState('completed')

      if (result.succeeded > 0) {
        addToast({
          type: 'success',
          message: t('toast.retrySuccess', { count: result.succeeded }),
        })
      }

      if (result.failed > 0) {
        addToast({
          type: 'warning',
          message: t('toast.retryPartialFail', { count: result.failed }),
        })
      }

      return result
    } catch {
      setSyncState('error')
      addToast({
        type: 'error',
        message: t('toast.retryFailed'),
      })
      return null
    }
  }, [getSyncService, loadSyncStatus, setSyncState, addToast, t])

  /**
   * Check if an event has been processed
   */
  const isEventProcessed = useCallback(
    async (eventId: string): Promise<boolean> => {
      const syncService = getSyncService()
      return syncService.isEventProcessed(eventId)
    },
    [getSyncService]
  )

  /**
   * Mark an event as processed
   */
  const markEventProcessed = useCallback(
    async (
      eventId: string,
      result: 'success' | 'failed' | 'skipped',
      txId?: string,
      error?: string
    ) => {
      const syncService = getSyncService()
      await syncService.markEventProcessed(eventId, result, txId, error)
    },
    [getSyncService]
  )

  return {
    // State
    syncState,
    lastSyncAt,
    anchor,
    pendingRetries,
    failedSwapsCount,
    syncProgress,
    hasPendingItems,
    isSyncing: syncState === 'syncing',

    // Actions
    loadSyncStatus,
    updateAnchor,
    reconstructState,
    retryFailedSwaps,
    isEventProcessed,
    markEventProcessed,
    setSyncProgress,
  }
}
