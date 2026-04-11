/**
 * IncomingPaymentService — 프로토콜 무관 수신 결제 처리
 *
 * 호출자(hook, adapter)가 payload/externalId를 결정하고,
 * 이 서비스는 redeem + 멱등성 기록 + crash recovery + 실패 큐만 담당.
 */

import type {
  IncomingPaymentUseCase,
  IncomingPaymentResult,
} from '@/core/ports/driving/incoming-payment.usecase'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { FailedIncomingStore } from '@/core/ports/driven/failed-incoming-store.port'
import { toNumber } from '@/core/domain/amount'

export class IncomingPaymentService implements IncomingPaymentUseCase {
  constructor(
    private readonly payment: PaymentUseCase,
    private readonly processedStore: ProcessedStore,
    private readonly failedIncomingStore: FailedIncomingStore,
  ) {}

  async processIncoming(params: {
    payload: string
    externalId: string
    memo?: string
    metadata?: Record<string, unknown>
  }): Promise<IncomingPaymentResult> {
    const { payload, externalId } = params
    const txId = `tx-in-${externalId}`

    // Idempotency check
    if (await this.processedStore.exists(externalId)) {
      return { status: 'already_processed' }
    }

    try {
      const redeemResult = await this.payment.redeem({
        input: payload,
        transactionId: txId,
      })

      if (!redeemResult.ok) {
        throw new Error(redeemResult.error.message)
      }

      const amount = toNumber(redeemResult.value.amount)
      const fee = redeemResult.value.fee ? toNumber(redeemResult.value.fee) : undefined

      await this.processedStore.save({
        externalId,
        txId,
        processedAt: Date.now(),
        result: 'success',
      })

      return { status: 'success', amount, fee }
    } catch (error) {
      const errorMsg = String(error)
      const isAlreadySpent = errorMsg.toLowerCase().includes('already spent')

      if (isAlreadySpent) {
        // Crash recovery: payment succeeded before but record was not saved
        await this.processedStore.save({
          externalId,
          txId,
          processedAt: Date.now(),
          result: 'skipped',
        })
        return { status: 'already_processed' }
      }

      // Real failure — record + queue for retry
      try {
        await this.processedStore.save({
          externalId,
          txId,
          processedAt: Date.now(),
          result: 'failed',
          error: errorMsg,
        })

        await this.failedIncomingStore.save({
          id: `fi-${crypto.randomUUID()}`,
          payload,
          accountId: 'unknown',
          amount: 0,
          error: errorMsg,
          errorCode: 'REDEEM_FAILED',
          isRetryable: true,
          attemptCount: 1,
          lastAttemptAt: Date.now(),
          createdAt: Date.now(),
          externalId,
          txId,
        })
      } catch (queueError) {
        console.error('[IncomingPayment] Failed to queue retry:', queueError)
      }

      return { status: 'failed', error: errorMsg }
    }
  }
}
