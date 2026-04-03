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
import { NostrGatewayAdapter } from '@/adapters/nostr/nostr-gateway'
import { createRecoverTokenService } from '@/composition/recover-token'
import type { RecoverTokenUseCase } from '@/core/ports/driving/recover-token.usecase'

/**
 * Hook for NUT-18 Direct Token recovery operations
 */
export function useRecoverToken() {
  const { t } = useTranslation()
  const serviceRef = useRef<RecoverTokenUseCase | null>(null)

  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)
  const nostrPubkey = useAppStore((state) => state.nostrPubkey)

  // Lazy create — needs NostrGateway with privateKey
  const getService = useCallback(() => {
    if (!nostrPrivkey) return null
    if (!serviceRef.current) {
      const nostrGateway = new NostrGatewayAdapter({ privateKeyHex: nostrPrivkey })
      serviceRef.current = createRecoverTokenService(nostrGateway)
    }
    return serviceRef.current
  }, [nostrPrivkey])

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

  const loadSyncStatus = useCallback(async () => {
    const service = getService()
    if (!service) return

    const status = await service.getSyncStatus()

    if (status.lastSyncAt) {
      setLastSyncAt(status.lastSyncAt)
    }
    setPendingRetries(status.pendingRetries)

    const currentAnchor = await service.getAnchor()
    setAnchor(currentAnchor)
  }, [getService, setLastSyncAt, setPendingRetries, setAnchor])

  const updateAnchor = useCallback(
    async (timestamp?: number) => {
      const service = getService()
      if (!service) return

      const ts = timestamp ?? Math.floor(Date.now() / 1000)
      await service.updateAnchor(ts)
      const newAnchor = await service.getAnchor()
      setAnchor(newAnchor)
    },
    [getService, setAnchor],
  )

  const reconstructState = useCallback(
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

        const result = await service.reconstructState({
          privateKey: nostrPrivkey,
          publicKey: nostrPubkey,
          relays: targetRelays,
        })

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
    updateAnchor,
    reconstructState,
    retryFailedSwaps,
    setSyncProgress,
  }
}
