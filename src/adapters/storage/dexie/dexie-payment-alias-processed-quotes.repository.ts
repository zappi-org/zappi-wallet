import type { PaymentAliasProcessedQuotesRepository } from '@/core/ports/driven/payment-alias-processed-quotes.repository.port'
import { getDatabase } from './schema'
import { ok, err, type Result } from '@/core/types/result'
import { UnknownError } from '@/core/errors/base'

export class DexiePaymentAliasProcessedQuotesRepository implements PaymentAliasProcessedQuotesRepository {
  async isProcessed(quoteId: string): Promise<Result<boolean, UnknownError>> {
    try {
      const row = await getDatabase().paymentAliasProcessedQuotes.get(quoteId)
      return ok(!!row)
    } catch (e) {
      return err(new UnknownError('Failed to check processed quote', e))
    }
  }

  async markProcessed(quoteId: string): Promise<Result<void, UnknownError>> {
    try {
      await getDatabase().paymentAliasProcessedQuotes.put({
        quoteId,
        processedAt: Date.now(),
      })
      return ok(undefined)
    } catch (e) {
      return err(new UnknownError('Failed to mark quote as processed', e))
    }
  }

  async list(limit = 100): Promise<Result<{ quoteId: string; processedAt: number }[], UnknownError>> {
    try {
      const rows = await getDatabase().paymentAliasProcessedQuotes
        .orderBy('processedAt')
        .reverse()
        .limit(limit)
        .toArray()
      return ok(rows)
    } catch (e) {
      return err(new UnknownError('Failed to list processed quotes', e))
    }
  }
}
