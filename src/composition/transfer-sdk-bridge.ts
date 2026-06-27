/**
 * Transfer SDK Bridge
 *
 * Coco SDK push 이벤트를 TransferLifecycleService 전송 상태 전환으로 연결.
 * TLS의 5초 주기 polling을 push 기반으로 대체하여 네트워크 호출을 제거.
 *
 * - melt-quote:paid     → bolt11 send transfer → settled
 * - send:finalized      → ecash send transfer  → settled
 * - send:rolled-back    → ecash send transfer  → failed
 *
 * polling은 여전히 장주기(30s)로 fallback 동작.
 */

import type { CashuRuntimeManager } from '@/modules/cashu/cashu-runtime'
import type { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'

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
  const unsubMeltPaid = manager.on('melt-quote:paid', async ({ quoteId }) => {
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(quoteId, 'settled')
      logResolution('melt-quote:paid', quoteId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] melt-quote:paid error:', err)
    }
  })

  // Ecash send 완료 (수령자가 토큰 수령)
  const unsubSendFinalized = manager.on('send:finalized', async ({ operationId }) => {
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'settled')
      logResolution('send:finalized', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] send:finalized error:', err)
    }
  })

  // Ecash send 회수 (proof reclaim)
  const unsubSendRolledBack = manager.on('send:rolled-back', async ({ operationId }) => {
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'failed')
      logResolution('send:rolled-back', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] send:rolled-back error:', err)
    }
  })

  unsubscribers = [unsubMeltPaid, unsubSendFinalized, unsubSendRolledBack]
  log('Connected (melt-quote:paid, send:finalized, send:rolled-back)')

  return disconnectTransferSdkBridge
}

export function disconnectTransferSdkBridge(): void {
  for (const unsub of unsubscribers) {
    unsub()
  }
  unsubscribers = []
}
