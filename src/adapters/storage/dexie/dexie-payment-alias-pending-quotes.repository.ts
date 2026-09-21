import type {
  PaymentAliasPendingQuote,
  PaymentAliasPendingQuotesRepository,
} from '@/core/ports/driven/payment-alias-pending-quotes.repository.port'
import { getDatabase } from './schema'
import { Ok, Err, type Result } from '@/core/domain/result'
import { UnknownError } from '@/core/errors/base'

export class DexiePaymentAliasPendingQuotesRepository implements PaymentAliasPendingQuotesRepository {
  async get(quoteId: string): Promise<Result<PaymentAliasPendingQuote | null, UnknownError>> {
    try {
      const row = await getDatabase().paymentAliasPendingQuotes.get(quoteId)
      return Ok(row ?? null)
    } catch (e) {
      return Err(new UnknownError('Failed to get pending quote', e))
    }
  }

  async save(quote: PaymentAliasPendingQuote): Promise<Result<void, UnknownError>> {
    try {
      await getDatabase().paymentAliasPendingQuotes.put(quote)
      return Ok(undefined)
    } catch (e) {
      return Err(new UnknownError('Failed to save pending quote', e))
    }
  }

  async getRetryable(): Promise<Result<PaymentAliasPendingQuote[], UnknownError>> {
    try {
      const rows = await getDatabase().paymentAliasPendingQuotes
        .where('state')
        .equals('retry')
        .toArray()
      return Ok(rows)
    } catch (e) {
      return Err(new UnknownError('Failed to list pending quotes', e))
    }
  }

  async update(
    quoteId: string,
    patch: Partial<PaymentAliasPendingQuote>,
  ): Promise<Result<void, UnknownError>> {
    try {
      await getDatabase().paymentAliasPendingQuotes.update(quoteId, patch)
      return Ok(undefined)
    } catch (e) {
      return Err(new UnknownError('Failed to update pending quote', e))
    }
  }

  async delete(quoteId: string): Promise<Result<void, UnknownError>> {
    try {
      await getDatabase().paymentAliasPendingQuotes.delete(quoteId)
      return Ok(undefined)
    } catch (e) {
      return Err(new UnknownError('Failed to delete pending quote', e))
    }
  }
}
