import type { Result } from '@/core/domain/result'
import type { UnknownError } from '@/core/errors/base'

export interface PaymentAliasProcessedQuotesRepository {
  isProcessed(quoteId: string): Promise<Result<boolean, UnknownError>>
  markProcessed(quoteId: string): Promise<Result<void, UnknownError>>
  list(limit?: number): Promise<Result<{ quoteId: string; processedAt: number }[], UnknownError>>
}
