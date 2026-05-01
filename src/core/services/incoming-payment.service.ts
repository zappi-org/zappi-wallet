/**
 * IncomingPaymentService — 프로토콜 무관 수신 결제 처리
 *
 * 호출자(hook, adapter)가 payload/externalId를 결정하고,
 * 이 서비스는 redeem + 연결된 receive request 정산 + 멱등성 기록 + crash recovery + 실패 큐를 담당.
 */

import type {
  IncomingPaymentUseCase,
  IncomingPaymentResult,
} from '@/core/ports/driving/incoming-payment.usecase'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { FailedIncomingStore } from '@/core/ports/driven/failed-incoming-store.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import { toNumber } from '@/core/domain/amount'

type ReceiveRequestSettlement = Pick<ReceiveRequestUseCase, 'settleByPaymentRef'>

export class IncomingPaymentService implements IncomingPaymentUseCase {
  constructor(
    private readonly payment: PaymentUseCase,
    private readonly processedStore: ProcessedStore,
    private readonly failedIncomingStore: FailedIncomingStore,
    private readonly receiveRequest?: ReceiveRequestSettlement,
    private readonly txRepo?: TransactionRepository,
    private readonly eventBus?: EventBus,
  ) {}

  async processIncoming(params: {
    payload: string
    externalId: string
    memo?: string
    metadata?: Record<string, unknown>
    receiveRequestPaymentRef?: string
    receiveRequestMethod?: string
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

      const settlement = await this.settleReceiveRequest(params)
      if (!settlement.ok) {
        await this.queueFailure({
          payload,
          externalId,
          txId,
          errorMsg: settlement.error,
          errorCode: 'RECEIVE_REQUEST_SETTLEMENT_FAILED',
          redeemSucceeded: true,
          receiveRequestPaymentRef: params.receiveRequestPaymentRef,
          receiveRequestMethod: params.receiveRequestMethod,
        })
        return { status: 'failed', error: settlement.error }
      }

      // Verified: paymentRef matched a ReceiveRequest I created → mark intent + emit.
      // Transport-agnostic — only fires when settle returns a real record.
      if (settlement.matched && this.txRepo) {
        try {
          await this.txRepo.update(txId, { intent: 'request-fulfill' })
        } catch (err) {
          console.warn('[IncomingPayment] Failed to mark intent=request-fulfill:', err)
        }
        if (this.eventBus && params.receiveRequestPaymentRef && params.receiveRequestMethod) {
          this.eventBus.emit({
            type: 'receive:request-fulfilled',
            payload: {
              txId,
              amount: redeemResult.value.amount,
              fee: redeemResult.value.fee,
              method: params.receiveRequestMethod,
              paymentRef: params.receiveRequestPaymentRef,
            },
          })
        }
      }

      await this.processedStore.save({
        externalId,
        txId,
        processedAt: Date.now(),
        result: 'success',
      })

      return { status: 'success', amount, fee, requestFulfilled: settlement.matched }
    } catch (error) {
      const errorMsg = String(error)
      const isAlreadySpent = errorMsg.toLowerCase().includes('already spent')

      if (isAlreadySpent) {
        const settlement = await this.settleReceiveRequest(params)
        if (!settlement.ok) {
          await this.queueFailure({
            payload,
            externalId,
          txId,
          errorMsg: settlement.error,
          errorCode: 'RECEIVE_REQUEST_SETTLEMENT_FAILED',
          redeemSucceeded: true,
          receiveRequestPaymentRef: params.receiveRequestPaymentRef,
          receiveRequestMethod: params.receiveRequestMethod,
        })
        return { status: 'failed', error: settlement.error }
        }

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

        await this.queueFailure({
          payload,
          externalId,
          txId,
          errorMsg,
          errorCode: 'REDEEM_FAILED',
        })
      } catch (queueError) {
        console.error('[IncomingPayment] Failed to queue retry:', queueError)
      }

      return { status: 'failed', error: errorMsg }
    }
  }

  private async settleReceiveRequest(params: {
    receiveRequestPaymentRef?: string
    receiveRequestMethod?: string
  }): Promise<{ ok: true; matched: boolean } | { ok: false; error: string }> {
    if (!this.receiveRequest || !params.receiveRequestPaymentRef || !params.receiveRequestMethod) {
      return { ok: true, matched: false }
    }

    try {
      const record = await this.receiveRequest.settleByPaymentRef(
        params.receiveRequestPaymentRef,
        params.receiveRequestMethod,
      )
      // record === null → no matching ReceiveRequest existed (paymentRef from a stranger)
      return { ok: true, matched: record !== null }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  private async queueFailure(params: {
    payload: string
    externalId: string
    txId: string
    errorMsg: string
    errorCode: string
    redeemSucceeded?: boolean
    receiveRequestPaymentRef?: string
    receiveRequestMethod?: string
  }): Promise<void> {
    try {
      await this.failedIncomingStore.save({
        id: `fi-${crypto.randomUUID()}`,
        payload: params.payload,
        accountId: 'unknown',
        amount: 0,
        error: params.errorMsg,
        errorCode: params.errorCode,
        isRetryable: true,
        attemptCount: 1,
        lastAttemptAt: Date.now(),
        createdAt: Date.now(),
        externalId: params.externalId,
        txId: params.txId,
        redeemSucceeded: params.redeemSucceeded,
        receiveRequestPaymentRef: params.receiveRequestPaymentRef,
        receiveRequestMethod: params.receiveRequestMethod,
      })
    } catch (error) {
      console.error('[IncomingPayment] Failed to queue retry:', error)
    }
  }
}
