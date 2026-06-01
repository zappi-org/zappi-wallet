import type { EventBus } from '@/core/events/event-bus'
import type { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'

/**
 * GiftWrapSettlementBridge — NostrIncomingWatcher가 발견한 giftwrap을
 * TransferLifecycleService가 자동 redeem 하도록 연결.
 *
 * Step 1+2 of GiftWrapWatcher → TLS migration.
 * Trust check / review queue / POS ACK are TODO (Step 3+).
 */
export function connectGiftWrapSettlementBridge(
  eventBus: EventBus,
  transferLifecycle: TransferLifecycleService,
): () => void {
  const unsub = eventBus.on('incoming:received', (event) => {
    const transfer = event.payload.transfer
    const ref = transfer.transportRef as { type?: string } | undefined

    // Only auto-process ecash giftwraps for now
    if (ref?.type !== 'nostr-giftwrap') return
    if (transfer.direction !== 'incoming') return

    // Give store a tick to persist, then process
    queueMicrotask(() => {
      transferLifecycle
        .processIncomingTransfer(transfer.id)
        .catch((err) => {
          console.warn(
            '[GiftWrapSettlementBridge] processIncoming failed for',
            transfer.id,
            err,
          )
        })
    })
  })

  return unsub
}
