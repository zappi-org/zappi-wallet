/**
 * Coco → EventBus 브릿지
 *
 * Coco Manager의 SDK 이벤트를 도메인 EventBus 이벤트로 변환.
 * 이벤트 emit만 수행. store 변경, i18n, service 호출 일체 금지.
 * store 변경은 event-store-bridge가 담당.
 */

import type { Manager } from 'coco-cashu-core'
import type { EventBus } from '@/core/events/event-bus'
import { isSwapQuote } from '@/modules/cashu'

export function connectCocoEventBridge(
  manager: Manager,
  eventBus: EventBus,
): () => void {
  const unsubscribers: (() => void)[] = []

  const emitBalanceChanged = () => {
    eventBus.emit({
      type: 'balance:changed',
      payload: { moduleId: 'cashu', accountId: '' },
    })
  }

  // Proof 변경 → balance:changed
  for (const event of ['proofs:saved', 'proofs:state-changed', 'proofs:deleted', 'proofs:wiped'] as const) {
    unsubscribers.push(manager.on(event, emitBalanceChanged))
  }

  // Mint operation 완료 → balance:changed + mint-quote:settled
  unsubscribers.push(manager.on('mint-op:finalized', (event) => {
    emitBalanceChanged()

    const { operation, mintUrl } = event
    if (operation.state !== 'finalized') return

    eventBus.emit({
      type: 'receive:settled',
      payload: {
        requestId: operation.quoteId,
        amount: operation.amount,
        accountId: mintUrl,
        method: 'bolt11',
        isSwapStep: isSwapQuote(operation.quoteId),
      },
    })
  }))

  // Melt quote 결제 완료 → balance:changed
  unsubscribers.push(manager.on('melt-quote:paid', emitBalanceChanged))

  // 초기 balance 트리거
  emitBalanceChanged()

  return () => {
    for (const unsub of unsubscribers) {
      unsub()
    }
  }
}
