/**
 * EventBus → Zustand Store 브릿지
 *
 * core services가 emit하는 도메인 이벤트를 Zustand store action으로 매핑.
 * bootstrap.ts에서 연결. balance 쓰기는 old bridge(coco/bridge.ts)가 담당하는 동안
 * 여기서는 balance:changed를 제외한 이벤트만 처리.
 *
 * ⚠️ Store에 두 곳에서 쓰기 금지:
 *    balance 전환 시 old bridge의 proof 리스너를 반드시 동시에 제거.
 */

import type { EventBus } from '@/core/events/event-bus'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/hooks/use-cross-tab-sync'
import i18n from '@/i18n'
import { satUnit, formatSats } from '@/utils/format'
import { toNumber } from '@/core/domain/amount'

export interface EventStoreBridgeOptions {
  /** balance:changed 이벤트를 store에 반영할지 여부 (default: false) */
  handleBalance?: boolean
}

/**
 * EventBus 이벤트를 Zustand store에 연결.
 * 반환값: cleanup 함수 (모든 리스너 해제)
 */
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

  // balance:changed → 향후 활성화 (old bridge 제거 시)
  if (options.handleBalance) {
    unsubscribers.push(
      eventBus.on('balance:changed', () => {
        // TODO: Step 7b에서 구현 — BalanceUseCase.getByModule() 호출 → store 업데이트
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
