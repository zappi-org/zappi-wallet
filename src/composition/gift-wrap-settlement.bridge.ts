import type { EventBus } from '@/core/events/event-bus'
import type { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { POSDevice } from '@/core/types/wallet'

export interface GiftWrapSettlementBridgeDeps {
  nostrGateway: NostrGateway
  getPosDevices: () => POSDevice[] | undefined
}

/**
 * GiftWrapSettlementBridge — NostrIncomingWatcher가 발견한 giftwrap을
 * TransferLifecycleService가 자동 redeem 하도록 연결.
 *
 * Trust check / review queue는 NostrIncomingWatcher에서 처리됨.
 * 이 bridge는 redeem 성공 시 POS delivery ACK를 담당.
 */
export function connectGiftWrapSettlementBridge(
  eventBus: EventBus,
  transferLifecycle: TransferLifecycleService,
  deps: GiftWrapSettlementBridgeDeps,
): () => void {
  const unsubscribers: (() => void)[] = []

  unsubscribers.push(
    eventBus.on('incoming:received', (event) => {
      const transfer = event.payload.transfer
      const ref = transfer.transportRef as { type?: string } | undefined

      // Only auto-process ecash giftwraps
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
    }),
  )

  // POS delivery ACK: sender가 등록된 POS 기기이면 redeemed 후 ACK 전송
  unsubscribers.push(
    eventBus.on('transfer:settled', (event) => {
      const transfer = event.payload.transfer
      const ref = transfer.transportRef as
        | { type?: string; sender?: string; txId?: string }
        | undefined

      if (ref?.type !== 'nostr-giftwrap') return
      if (!ref.sender || !ref.txId) return

      const devices = deps.getPosDevices()
      if (!devices?.some((d) => d.nostrPublicKey === ref.sender)) return

      const relays = deps.nostrGateway
        .getRelayStatus()
        .filter((r) => r.connected)
        .map((r) => r.url)

      if (relays.length === 0) return

      const ackContent = JSON.stringify({ type: 'delivery_ack', txId: ref.txId })
      deps.nostrGateway
        .sendPrivateDirectMessage({
          recipientPubkey: ref.sender,
          content: ackContent,
          relays,
        })
        .catch((err) => {
          console.warn('[GiftWrapSettlementBridge] ACK send error:', err)
        })
    }),
  )

  return () => unsubscribers.forEach((unsub) => unsub())
}
