/**
 * Send Token Observer
 *
 * SDK의 send:finalized / send:rolled-back 이벤트를 구독하여
 * Transaction DB와 pendingSendTokens를 자동 업데이트한다.
 *
 * bridge.ts의 SRP를 유지하기 위해 별도 모듈로 분리:
 * - bridge.ts: Coco events → Zustand store (balance, toast)
 * - sendTokenObserver.ts: send events → Transaction DB + pendingSendTokens 정리
 *
 * 모든 DB 접근은 주입된 포트를 통해 수행 — 직접 Dexie/legacy repo 접근 없음.
 */

import type { CashuRuntimeManager } from '@/modules/cashu/cashu-runtime'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'

// ─── 의존성 주입 ───

export interface SendTokenLifecycle {
  finalizeSend(txId: string, operationId?: string): Promise<void>
  recordSendReclaimed(txId: string): Promise<boolean>
}

export interface SendTokenObserverDeps {
  operationMap: OperationMap
  lifecycle: SendTokenLifecycle
}

let unsubscribers: (() => void)[] = []

// ─── Observer 연결 ───

/**
 * SDK send 이벤트를 Transaction DB에 연결
 */
export function connectSendTokenObserver(manager: CashuRuntimeManager, injected: SendTokenObserverDeps): void {
  disconnectSendTokenObserver()

  // send:finalized — 수령자가 토큰을 수령하여 proof가 spent 확인됨
  const unsubFinalized = manager.on('send:finalized', async ({ operationId }) => {
    if (!operationId) return
    try {
      const txId = await injected.operationMap.resolve(operationId)
      if (!txId) return
      await injected.lifecycle.finalizeSend(txId)
      console.log(`[SendTokenObserver] Finalized: ${operationId} → tx ${txId}`)
    } catch (error) {
      console.error('[SendTokenObserver] Failed to handle send:finalized:', error)
    }
  })

  // send:rolled-back — 토큰 회수 완료 (proof reclaim swap 성공)
  const unsubRolledBack = manager.on('send:rolled-back', async ({ operationId }) => {
    if (!operationId) return
    try {
      const txId = await injected.operationMap.resolve(operationId)
      if (!txId) return
      const updated = await injected.lifecycle.recordSendReclaimed(txId)
      if (updated) {
        console.log(`[SendTokenObserver] Rolled back: ${operationId} → tx ${txId}`)
      }
    } catch (error) {
      console.error('[SendTokenObserver] Failed to handle send:rolled-back:', error)
    }
  })

  unsubscribers = [unsubFinalized, unsubRolledBack]
  console.log('[SendTokenObserver] Connected')
}

/**
 * 이벤트 구독 해제
 */
export function disconnectSendTokenObserver(): void {
  for (const unsub of unsubscribers) {
    unsub()
  }
  unsubscribers = []
}
