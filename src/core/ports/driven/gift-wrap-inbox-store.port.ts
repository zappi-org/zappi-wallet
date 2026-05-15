import type {
  GiftWrapInboxItem,
  GiftWrapInboxSource,
  GiftWrapInboxStatus,
  GiftWrapInboxTokenInfo,
  GiftWrapRelayCursor,
} from '@/core/types'
import type { UnwrappedMessage } from './nostr-gateway.port'

export interface GiftWrapInboxStore {
  upsertMessage(
    message: UnwrappedMessage,
    source: GiftWrapInboxSource,
  ): Promise<{ item: GiftWrapInboxItem; inserted: boolean }>

  claimNext(params: {
    limit: number
    staleProcessingBefore: number
    retryFailedBefore: number
    now: number
  }): Promise<GiftWrapInboxItem[]>

  listByStatus(status: GiftWrapInboxStatus): Promise<GiftWrapInboxItem[]>
  markReviewPending(eventId: string, tokenInfo: GiftWrapInboxTokenInfo): Promise<void>
  markProcessed(eventId: string, txId?: string): Promise<void>
  markSkipped(eventId: string, error?: string): Promise<void>
  markFailed(eventId: string, error: string): Promise<void>

  getRelayCursor(relayUrl: string): Promise<GiftWrapRelayCursor | null>
  saveRelayCursor(cursor: GiftWrapRelayCursor): Promise<void>
}
