import type { PendingQuote } from '@/core/domain/quote'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PendingItem<D = {}> {
  id: string
  direction: 'send' | 'receive'
  kind: 'token' | 'request'
  amount: number
  accountId: string
  memo?: string
  createdAt: number
  expiresAt?: number
  details?: D
}

export interface PendingItemsUseCase {
  getByMint(mintUrl: string): Promise<PendingItem[]>
  getAll(): Promise<PendingItem[]>
  getActivePendingQuotes(): Promise<PendingQuote[]>
}
