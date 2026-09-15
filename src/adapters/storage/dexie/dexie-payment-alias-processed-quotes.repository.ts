import type { PaymentAliasProcessedQuotesRepository } from '@/core/ports/driven/payment-alias-processed-quotes.repository.port'
import { getDatabase } from './schema'
import { Ok, Err, type Result } from '@/core/domain/result'
import { UnknownError } from '@/core/errors/base'

export class DexiePaymentAliasProcessedQuotesRepository implements PaymentAliasProcessedQuotesRepository {
  async isProcessed(quoteId: string): Promise<Result<boolean, UnknownError>> {
    try {
      const row = await getDatabase().paymentAliasProcessedQuotes.get(quoteId)
      return Ok(!!row)
    } catch (e) {
      return Err(new UnknownError('Failed to check processed quote', e))
    }
  }

  async markProcessed(quoteId: string): Promise<Result<void, UnknownError>> {
    try {
      await getDatabase().paymentAliasProcessedQuotes.put({
        quoteId,
        processedAt: Date.now(),
      })
      return Ok(undefined)
    } catch (e) {
      return Err(new UnknownError('Failed to mark quote as processed', e))
    }
  }

  async list(limit = 100): Promise<Result<{ quoteId: string; processedAt: number }[], UnknownError>> {
    try {
      const rows = await getDatabase().paymentAliasProcessedQuotes
        .orderBy('processedAt')
        .reverse()
        .limit(limit)
        .toArray()
      return Ok(rows)
    } catch (e) {
      return Err(new UnknownError('Failed to list processed quotes', e))
    }
  }
}
