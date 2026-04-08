/**
 * EventBus → Zustand Store 브릿지
 *
 * 도메인 이벤트를 Zustand store action으로 매핑.
 * store 변경은 이 파일에서만 수행 (단방향: EventBus → Store).
 * composition 레벨이므로 store, i18n, legacy services import 허용.
 */

import type { EventBus } from '@/core/events/event-bus'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/hooks/use-cross-tab-sync'
import i18n from '@/i18n'
import { satUnit, formatSats } from '@/utils/format'
import { toNumber } from '@/core/domain/amount'
import { getDatabase } from '@/adapters/storage/dexie/schema'

export interface EventStoreBridgeOptions {
  handleBalance?: boolean
  balanceRefresh?: () => Promise<void>
}

export function connectEventStoreBridge(
  eventBus: EventBus,
  options: EventStoreBridgeOptions = {},
): () => void {
  const unsubscribers: (() => void)[] = []

  // payment:completed → toast + cross-tab sync
  unsubscribers.push(
    eventBus.on('payment:completed', (event) => {
      const { addToast } = useAppStore.getState()
      const amountStr = formatSats(toNumber(event.payload.amount))
      addToast({
        type: 'success',
        message: i18n.t('toast.paymentCompleted', { amount: amountStr, unit: satUnit() }),
        duration: 4000,
      })
      broadcastSync('balance_changed')
    }),
  )

  // payment:deferred → token created, balance changed (no "completed" toast)
  unsubscribers.push(
    eventBus.on('payment:deferred', () => {
      const { triggerTxRefresh } = useAppStore.getState()
      triggerTxRefresh()
      broadcastSync('balance_changed')
    }),
  )

  // payment:failed → error toast
  unsubscribers.push(
    eventBus.on('payment:failed', (event) => {
      const { addToast } = useAppStore.getState()
      addToast({
        type: 'error',
        message: event.payload.error,
        duration: 5000,
      })
    }),
  )

  // swap:completed → toast
  unsubscribers.push(
    eventBus.on('swap:completed', (event) => {
      const { addToast } = useAppStore.getState()
      const amountStr = formatSats(toNumber(event.payload.amount))
      const feeStr = formatSats(toNumber(event.payload.fee))
      addToast({
        type: 'success',
        message: i18n.t('toast.swapCompleted', { amount: amountStr, fee: feeStr, unit: satUnit() }),
        duration: 4000,
      })
      broadcastSync('balance_changed')
    }),
  )

  // swap:failed → error toast
  unsubscribers.push(
    eventBus.on('swap:failed', (event) => {
      const { addToast } = useAppStore.getState()
      addToast({
        type: 'error',
        message: event.payload.error,
        duration: 5000,
      })
    }),
  )

  // recovery:completed → toast
  unsubscribers.push(
    eventBus.on('recovery:completed', (event) => {
      if (event.payload.recovered > 0) {
        const { addToast } = useAppStore.getState()
        addToast({
          type: 'success',
          message: i18n.t('toast.recoveryCompleted', {
            recovered: event.payload.recovered,
            failed: event.payload.failed,
          }),
          duration: 4000,
        })
        broadcastSync('balance_changed')
      }
    }),
  )

  // receive:settled → pending quote 제거 + toast + ReceiveRequest 완료
  unsubscribers.push(
    eventBus.on('receive:settled', (event) => {
      const { requestId, amount, method, isSwapStep } = event.payload
      const { removePendingQuote, addToast, setLastRedeemedQuote, setLastReceivedPayment, triggerTxRefresh } = useAppStore.getState()

      removePendingQuote(requestId)

      if (isSwapStep) {
        console.log(`[EventStoreBridge] Swap step settled (toast suppressed): ${requestId}`)
      } else if (method === 'nostr-gift-wrap') {
        // Ecash token received via gift wrap
        addToast({
          type: 'success',
          message: i18n.t('toast.ecashTokenReceived', { amount: formatSats(amount) }),
          duration: 5000,
        })
        setLastReceivedPayment(requestId, amount, event.payload.metadata?.eventId as string ?? null)
        triggerTxRefresh()
      } else {
        addToast({
          type: 'success',
          message: i18n.t('toast.lightningReceived', { unit: satUnit(), amount: amount.toLocaleString() }),
          duration: 4000,
        })
        setLastRedeemedQuote(requestId, amount)
      }

      // ReceiveRequest 완료 처리
      getDatabase().receiveRequests.where('quoteId').equals(requestId).first().then((req) => {
        if (req && req.status === 'pending') {
          getDatabase().receiveRequests.update(req.id, {
            status: 'completed',
            completedAt: Date.now(),
            completedMethod: method as 'lightning' | 'ecash',
          }).catch((err) => console.error('[EventStoreBridge] ReceiveRequest completion failed:', err))
        }
      }).catch((err) => console.warn('[EventStoreBridge] ReceiveRequest lookup failed:', err))

      broadcastSync('balance_changed')
    }),
  )

  // balance:changed → 잔액 갱신
  if (options.handleBalance && options.balanceRefresh) {
    const refresh = options.balanceRefresh
    let pendingRefresh: Promise<void> | null = null

    unsubscribers.push(
      eventBus.on('balance:changed', () => {
        if (pendingRefresh) return
        pendingRefresh = refresh()
          .catch((e) => console.error('[EventStoreBridge] Balance refresh failed:', e))
          .finally(() => { pendingRefresh = null })
        broadcastSync('balance_changed')
      }),
    )
  }

  return () => {
    for (const unsub of unsubscribers) {
      unsub()
    }
  }
}
