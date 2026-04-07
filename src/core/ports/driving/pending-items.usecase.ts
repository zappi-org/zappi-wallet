import type { PendingQuote } from '@/core/domain/quote'

export interface PendingItem {
  id: string
  type: 'unclaimed-token' | 'receive-request' | 'sent-token'
  amount: number
  mintUrl: string
  memo?: string
  createdAt: number
  expiresAt?: number
  token?: string
  operationId?: string
  quoteId?: string
  invoice?: string
  ecashRequest?: string
  ecashRequestId?: string
  bip321Uri?: string
  httpEndpoint?: string
}

export interface PendingItemsUseCase {
  getByMint(mintUrl: string): Promise<PendingItem[]>
  getAll(): Promise<PendingItem[]>
  getActivePendingQuotes(): Promise<PendingQuote[]>
}
