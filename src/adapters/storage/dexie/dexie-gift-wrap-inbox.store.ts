import type { GiftWrapInboxStore } from '@/core/ports/driven/gift-wrap-inbox-store.port'
import type {
  GiftWrapInboxItem,
  GiftWrapInboxSource,
  GiftWrapInboxStatus,
  GiftWrapInboxTokenInfo,
  GiftWrapRelayCursor,
} from '@/core/types'
import type { UnwrappedMessage } from '@/core/ports/driven/nostr-gateway.port'
import { getDatabase } from './schema'

export class DexieGiftWrapInboxStore implements GiftWrapInboxStore {
  private get inbox() {
    return getDatabase().giftWrapInbox
  }

  private get cursors() {
    return getDatabase().giftWrapRelayCursors
  }

  async upsertMessage(
    message: UnwrappedMessage,
    source: GiftWrapInboxSource,
  ): Promise<{ item: GiftWrapInboxItem; inserted: boolean }> {
    const now = Date.now()
    const existing = await this.inbox.get(message.eventId)
    const relayUrls = mergeRelayUrls(existing?.relayUrls, message.relayUrl)

    if (existing) {
      const item = {
        ...existing,
        content: existing.content || message.content,
        senderPubkey: existing.senderPubkey || message.sender,
        outerCreatedAt: Math.min(existing.outerCreatedAt, message.createdAt),
        innerCreatedAt: existing.innerCreatedAt ?? message.innerCreatedAt,
        lastSeenAt: now,
        updatedAt: now,
        relayUrls,
      }
      await this.inbox.put(item)
      return { item, inserted: false }
    }

    const item: GiftWrapInboxItem = {
      eventId: message.eventId,
      content: message.content,
      senderPubkey: message.sender,
      outerCreatedAt: message.createdAt,
      innerCreatedAt: message.innerCreatedAt,
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
      source,
      status: 'pending',
      relayUrls,
      attemptCount: 0,
    }
    await this.inbox.put(item)
    return { item, inserted: true }
  }

  async claimNext(params: {
    limit: number
    staleProcessingBefore: number
    retryFailedBefore: number
    now: number
  }): Promise<GiftWrapInboxItem[]> {
    const db = getDatabase()
    return db.transaction('rw', db.giftWrapInbox, async () => {
      const all = await db.giftWrapInbox.toArray()
      const candidates = all
        .filter((item) => isClaimable(item, params))
        .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
        .slice(0, params.limit)

      const claimed: GiftWrapInboxItem[] = []
      for (const item of candidates) {
        const next: GiftWrapInboxItem = {
          ...item,
          status: 'processing',
          attemptCount: item.attemptCount + 1,
          lastAttemptAt: params.now,
          updatedAt: params.now,
          error: undefined,
        }
        await db.giftWrapInbox.put(next)
        claimed.push(next)
      }
      return claimed
    })
  }

  async listByStatus(status: GiftWrapInboxStatus): Promise<GiftWrapInboxItem[]> {
    return this.inbox.where('status').equals(status).toArray()
  }

  async markReviewPending(eventId: string, tokenInfo: GiftWrapInboxTokenInfo): Promise<void> {
    await this.inbox.update(eventId, {
      status: 'review_pending',
      tokenInfo,
      updatedAt: Date.now(),
      error: undefined,
    })
  }

  async markProcessed(eventId: string, txId?: string): Promise<void> {
    await this.inbox.update(eventId, {
      status: 'processed',
      txId,
      processedAt: Date.now(),
      updatedAt: Date.now(),
      error: undefined,
    })
  }

  async markSkipped(eventId: string, error?: string): Promise<void> {
    await this.inbox.update(eventId, {
      status: 'skipped',
      processedAt: Date.now(),
      updatedAt: Date.now(),
      error,
    })
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    await this.inbox.update(eventId, {
      status: 'failed',
      updatedAt: Date.now(),
      error,
    })
  }

  async getRelayCursor(relayUrl: string): Promise<GiftWrapRelayCursor | null> {
    const record = await this.cursors.get(relayUrl)
    if (!record) return null
    const { id: _, ...cursor } = record
    return cursor
  }

  async saveRelayCursor(cursor: GiftWrapRelayCursor): Promise<void> {
    await this.cursors.put({ ...cursor, id: cursor.relayUrl })
  }
}

function mergeRelayUrls(existing: string[] | undefined, next: string | undefined): string[] {
  const relays = new Set(existing ?? [])
  if (next) relays.add(next)
  return [...relays]
}

function isClaimable(
  item: GiftWrapInboxItem,
  params: { staleProcessingBefore: number; retryFailedBefore: number },
): boolean {
  if (item.status === 'pending') return true
  if (item.status === 'processing') {
    return (item.lastAttemptAt ?? item.updatedAt) < params.staleProcessingBefore
  }
  if (item.status === 'failed') {
    return (item.lastAttemptAt ?? item.updatedAt) < params.retryFailedBefore
  }
  return false
}
