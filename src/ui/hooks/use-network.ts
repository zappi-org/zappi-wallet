import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import {
  selectNetworkState,
  selectIsOnline,
  selectIsOffline,
  selectWasOffline,
  selectConnectedRelays,
  selectConnectedRelayCount,
} from '@/store/selectors'

/**
 * Hook for network state management
 */
export function useNetwork() {
  const { t } = useTranslation()
  // Store state
  const networkState = useAppStore(selectNetworkState)
  const isOnline = useAppStore(selectIsOnline)
  const isOffline = useAppStore(selectIsOffline)
  const wasOffline = useAppStore(selectWasOffline)
  const connectedRelays = useAppStore(selectConnectedRelays)
  const connectedRelayCount = useAppStore(selectConnectedRelayCount)

  // Store actions
  const setNetworkState = useAppStore((state) => state.setNetworkState)
  const setWasOffline = useAppStore((state) => state.setWasOffline)
  const setConnectedRelays = useAppStore((state) => state.setConnectedRelays)
  const addConnectedRelay = useAppStore((state) => state.addConnectedRelay)
  const removeConnectedRelay = useAppStore((state) => state.removeConnectedRelay)
  const addToast = useAppStore((state) => state.addToast)

  /**
   * Handle online event
   */
  const handleOnline = useCallback(() => {
    setNetworkState('ONLINE')
    addToast({
      type: 'success',
      message: t('toast.onlineRestored'),
      duration: 3000,
    })
  }, [setNetworkState, addToast, t])

  /**
   * Handle offline event
   */
  const handleOffline = useCallback(() => {
    setNetworkState('OFFLINE')
    setConnectedRelays([])
    addToast({
      type: 'warning',
      message: t('toast.offlineStatus'),
      duration: 5000,
    })
  }, [setNetworkState, setConnectedRelays, addToast, t])

  /**
   * Setup browser network event listeners
   */
  useEffect(() => {
    // Set initial state
    if (typeof navigator !== 'undefined') {
      setNetworkState(navigator.onLine ? 'ONLINE' : 'OFFLINE')
    }

    // Add event listeners
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [handleOnline, handleOffline, setNetworkState])

  /**
   * Clear wasOffline flag after handling recovery
   */
  const clearWasOffline = useCallback(() => {
    setWasOffline(false)
  }, [setWasOffline])

  /**
   * Check if we need to recover from offline state
   */
  const needsRecovery = wasOffline && isOnline

  return {
    // State
    networkState,
    isOnline,
    isOffline,
    wasOffline,
    connectedRelays,
    connectedRelayCount,
    needsRecovery,

    // Actions
    setNetworkState,
    clearWasOffline,
    addConnectedRelay,
    removeConnectedRelay,
    setConnectedRelays,
  }
}
