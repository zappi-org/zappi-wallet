/**
 * EventBus → Zustand Store 브릿지
 *
 * 도메인 이벤트를 Zustand store action으로 매핑.
 * store 변경은 이 파일에서만 수행 (단방향: EventBus → Store).
 * composition 레벨이므로 store, i18n, legacy services import 허용.
 */

import type { EventBus } from '@/core/events/event-bus'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/composition/cross-tab-sync'
import i18n from '@/i18n'
import { satUnit, formatSats } from '@/utils/format'
import { toNumber } from '@/core/domain/amount'
import { getDatabase } from '@/adapters/storage/dexie/schema'
import { createThrottledAsync } from '@/utils/throttled-async'
import type { ReceiveRequestRepository } from '@/core/ports/driven/receive-request.repository.port'
import { completeReceiveRequest } from '@/core/domain/receive-request'

export interface EventStoreBridgeOptions {
  handleBalance?: boolean
  balanceRefresh?: () => Promise<void>
  receiveRequestRepo?: ReceiveRequestRepository
}

export function connectEventStoreBridge(
  eventBus: EventBus,
  options: EventStoreBridgeOptions = {},
): () => void {
  const unsubscribers: (() => void)[] = []

  // payment:completed → toast + tx refresh (reclaim / send finalized) + cross-tab sync
  unsubscribers.push(
    eventBus.on('payment:completed', (event) => {
      const { addToast, triggerTxRefresh } = useAppStore.getState()
      const amountStr = formatSats(toNumber(event.payload.amount))
      const feeStr = event.payload.fee ? formatSats(toNumber(event.payload.fee)) : undefined
      addToast({
        type: 'success',
        message: feeStr
          ? i18n.t('toast.paymentCompletedWithFee', { amount: amountStr, fee: feeStr })
          : i18n.t('toast.paymentCompleted', { amount: amountStr }),
        duration: 4000,
      })
      triggerTxRefresh()
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
        message: i18n.t('toast.swapCompleted', { amount: amountStr, fee: feeStr }),
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

  // balance:changed / recovery:completed 에서 공유할 throttled refresh
  let throttledRefresh: ReturnType<typeof createThrottledAsync> | null = null

  if (options.handleBalance && options.balanceRefresh) {
    throttledRefresh = createThrottledAsync(options.balanceRefresh, 150)
  }

  // recovery:completed → toast + balance refresh + tx refresh
  unsubscribers.push(
    eventBus.on('recovery:completed', (event) => {
      if (event.payload.recovered > 0) {
        const { addToast, triggerTxRefresh } = useAppStore.getState()
        addToast({
          type: 'success',
          message: i18n.t('toast.recoveryCompleted', {
            recovered: event.payload.recovered,
            failed: event.payload.failed,
          }),
          duration: 4000,
        })
        triggerTxRefresh()
        throttledRefresh?.trigger()
      }
      broadcastSync('balance_changed')
    }),
  )

  // receive:settled → pending quote 제거 + toast + ReceiveRequest 완료
  unsubscribers.push(
    eventBus.on('receive:settled', (event) => {
      const { requestId, amount, fee, method, isSwapStep } = event.payload
      const { removePendingQuote, addToast, setLastRedeemedQuote, setLastReceivedPayment, triggerTxRefresh } = useAppStore.getState()

      removePendingQuote(requestId)

      if (isSwapStep) {
        console.log(`[EventStoreBridge] Swap step settled (toast suppressed): ${requestId}`)
      } else if (method === 'nostr-gift-wrap') {
        // Ecash token received via gift wrap
        const toastKey = fee && fee > 0 ? 'toast.ecashTokenReceivedWithFee' : 'toast.ecashTokenReceived'
        addToast({
          type: 'success',
          message: i18n.t(toastKey, { amount: formatSats(amount), fee: formatSats(fee ?? 0) }),
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
      if (!isSwapStep && options.receiveRequestRepo) {
        options.receiveRequestRepo.findByPaymentRef(requestId).then((req) => {
          if (req && req.status === 'pending') {
            const completed = completeReceiveRequest(req, method)
            options.receiveRequestRepo!.save(completed)
              .catch((err) => console.error('[EventStoreBridge] ReceiveRequest completion failed:', err))
          }
        }).catch((err) => console.warn('[EventStoreBridge] ReceiveRequest lookup failed:', err))
      } else {
        // Fallback: raw Dexie query (backward compatibility — repo 미주입 시)
        getDatabase().receiveRequests.where('quoteId').equals(requestId).first().then((req) => {
          if (req && req.status === 'pending') {
            getDatabase().receiveRequests.update(req.id, {
              status: 'completed',
              completedAt: Date.now(),
              completedMethod: method as 'lightning' | 'ecash',
            }).catch((err) => console.error('[EventStoreBridge] ReceiveRequest completion failed:', err))
          }
        }).catch((err) => console.warn('[EventStoreBridge] ReceiveRequest lookup failed:', err))
      }

      broadcastSync('balance_changed')
    }),
  )

  // balance:changed → 잔액 갱신 + tx 리스트 새로고침 (redeem 같이 payment:* 이벤트 없는 경로 커버)
  if (throttledRefresh) {

    unsubscribers.push(
      eventBus.on('balance:changed', () => {
        throttledRefresh!.trigger()
        useAppStore.getState().triggerTxRefresh()
        broadcastSync('balance_changed')
      }),
    )
  }

  return () => {
    throttledRefresh?.dispose()
    for (const unsub of unsubscribers) {
      unsub()
    }
  }
}
