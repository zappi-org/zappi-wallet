/**
 * NostrIncomingWatcher — Adapter Layer
 *
 * NIP-17 gift wrap 수신 → 복호화/검증 → PendingTransfer 생성 → Store 저장
 *
 * ⚠️ 이 Watcher는 "발견"만 담당합니다.
 * 생성된 PendingTransfer는 TransferLifecycleService가 "관리"합니다.
 *
 * 복호화는 NostrGatewayAdapter 내부에서 처리됩니다.
 * 이 Watcher는 UnwrappedMessage(content, sender, eventId)를 받습니다.
 */

import type { NostrGateway, UnwrappedMessage } from '@/core/ports/driven/nostr-gateway.port'
import type { EventBus } from '@/core/events/event-bus'
import type { PendingTransferStore } from '@/core/ports/driven/pending-transfer-store.port'
import { createPendingTransfer } from '@/core/domain/pending-transfer'

export class NostrIncomingWatcher {
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly nostrGateway: NostrGateway,
    private readonly transferStore: PendingTransferStore,
    private readonly eventBus: EventBus,
  ) {}

  start(recipientPubkey: string): void {
    if (this.unsubscribe) return

    this.unsubscribe = this.nostrGateway.subscribeGiftWraps(
      { recipientPubkey },
      async (msg) => {
        await this.handleMessage(msg).catch((err) => {
          console.warn('[NostrIncomingWatcher] Failed to process giftwrap:', err)
        })
      },
    )

    console.log('[NostrIncomingWatcher] Started')
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
      console.log('[NostrIncomingWatcher] Stopped')
    }
  }

  // ─── Private ───

  private async handleMessage(msg: UnwrappedMessage): Promise<void> {
    // 1. 중복 방지: 이미 처리한 eventId인지 확인
    const existing = await this.transferStore.listByTxId(msg.eventId)
    if (existing.length > 0) {
      console.log('[NostrIncomingWatcher] Already processed:', msg.eventId.substring(0, 8))
      return
    }

    // 2. 간단한 payload 검증 (token-ish인지)
    if (!this.isValidPayload(msg.content)) {
      console.log('[NostrIncomingWatcher] Invalid payload, skipping:', msg.eventId.substring(0, 8))
      return
    }

    // 3. PendingTransfer 생성 (direction: incoming)
    const transfer = createPendingTransfer({
      id: crypto.randomUUID(),
      txId: msg.eventId, // eventId를 임시 txId로 사용 (나중에 Transaction과 연결)
      direction: 'incoming',
      finality: 'deferred',
      onExpiry: 'expire',
      transportRef: {
        type: 'nostr-giftwrap',
        eventId: msg.eventId,
        sender: msg.sender,
        content: msg.content,
      },
      now: Date.now(),
    })

    // 4. 저장
    await this.transferStore.create(transfer)

    // 5. UI 알림
    this.eventBus.emit({
      type: 'incoming:received',
      payload: { transfer },
    })
  }

  private isValidPayload(content: string): boolean {
    // cashuA, cashuB, creq 등으로 시작하는 token 또는 payment request
    const trimmed = content.trim()
    if (trimmed.length < 10) return false
    // cashu token 또는 payment request 형식
    return (
      /^cashu[ab]/i.test(trimmed) ||
      /^creq[ab]/i.test(trimmed) ||
      trimmed.startsWith('{"mint"') ||
      trimmed.includes('"proofs"')
    )
  }
}
