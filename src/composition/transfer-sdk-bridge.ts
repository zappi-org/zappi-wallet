/**
 * Transfer SDK Bridge
 *
 * Coco SDK push 이벤트를 TransferLifecycleService 전송 상태 전환으로 연결.
 * TLS의 주기적 polling을 push 기반으로 대체하여 네트워크 호출을 제거.
 *
 * - melt-quote:paid     → bolt11 send transfer  → settled
 * - melt-op:finalized   → bolt11 send transfer  → settled (paid와 이중망 — 멱등)
 * - melt-op:rolled-back → bolt11 send transfer  → failed  (설계 §7.1-1 — 4단계에서
 *                         B2(unlock 시 melt refresh 루프) 삭제의 선행조건 [N5]:
 *                         이 브리지가 없으면 라이브 세션의 melt 실패가 UI에 도달하지
 *                         못하고 다음 unlock까지 잠복한다)
 * - send:finalized      → ecash send transfer   → settled
 * - send:rolled-back    → ecash send transfer   → failed
 * - mint-op:finalized   → bolt11/ecash receive  → settled
 *
 * fallback: 기본은 120s stuck-sweep(설계 §7.2 — 로컬 1차 + stuck만 원격 확인),
 * ks.tls-sweep ON이면 구경로 30s 일괄 폴링.
 */

import { isSwapQuote } from '@/modules/cashu'
import type { CashuRuntimeManager } from '@/modules/cashu/cashu-runtime'
import type { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'
import { incrementNetCounter } from '@/adapters/telemetry/net-counters'

let unsubscribers: (() => void)[] = []

export function connectTransferSdkBridge(
  manager: CashuRuntimeManager,
  transferLifecycle: TransferLifecycleService,
): () => void {
  disconnectTransferSdkBridge()

  const log = (msg: string) => console.log(`[TransferSdkBridge] ${msg}`)

  const logResolution = (event: string, ref: string, resolved: boolean) => {
    if (resolved) {
      log(`${event}: ${ref} → transfer settled`)
    }
  }

  // Melt 완료 → bolt11 send transfer settled
  // 주의(§12 게이트 해석): manager.on 이벤트는 전송 수단을 구분하지 않는다 —
  // WSS push든 Coco 내부 폴링(20s/5s)이든 발화한다. 'coco_push_received'는
  // "Coco 이벤트 파이프라인 생존"의 지표이지 WSS 단독 증명이 아니다.
  const unsubMeltPaid = manager.on('melt-quote:paid', async ({ quoteId }) => {
    incrementNetCounter('coco_push_received')
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(quoteId, 'settled')
      logResolution('melt-quote:paid', quoteId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] melt-quote:paid error:', err)
    }
  })

  // Melt op 종결 — melt-quote:paid를 못 받은 경우의 이중망 (resolve는 멱등).
  // 계수 없음: 같은 melt 정산이 paid에서 이미 계수됐다 — 이중 계수는 §12
  // 카운터(5단계 게이트 근거)를 인플레이션시킨다 (4단계 리뷰 #8)
  const unsubMeltOpFinalized = manager.on('melt-op:finalized', async ({ operationId }) => {
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'settled')
      logResolution('melt-op:finalized', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] melt-op:finalized error:', err)
    }
  })

  // Melt 실패(롤백) — 라이브 세션에서 실패를 UI에 도달시키는 유일한 push 경로
  const unsubMeltOpRolledBack = manager.on('melt-op:rolled-back', async ({ operationId }) => {
    incrementNetCounter('coco_push_received')
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'failed')
      logResolution('melt-op:rolled-back', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] melt-op:rolled-back error:', err)
    }
  })

  // Ecash send 완료 (수령자가 토큰 수령)
  const unsubSendFinalized = manager.on('send:finalized', async ({ operationId }) => {
    incrementNetCounter('coco_push_received')
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'settled')
      logResolution('send:finalized', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] send:finalized error:', err)
    }
  })

  // Ecash send 회수 (proof reclaim)
  const unsubSendRolledBack = manager.on('send:rolled-back', async ({ operationId }) => {
    incrementNetCounter('coco_push_received')
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'failed')
      logResolution('send:rolled-back', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] send:rolled-back error:', err)
    }
  })

  // Mint quote 완료 → bolt11/ecash receive transfer settled
  const unsubMintOpFinalized = manager.on('mint-op:finalized', async ({ operation }) => {
    // swap 내부 finalization은 사용자 전송이 아니다 — 필터 통과분만 계수 (코드리뷰 #7)
    if (!operation.quoteId || isSwapQuote(operation.quoteId)) return
    incrementNetCounter('coco_push_received')
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operation.quoteId, 'settled')
      logResolution('mint-op:finalized', operation.quoteId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] mint-op:finalized error:', err)
    }
  })

  unsubscribers = [
    unsubMeltPaid,
    unsubMeltOpFinalized,
    unsubMeltOpRolledBack,
    unsubSendFinalized,
    unsubSendRolledBack,
    unsubMintOpFinalized,
  ]
  log('Connected (melt-quote:paid, melt-op:finalized, melt-op:rolled-back, send:finalized, send:rolled-back, mint-op:finalized)')

  return disconnectTransferSdkBridge
}

export function disconnectTransferSdkBridge(): void {
  for (const unsub of unsubscribers) {
    unsub()
  }
  unsubscribers = []
}
