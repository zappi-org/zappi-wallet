import type { ValidatedCashuToken } from '@/core/domain/input-types'

export interface PendingIncomingReview {
  externalId: string
  token: ValidatedCashuToken
  queuedAt: number
  requestId?: string
  senderPubkey?: string
  txId?: string
  source: 'gift-wrap' | 'recovery'
}
