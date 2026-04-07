import { useCallback } from 'react'
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
import { useContext } from 'react'
import type { RecoveryUseCase } from '@/core/ports/driving/recovery.usecase'
import { ServiceContext } from '@/hooks/service-context-value'

/**
 * Hook for recovery operations (anchor + token recovery + retry)
 */
export function useRecovery() {
  const { t } = useTranslation()
  const registry = useContext(ServiceContext)

  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)
  const nostrPubkey = useAppStore((state) => state.nostrPubkey)

  const getService = useCallback((): RecoveryUseCase | null => {
    if (!registry) return null
    return registry.recovery
  }, [registry])

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
  const setPendingRetries = useAppStore((state) => state.setPendingRetries)
  const setSyncProgress = useAppStore((state) => state.setSyncProgress)
  const resetSyncProgress = useAppStore((state) => state.resetSyncProgress)
  const addToast = useAppStore((state) => state.addToast)

  const loadSyncStatus = useCallback(async () => {
    const service = getService()
    if (!service) return

    const status = await service.getSyncStatus()

    if (status.lastSyncAt) {
      setLastSyncAt(status.lastSyncAt)
    }
    setPendingRetries(status.pendingRetries)
  }, [getService, setLastSyncAt, setPendingRetries])

  const syncAll = useCallback(
    async (relays?: string[]) => {
      const service = getService()
      if (!service || !nostrPrivkey || !nostrPubkey) return null

      setSyncState('syncing')
      resetSyncProgress()

      try {
        const targetRelays = relays ?? configuredRelays

        if (targetRelays.length === 0) {
          addToast({ type: 'warning', message: t('toast.noRelays') })
          return null
        }

        const result = await service.syncAll({
          privateKey: nostrPrivkey,
          publicKey: nostrPubkey,
          relays: targetRelays,
        })

        setLastSyncAt(Date.now())
        setSyncState('completed')

        if (result.tokensReceived > 0) {
          addToast({
            type: 'success',
            message: t('toast.syncComplete', { count: result.tokensReceived }),
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
        addToast({ type: 'error', message: t('toast.syncFailed') })
        return null
      }
    },
    [
      getService,
      nostrPrivkey,
      nostrPubkey,
      configuredRelays,
      setSyncState,
      setLastSyncAt,
      resetSyncProgress,
      addToast,
      t,
    ],
  )

  const retryFailedSwaps = useCallback(async () => {
    const service = getService()
    if (!service) return null

    setSyncState('syncing')

    try {
      const result = await service.retryFailedSwaps()
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
      addToast({ type: 'error', message: t('toast.retryFailed') })
      return null
    }
  }, [getService, loadSyncStatus, setSyncState, addToast, t])

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
    syncAll,
    retryFailedSwaps,
    setSyncProgress,
  }
}
