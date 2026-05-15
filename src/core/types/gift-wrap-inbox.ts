import type { Amount } from '@/core/domain/amount'

export type GiftWrapInboxSource = 'live' | 'catch-up' | 'recovery'

export type GiftWrapInboxStatus =
  | 'pending'
  | 'processing'
  | 'review_pending'
  | 'processed'
  | 'failed'
  | 'skipped'

export interface GiftWrapInboxTokenInfo {
  token: string
  mintUrl: string
  amount: Amount
  memo?: string
  requestId?: string
  txId?: string
  metadata?: Record<string, unknown>
}

export interface GiftWrapInboxItem {
  eventId: string
  content: string
  senderPubkey: string
  outerCreatedAt: number
  innerCreatedAt?: number
  firstSeenAt: number
  lastSeenAt: number
  updatedAt: number
  source: GiftWrapInboxSource
  status: GiftWrapInboxStatus
  relayUrls: string[]
  attemptCount: number
  lastAttemptAt?: number
  processedAt?: number
  txId?: string
  error?: string
  tokenInfo?: GiftWrapInboxTokenInfo
}

export interface GiftWrapRelayCursor {
  relayUrl: string
  lastSeenCreatedAt: number
  updatedAt: number
}

export interface GiftWrapSyncResult {
  eventsFetched: number
  eventsIngested: number
  eventsProcessed: number
  tokensReceived: number
  amountReceived: number
  reviewPending: number
  failed: number
  skipped: number
  errors: string[]
}
