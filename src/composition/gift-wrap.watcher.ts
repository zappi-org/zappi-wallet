/**
 * GiftWrapWatcher — NIP-17 gift-wrap live subscription.
 *
 * The watcher only discovers messages. Parsing, trust decisions, redeem,
 * review queueing, settlement, ACK, and idempotency are owned by
 * GiftWrapSyncUseCase so live and catch-up paths share one processor.
 */

import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { GiftWrapSyncUseCase } from '@/core/ports/driving/gift-wrap-sync.usecase'

export interface GiftWrapWatcherDeps {
  nostrGateway: NostrGateway
  giftWrapSync: GiftWrapSyncUseCase
  recipientPubkey: string
  getRelays: () => string[]
}

export class GiftWrapWatcher {
  private unsubscribe: (() => void) | null = null

  constructor(private readonly deps: GiftWrapWatcherDeps) {}

  async start(): Promise<void> {
    if (this.unsubscribe) return

    const relays = this.deps.getRelays()
    if (relays.length > 0) {
      await this.deps.nostrGateway.connect(relays)
    }

    this.unsubscribe = this.deps.nostrGateway.subscribeGiftWraps(
      { recipientPubkey: this.deps.recipientPubkey },
      (msg) => {
        this.deps.giftWrapSync.ingest(msg, 'live')
          .then(() => this.deps.giftWrapSync.processPending())
          .catch(err => console.error('[GiftWrapWatcher] handleMessage error:', err))
      },
    )

    console.log('[GiftWrapWatcher] Started')
  }

  async restart(): Promise<void> {
    this.stop()
    await this.start()
  }

  stop(): void {
    if (!this.unsubscribe) return
    this.unsubscribe()
    this.unsubscribe = null
    console.log('[GiftWrapWatcher] Stopped')
  }
}
