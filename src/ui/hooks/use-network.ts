import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import {
  selectNetworkState,
  selectIsOnline,
  selectIsOffline,
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
  const connectedRelays = useAppStore(selectConnectedRelays)
  const connectedRelayCount = useAppStore(selectConnectedRelayCount)

  // Store actions
  const setNetworkState = useAppStore((state) => state.setNetworkState)
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

  // wasOffline/needsRecovery/clearWasOffline 제거 (3단계 구현 리뷰 #4):
  // 유일한 소비자였던 use-mint-health의 reconnect effect가 bootstrap 단일
  // 리스너로 대체되면서, 이 플래그는 첫 오프라인 이후 영구 true로 남는
  // dead state가 됐다 — 다음 소비자를 위한 함정이라 통째로 제거.

  return {
    // State
    networkState,
    isOnline,
    isOffline,
    connectedRelays,
    connectedRelayCount,

    // Actions
    setNetworkState,
    addConnectedRelay,
    removeConnectedRelay,
    setConnectedRelays,
  }
}
