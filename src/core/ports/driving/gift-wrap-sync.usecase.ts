import type { GiftWrapSyncResult } from '@/core/types'
import type { UnwrappedMessage } from '@/core/ports/driven/nostr-gateway.port'

export interface GiftWrapSyncUseCase {
  ingest(message: UnwrappedMessage, source: 'live' | 'catch-up' | 'recovery'): Promise<void>

  syncMissed(params: {
    publicKey: string
    relays: string[]
  }): Promise<GiftWrapSyncResult>

  processPending(): Promise<GiftWrapSyncResult>

  markReviewed(params: {
    externalId: string
    result: 'success' | 'skipped'
    txId?: string
    error?: string
  }): Promise<void>
}
