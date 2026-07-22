/**
 * EventBus → Zustand Store 브릿지
 *
 * 도메인 이벤트를 Zustand store action으로 매핑.
 * store 변경은 이 파일에서만 수행 (단방향: EventBus → Store).
 * composition 레벨이므로 store, i18n, legacy services import 허용.
 */

import type { EventBus } from '@/core/events/event-bus'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/utils/cross-tab-sync'
import i18n from '@/i18n'
import { translateError } from '@/ui/utils/error-i18n'
import { satUnit, formatSats } from '@/utils/format'
import { toNumber } from '@/core/domain/amount'
import { createThrottledAsync } from '@/utils/throttled-async'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'

export interface EventStoreBridgeOptions {
  handleBalance?: boolean
  balanceRefresh?: () => Promise<void>
  receiveRequest?: Pick<ReceiveRequestUseCase, 'settleByPaymentRef'> &
    Partial<Pick<ReceiveRequestUseCase, 'findByRequestId'>>
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

  // transactions:changed → refresh transaction lists without implying a user-facing payment toast.
  unsubscribers.push(
    eventBus.on('transactions:changed', () => {
      const { triggerTxRefresh } = useAppStore.getState()
      triggerTxRefresh()
      broadcastSync('tx_changed')
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
      const { requestId, amount, fee, method, isSwapStep, wasRequestFulfilled } = event.payload
      const { removePendingQuote, addToast, setLastRedeemedQuote, setLastReceivedPayment, triggerTxRefresh } = useAppStore.getState()

      removePendingQuote(requestId)

      if (isSwapStep) {
        console.log(`[EventStoreBridge] Swap step settled (toast suppressed): ${requestId}`)
      } else if (wasRequestFulfilled) {
        // Toast owned by receive:request-fulfilled handler; bridge still tracks
        // last received payment + refreshes tx so UI surfaces stay in sync.
        setLastReceivedPayment(requestId, amount, event.payload.metadata?.eventId as string ?? null)
        triggerTxRefresh()
      } else if (method === 'bolt11') {
        // TLS-managed: toast delegated to transfer:settled
        setLastRedeemedQuote(requestId, amount)
        triggerTxRefresh()
      } else if (method === 'nostr-gift-wrap') {
        // Ecash token received via gift wrap (non-TLS path fallback)
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

      // ReceiveRequest lifecycle is owned by the use case. The bridge only forwards settlement signals.
      if (!isSwapStep && options.receiveRequest) {
        options.receiveRequest.settleByPaymentRef(requestId, method)
          .catch((err) => console.error('[EventStoreBridge] ReceiveRequest settlement failed:', err))
      }

      broadcastSync('balance_changed')
    }),
  )

  // receive:request-fulfilled → dedicated toast for verified ReceiveRequest matches
  unsubscribers.push(
    eventBus.on('receive:request-fulfilled', (event) => {
      const { addToast, triggerTxRefresh } = useAppStore.getState()
      const amountStr = formatSats(toNumber(event.payload.amount))
      addToast({
        type: 'success',
        message: i18n.t('toast.requestFulfilled', { amount: amountStr }),
        duration: 5000,
      })
      triggerTxRefresh()
    }),
  )

  // ─── TransferLifecycle events ───

  // transfer:submitted → pendingTransfers에 추가
  unsubscribers.push(
    eventBus.on('transfer:submitted', (event) => {
      const { addOrUpdateTransfer } = useAppStore.getState()
      addOrUpdateTransfer(event.payload.transfer)
    }),
  )

  // transfer:phase-changed → pendingTransfers 갱신
  unsubscribers.push(
    eventBus.on('transfer:phase-changed', (event) => {
      const { addOrUpdateTransfer } = useAppStore.getState()
      addOrUpdateTransfer(event.payload.transfer)
    }),
  )

  // transfer:settled → 제거 + 토스트 + tx 새로고침
  unsubscribers.push(
    eventBus.on('transfer:settled', (event) => {
      const { removeTransfer, addToast, triggerTxRefresh } = useAppStore.getState()
      const transfer = event.payload.transfer
      removeTransfer(transfer.id)

      if (transfer.direction === 'incoming') {
        const ref = transfer.transportRef as Record<string, unknown>
        const refType = ref.type as string | undefined

        if (refType === 'nostr-giftwrap' || refType === 'ecash-token' || refType === 'ecash-incoming') {
          const receivedAmount = (ref.receivedAmount as number) ?? 0
          const fee = (ref.fee as number) ?? 0
          const toastKey = fee > 0 ? 'toast.ecashTokenReceivedWithFee' : 'toast.ecashTokenReceived'
          addToast({
            type: 'success',
            message: i18n.t(toastKey, { amount: formatSats(receivedAmount), fee: formatSats(fee) }),
            duration: 5000,
          })
        } else {
          addToast({
            type: 'success',
            message: i18n.t('toast.lightningReceived', { unit: satUnit(), amount: (transfer.amount ?? 0).toLocaleString() }),
            duration: 4000,
          })
        }
      } else {
        addToast({
          type: 'success',
          message: i18n.t('toast.transferSettled'),
          duration: 4000,
        })
      }

      triggerTxRefresh()
      broadcastSync('balance_changed')
    }),
  )

  // transfer:reclaimed → 제거 + 토스트 + tx 새로고침
  unsubscribers.push(
    eventBus.on('transfer:reclaimed', (event) => {
      const { removeTransfer, addToast, triggerTxRefresh } = useAppStore.getState()
      removeTransfer(event.payload.transfer.id)
      addToast({
        type: 'success',
        message: i18n.t('toast.transferReclaimed'),
        duration: 4000,
      })
      triggerTxRefresh()
      broadcastSync('balance_changed')
    }),
  )

  // transfer:failed → 실패 상태 유지 + 에러 토스트
  unsubscribers.push(
    eventBus.on('transfer:failed', (event) => {
      const { addOrUpdateTransfer, addToast } = useAppStore.getState()
      addOrUpdateTransfer(event.payload.transfer)
      // reason is a machine string — never show it verbatim to the user
      const reason = event.payload.reason
      const message =
        reason === 'app-crashed-during-execution'
          ? i18n.t('toast.transferInterrupted')
          : reason === 'terminal-failure'
            ? i18n.t('toast.transferFailed')
            : translateError(reason, i18n.t)
      void (async () => {
        // A spent-token failure on a request delivery is usually the SECOND
        // copy of a payment we already received (multi-relay/transport) — if
        // the request is fulfilled, the money story ended well; don't alarm.
        const ref = event.payload.transfer.transportRef as { requestId?: string } | undefined
        if (
          ref?.requestId &&
          /token[_ -]?spent|already spent|proof spent/i.test(reason) &&
          options.receiveRequest?.findByRequestId
        ) {
          const request = await options.receiveRequest.findByRequestId(ref.requestId).catch(() => null)
          if (request?.fulfillmentStatus === 'fulfilled') return
        }
        addToast({
          type: 'error',
          message,
          duration: 5000,
        })
      })()
    }),
  )

  // incoming:received → pendingTransfers에 추가
  unsubscribers.push(
    eventBus.on('incoming:received', (event) => {
      const { addOrUpdateTransfer } = useAppStore.getState()
      addOrUpdateTransfer(event.payload.transfer)
    }),
  )

  // incoming:processed → 갱신 + tx 새로고침 (toast은 transfer:settled에서 통합 처리)
  unsubscribers.push(
    eventBus.on('incoming:processed', (event) => {
      const { addOrUpdateTransfer, triggerTxRefresh } = useAppStore.getState()
      addOrUpdateTransfer(event.payload.transfer)
      triggerTxRefresh()
      broadcastSync('balance_changed')
    }),
  )

  // transfer:needs-polling → poller가 곧 처리하도록 store에 유지
  unsubscribers.push(
    eventBus.on('transfer:needs-polling', (event) => {
      const { addOrUpdateTransfer } = useAppStore.getState()
      addOrUpdateTransfer(event.payload.transfer)
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
