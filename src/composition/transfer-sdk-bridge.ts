/**
 * Transfer SDK Bridge
 *
 * Wires Coco SDK push events to TransferLifecycleService state transitions,
 * replacing TLS's periodic polling with push to eliminate network calls.
 *
 * - melt-quote:paid     → bolt11 send transfer  → settled
 * - melt-op:finalized   → bolt11 send transfer  → settled (double-net with paid — idempotent)
 * - melt-op:rolled-back → bolt11 send transfer  → failed  (without this bridge, a
 *                         live-session melt failure never reaches the UI and stays
 *                         latent until the next unlock)
 * - send:finalized      → ecash send transfer   → settled
 * - send:rolled-back    → ecash send transfer   → failed
 * - mint-op:finalized   → bolt11/ecash receive  → settled
 *
 * Fallback: default is a 120s stuck-sweep (local first, remote check only for
 * stuck); with ks.tls-sweep ON, the old path does a 30s blanket poll.
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

  // Note: manager.on events don't distinguish transport — they fire for WSS push
  // or Coco's internal polling (20s/5s) alike. 'coco_push_received' indicates the
  // Coco event pipeline is alive, not proof of WSS alone.
  const unsubMeltPaid = manager.on('melt-quote:paid', async ({ quoteId }) => {
    incrementNetCounter('coco_push_received')
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(quoteId, 'settled')
      logResolution('melt-quote:paid', quoteId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] melt-quote:paid error:', err)
    }
  })

  // Double-net for when melt-quote:paid didn't arrive (resolve is idempotent).
  // No counter increment: this settlement was already counted at paid, and
  // double-counting would inflate the counter.
  const unsubMeltOpFinalized = manager.on('melt-op:finalized', async ({ operationId }) => {
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'settled')
      logResolution('melt-op:finalized', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] melt-op:finalized error:', err)
    }
  })

  // Melt failure (rollback) — the only push path that gets failures to the UI in a live session.
  const unsubMeltOpRolledBack = manager.on('melt-op:rolled-back', async ({ operationId }) => {
    incrementNetCounter('coco_push_received')
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'failed')
      logResolution('melt-op:rolled-back', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] melt-op:rolled-back error:', err)
    }
  })

  // Ecash send finalized (recipient received the token).
  const unsubSendFinalized = manager.on('send:finalized', async ({ operationId }) => {
    incrementNetCounter('coco_push_received')
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'settled')
      logResolution('send:finalized', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] send:finalized error:', err)
    }
  })

  // Ecash send reclaimed (proof reclaim).
  const unsubSendRolledBack = manager.on('send:rolled-back', async ({ operationId }) => {
    incrementNetCounter('coco_push_received')
    try {
      const resolved = await transferLifecycle.resolveByOperationRef(operationId, 'failed')
      logResolution('send:rolled-back', operationId, resolved)
    } catch (err) {
      console.error('[TransferSdkBridge] send:rolled-back error:', err)
    }
  })

  const unsubMintOpFinalized = manager.on('mint-op:finalized', async ({ operation }) => {
    // A swap's internal finalization isn't a user transfer — only count what passes the filter.
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
