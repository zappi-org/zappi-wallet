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
 * markSendFinalized / markSendReclaimed: observer + UI 양쪽에서 호출 가능한
 * idempotent 상태 전이 함수. DB 업데이트를 한 곳에서 관리한다.
 *
 * 모든 DB 접근은 주입된 포트를 통해 수행 — 직접 Dexie/legacy repo 접근 없음.
 */

import type { Manager } from 'coco-cashu-core'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import { createTransaction, settleAsDelivered } from '@/core/domain/transaction'
import { useAppStore } from '@/store'
import { broadcastSync } from '@/hooks/use-cross-tab-sync'

// ─── 의존성 주입 ───

export interface SendTokenObserverDeps {
  operationMap: OperationMap
  txRepo: TransactionRepository
  pendingOps: PendingOperationRepository
  payment: PaymentUseCase
}

let deps: SendTokenObserverDeps | null = null
let unsubscribers: (() => void)[] = []

function requireDeps(): SendTokenObserverDeps {
  if (!deps) throw new Error('SendTokenObserver not initialized — call connectSendTokenObserver first')
  return deps
}

// ─── 공유 상태 전이 함수 (idempotent) ───

/**
 * 토큰이 수령되어 settled 상태로 전이 (finalized)
 * PaymentUseCase.completeSend() 경유 — core에서 DB 업데이트 + 이벤트 emit
 */
export async function markSendFinalized(txId: string): Promise<boolean> {
  const { payment, pendingOps } = requireDeps()

  const result = await payment.completeSend({ transactionId: txId })
  if (!result.ok) return false

  await pendingOps.delete(txId).catch(() => {})

  useAppStore.getState().triggerTxRefresh()
  broadcastSync('balance_changed')
  return true
}

/**
 * 토큰이 회수되어 reclaimed 상태로 전이 (rolled-back)
 * observer의 send:rolled-back 이벤트 및 UI에서 직접 호출 가능
 *
 * 1. 원본 send 거래를 reclaimed로 마킹
 * 2. 별도의 receive 거래를 생성하여 회수 내역을 거래내역에 표시
 */
export async function markSendReclaimed(txId: string): Promise<boolean> {
  const { txRepo, pendingOps } = requireDeps()
  const tx = await txRepo.getById(txId)
  if (!tx) return false
  if (tx.status === 'settled' && tx.outcome === 'reclaimed') return false

  // 원본 send 거래 마킹
  await txRepo.update(txId, {
    status: 'settled',
    outcome: 'reclaimed',
    completedAt: Date.now(),
  })

  // 회수 receive 거래 생성
  const reclaimTxId = `${txId}-reclaim`
  const existing = await txRepo.getById(reclaimTxId)
  if (!existing) {
    const reclaimTx = settleAsDelivered(createTransaction({
      id: reclaimTxId,
      direction: 'receive',
      method: tx.method,
      protocol: tx.protocol,
      amount: tx.amount,
      accountId: tx.accountId,
      metadata: { reclaimedFrom: txId },
    }))
    await txRepo.save(reclaimTx)
  }

  await pendingOps.delete(txId).catch(() => {})

  useAppStore.getState().triggerTxRefresh()
  broadcastSync('balance_changed')
  return true
}

// ─── Observer 연결 ───

/**
 * SDK send 이벤트를 Transaction DB에 연결
 */
export function connectSendTokenObserver(manager: Manager, injected: SendTokenObserverDeps): void {
  disconnectSendTokenObserver()
  deps = injected

  // send:finalized — 수령자가 토큰을 수령하여 proof가 spent 확인됨
  const unsubFinalized = manager.on('send:finalized', async ({ operationId }) => {
    if (!operationId) return
    try {
      const txId = await injected.operationMap.resolve(operationId)
      if (!txId) return
      const updated = await markSendFinalized(txId)
      if (updated) {
        console.log(`[SendTokenObserver] Finalized: ${operationId} → tx ${txId}`)
      }
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
      const updated = await markSendReclaimed(txId)
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
