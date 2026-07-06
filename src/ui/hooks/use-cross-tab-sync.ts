import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { getBroadcastChannel } from '@/utils/cross-tab-sync'
import type { SyncMessage } from '@/utils/cross-tab-sync'

/**
 * Cross-tab synchronization hook using BroadcastChannel API.
 * When one tab makes a state-changing operation (payment, mint change, etc.),
 * it broadcasts a sync signal. Other tabs receive the signal and refresh
 * their balance/transactions from IndexedDB.
 */
export function useCrossTabSync() {
  const triggerTxRefresh = useAppStore((s) => s.triggerTxRefresh)

  useEffect(() => {
    const channel = getBroadcastChannel()
    if (!channel) return

    const handler = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data
      if (msg.type === 'balance_changed' || msg.type === 'tx_changed') {
        triggerTxRefresh()
      } else if (msg.type === 'settings_changed' || msg.type === 'logout') {
        // logout: 소거 주체 탭이 데이터를 지웠다 — 이 탭도 reload 로 메모리 잔상을 버린다
        window.location.reload()
      }
    }

    channel.addEventListener('message', handler)

    return () => {
      channel.removeEventListener('message', handler)
    }
  }, [triggerTxRefresh])
}
