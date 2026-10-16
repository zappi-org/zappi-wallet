import type { Result } from '@/core/domain/result'
import type { UnknownError } from '@/core/errors/base'

/**
 * A paid quote that could not be claimed on first sight.
 *
 * Persisted because the receipt cursor may advance past it — the cursor window
 * (5 min overlap) is not a reliable retry mechanism. `expiry` is stored so the
 * drain can retire quotes the mint will never issue.
 */
export interface PaymentAliasPendingQuote {
  readonly quoteId: string
  readonly mintUrl: string
  readonly amount: number
  readonly unit: string
  readonly paidAt: number
  readonly expiry: number
  readonly attemptCount: number
  readonly lastAttemptAt: number
  readonly lastError?: string
  readonly state: 'retry'
}

export interface PaymentAliasPendingQuotesRepository {
  get(quoteId: string): Promise<Result<PaymentAliasPendingQuote | null, UnknownError>>
  save(quote: PaymentAliasPendingQuote): Promise<Result<void, UnknownError>>
  getRetryable(): Promise<Result<PaymentAliasPendingQuote[], UnknownError>>
  update(quoteId: string, patch: Partial<PaymentAliasPendingQuote>): Promise<Result<void, UnknownError>>
  delete(quoteId: string): Promise<Result<void, UnknownError>>
}
