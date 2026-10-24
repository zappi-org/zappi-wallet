/**
 * SwapService — SwapUseCase implementation.
 *
 * Orchestrates a cross-account (mint) swap within the same module:
 * create a receive request (invoice) on target → send (melt) on source →
 * wait for target to receive.
 *
 * Depends on port interfaces only.
 */

import { Ok, Err } from '@/core/domain/result'
import type { Result } from '@/core/domain/result'
import { sat, toNumber } from '@/core/domain/amount'
import type { Amount } from '@/core/domain/amount'
import { createTransaction } from '@/core/domain/transaction'
import type { BaseError } from '@/core/errors/base'
import { UnknownError } from '@/core/errors/base'
import { AdapterNotFoundError, InsufficientBalanceError } from '@/core/errors/payment.errors'
import type { EventBus } from '@/core/events/event-bus'
import type {
  SwapUseCase,
  SwapPair,
  SwapParams,
  SwapEstimate,
  SwapResult,
} from '@/core/ports/driving/swap.usecase'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { SwapQuoteMarker } from '@/core/ports/driven/swap-quote-marker.port'

interface ReceiveCompletionHandle {
  promise: Promise<void>
  cancel(): void
}

export class SwapService implements SwapUseCase {
  constructor(
    private modules: WalletModule[],
    private txRepo: TransactionRepository,
    private eventBus: EventBus,
    private swapQuoteMarker?: SwapQuoteMarker,
  ) {}

  getAvailableSwaps(): SwapPair[] {
    const pairs: SwapPair[] = []

    for (const module of this.modules) {
      if (!module.isEnabled()) continue

      // Swap needs a lightning adapter (melt/mint).
      const lightning = module.getPaymentAdapters().find(a =>
        a.capabilities.canSend && a.capabilities.canReceive && a.createReceiveRequest,
      )
      if (!lightning) continue

      // The real account list comes from getBalance, but this sync method can't
      // await it, so the pair carries only moduleId; the actual accountId is
      // chosen in the UI.
      pairs.push({
        sourceAccountId: '*',
        targetAccountId: '*',
        moduleId: module.id,
      })
    }

    return pairs
  }

  async estimateSwap(params: SwapParams): Promise<Result<SwapEstimate, BaseError>> {
    const lightning = this.findLightningAdapter(params.sourceAccountId)
    if (!lightning) {
      return Err(new AdapterNotFoundError('No lightning adapter for source account'))
    }
    let quoteId: string | null = null

    const cleanupEstimateQuote = async (): Promise<void> => {
      if (!quoteId) return
      const currentQuoteId = quoteId
      await this.abandonSwapQuote(params.targetAccountId, currentQuoteId)
      quoteId = null
    }

    try {
      // Create a throwaway invoice on target to estimate the fee.
      const targetLightning = this.findLightningAdapter(params.targetAccountId)
      if (!targetLightning?.createReceiveRequest) {
        return Err(new AdapterNotFoundError('No lightning adapter for target account'))
      }

      const request = await targetLightning.createReceiveRequest({
        amount: params.amount,
        accountId: params.targetAccountId,
      })
      quoteId = request.id

      const feeEstimate = await lightning.estimateFee({
        destination: request.encoded,
        amount: params.amount,
        accountId: params.sourceAccountId,
      })

      await cleanupEstimateQuote()

      return Ok({
        fee: feeEstimate.fee,
        sourceAmount: params.amount,
        targetAmount: params.amount,
      })
    } catch (error) {
      if (quoteId) {
        try {
          await cleanupEstimateQuote()
        } catch (cleanupError) {
          const primaryMessage = error instanceof Error ? error.message : 'Unknown error'
          const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : 'Unknown error'
          return Err(new UnknownError(`${primaryMessage} (cleanup failed for quote ${quoteId}: ${cleanupMessage})`))
        }
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Err(new UnknownError(message))
    }
  }

  async executeSwap(params: SwapParams): Promise<Result<SwapResult, BaseError>> {
    const sourceLightning = this.findLightningAdapter(params.sourceAccountId)
    const targetLightning = this.findLightningAdapter(params.targetAccountId)

    if (!sourceLightning) {
      return Err(new AdapterNotFoundError('No lightning adapter for source'))
    }
    if (!targetLightning?.createReceiveRequest) {
      return Err(new AdapterNotFoundError('No lightning adapter for target'))
    }

    const sendTxId = crypto.randomUUID()
    const receiveTxId = crypto.randomUUID()
    let swapAmount = params.amount
    let swapQuoteId: string | null = null
    let receiveCompletion: ReceiveCompletionHandle = {
      promise: Promise.resolve(),
      cancel: () => {},
    }
    let sendAttempted = false
    let sendExecuted = false
    let executedFee: { quoted: Amount; effective: Amount } | undefined
    let cleanupAttemptedQuoteId: string | null = null
    const swapMeta = {
      fromMintUrl: params.sourceAccountId,
      toMintUrl: params.targetAccountId,
    }

    const abandonCurrentSwapQuote = async (): Promise<void> => {
      if (!swapQuoteId) return

      const currentQuoteId = swapQuoteId
      cleanupAttemptedQuoteId = currentQuoteId
      try {
        await this.abandonSwapQuote(params.targetAccountId, currentQuoteId)
        swapQuoteId = null
      } catch (error) {
        // Even if cleanup fails, drop the in-memory mark so it's no longer treated as a swap quote.
        this.swapQuoteMarker?.unmark(currentQuoteId)
        throw error
      }
    }

    const failBeforeSend = async (primaryError: BaseError): Promise<Result<SwapResult, BaseError>> => {
      receiveCompletion.cancel()

      try {
        await abandonCurrentSwapQuote()
        return Err(primaryError)
      } catch (cleanupError) {
        console.error('[SwapService] cleanup failed:', cleanupError)
        return Err(primaryError)
      }
    }

    try {
      let request = await targetLightning.createReceiveRequest({
        amount: swapAmount,
        accountId: params.targetAccountId,
      })

      // Mark the swap quote so mint-quote-observer doesn't create a duplicate TX.
      swapQuoteId = request.id
      this.swapQuoteMarker?.mark(swapQuoteId)

      // Register the receive-completion wait before send to avoid a race.
      receiveCompletion = this.createReceiveCompletionHandle(targetLightning, request.id)

      let prepared = await sourceLightning.prepareSend({
        destination: request.encoded,
        amount: swapAmount,
        accountId: params.sourceAccountId,
      })

      // Drain mode: treat the given amount as the total budget and subtract the fee from it.
      if (params.drain) {
        const drainBudget = toNumber(params.amount)
        let drainAttempts = 0

        while (toNumber(prepared.amount) + toNumber(prepared.fee) > drainBudget) {
          await sourceLightning.cancelPrepared(prepared.id)

          const adjustedNum = drainBudget - toNumber(prepared.fee)
          if (adjustedNum <= 0) {
            return failBeforeSend(new InsufficientBalanceError(0, 0, undefined, drainBudget))
          }
          if (adjustedNum >= toNumber(swapAmount)) {
            return failBeforeSend(new UnknownError('Unable to reduce swap amount for drain mode'))
          }

          swapAmount = sat(adjustedNum)

          receiveCompletion.cancel()
          await abandonCurrentSwapQuote()
          request = await targetLightning.createReceiveRequest({
            amount: swapAmount,
            accountId: params.targetAccountId,
          })
          swapQuoteId = request.id
          this.swapQuoteMarker?.mark(swapQuoteId)
          receiveCompletion = this.createReceiveCompletionHandle(targetLightning, request.id)
          prepared = await sourceLightning.prepareSend({
            destination: request.encoded,
            amount: swapAmount,
            accountId: params.sourceAccountId,
          })

          drainAttempts += 1
          if (drainAttempts >= 3) {
            await sourceLightning.cancelPrepared(prepared.id)
            return failBeforeSend(new UnknownError('Unable to finalize drain swap amount'))
          }
        }
      }

      const sendTx = createTransaction({
        id: sendTxId,
        direction: 'send',
        method: prepared.method,
        protocol: prepared.protocol,
        amount: prepared.amount,
        accountId: params.sourceAccountId,
        intent: 'swap',
        linkedTxId: receiveTxId,
        fee: { quoted: prepared.fee },
        metadata: swapMeta,
      })
      const receiveTx = createTransaction({
        id: receiveTxId,
        direction: 'receive',
        method: request.method,
        protocol: request.protocol,
        amount: swapAmount,
        accountId: params.targetAccountId,
        intent: 'swap',
        linkedTxId: sendTxId,
        metadata: swapMeta,
      })
      await Promise.all([this.txRepo.save(sendTx), this.txRepo.save(receiveTx)])

      sendAttempted = true
      const sendResult = await sourceLightning.executeSend(prepared.id)
      sendExecuted = true
      if (sendResult.effectiveFee) executedFee = { quoted: prepared.fee, effective: sendResult.effectiveFee }

      await receiveCompletion.promise

      const now = Date.now()
      const sendTxUpdate = {
        status: 'settled' as const,
        outcome: 'claimed' as const,
        completedAt: now,
        ...(sendResult.effectiveFee && { fee: { quoted: prepared.fee, effective: sendResult.effectiveFee } }),
      }
      await Promise.all([
        this.txRepo.update(sendTxId, sendTxUpdate),
        this.txRepo.update(receiveTxId, { status: 'settled', outcome: 'claimed', completedAt: now }),
      ])

      this.eventBus.emit({
        type: 'swap:completed',
        payload: {
          sendTxId,
          receiveTxId,
          sourceAccountId: params.sourceAccountId,
          targetAccountId: params.targetAccountId,
          amount: swapAmount,
          fee: sendResult.effectiveFee ?? prepared.fee,
        },
      })
      this.eventBus.emit({
        type: 'balance:changed',
        payload: { moduleId: sourceLightning.moduleId, accountId: params.sourceAccountId },
      })
      this.eventBus.emit({
        type: 'balance:changed',
        payload: { moduleId: targetLightning.moduleId, accountId: params.targetAccountId },
      })

      if (swapQuoteId) this.swapQuoteMarker?.unmark(swapQuoteId)

      return Ok({
        sendTxId,
        receiveTxId,
        amount: swapAmount,
        fee: prepared.fee,
      })
    } catch (error) {
      receiveCompletion.cancel()
      let cleanupFailure: unknown = null

      if (!sendAttempted && swapQuoteId && cleanupAttemptedQuoteId !== swapQuoteId) {
        try {
          await abandonCurrentSwapQuote()
        } catch (cleanupError) {
          cleanupFailure = cleanupError
        }
      }

      const primaryMessage = error instanceof Error ? error.message : 'Unknown error'
      const message = cleanupFailure instanceof Error
        ? `${primaryMessage} (cleanup failed: ${cleanupFailure.message})`
        : primaryMessage

      // Melt already paid the target mint, so a PAID quote means the money is there:
      // leave the leg pending and let recoverPendingQuotes mint it from the quote alone.
      const receiveRetryable = sendExecuted && swapQuoteId !== null
        ? await this.isQuoteStillClaimable(targetLightning, swapQuoteId, params.targetAccountId)
        : false

      // Stays marked while the leg can still land, or mint-quote-observer records the
      // recovery's mint as a second receive TX. ponytail: one stale string per stalled swap.
      if (swapQuoteId && sendAttempted && !receiveRetryable) this.swapQuoteMarker?.unmark(swapQuoteId)

      // Keep emitting swap:failed even if fail-marking fails, but don't swallow it
      // silently — log so a later recovery sweep can clean up any tx left pending.
      await Promise.all([
        // Only failed when the melt itself did not go through.
        this.txRepo.update(sendTxId, sendExecuted
          ? {
            status: 'settled',
            outcome: 'claimed',
            completedAt: Date.now(),
            ...(executedFee && { fee: executedFee }),
          }
          : { status: 'failed' }).catch((markError) => {
          console.error('[SwapService] Failed to mark send tx:', sendTxId, markError)
        }),
        this.txRepo.update(receiveTxId, receiveRetryable
          ? { metadata: { ...swapMeta, failureReason: message } }
          : { status: 'failed' }).catch((markError) => {
          console.error('[SwapService] Failed to mark receive tx:', receiveTxId, markError)
        }),
      ])

      this.eventBus.emit({
        type: 'swap:failed',
        payload: {
          sourceAccountId: params.sourceAccountId,
          targetAccountId: params.targetAccountId,
          error: message,
          ...(receiveRetryable && { retryable: true }),
        },
      })

      return Err(new UnknownError(message, undefined, { retryable: receiveRetryable }))
    }
  }

  // ─── Private helpers ───

  /** PAID quote = the target mint was paid and still owes the issuance. */
  private async isQuoteStillClaimable(
    adapter: PaymentMethodAdapter,
    quoteId: string,
    accountId: string,
  ): Promise<boolean> {
    if (!adapter.queryReceiveStatus) return false
    try {
      const status = await adapter.queryReceiveStatus({ requestId: quoteId, accountId })
      return status.state === 'PAID'
    } catch {
      return false
    }
  }

  private findLightningAdapter(_accountId: string): PaymentMethodAdapter | undefined {
    for (const module of this.modules) {
      if (!module.isEnabled()) continue
      // Swap uses the lightning adapter (melt on source, mint on target).
      const lightning = module.getPaymentAdapters().find(a =>
        a.protocol === 'bolt11' && a.capabilities.canSend && a.capabilities.canReceive,
      )
      if (lightning) return lightning
    }
    return undefined
  }

  private async abandonSwapQuote(accountId: string, quoteId: string): Promise<void> {
    if (this.swapQuoteMarker?.abandon) {
      await this.swapQuoteMarker.abandon(accountId, quoteId)
    }

    this.swapQuoteMarker?.unmark(quoteId)
  }

  private createReceiveCompletionHandle(
    adapter: PaymentMethodAdapter,
    requestId: string,
  ): ReceiveCompletionHandle {
    if (!adapter.onReceiveCompleted) {
      // If the adapter can't detect receive completion, resolve immediately
      // (the Coco watcher handles it instead).
      return {
        promise: Promise.resolve(),
        cancel: () => {},
      }
    }

    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    let unsubscribe = () => {}

    const finish = (settle?: () => void) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      unsubscribe()
      settle?.()
    }

    const promise = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => {
        finish(() => reject(new Error('Swap receive timed out')))
      }, 5 * 60 * 1000)

      unsubscribe = adapter.onReceiveCompleted!(
        requestId,
        () => {
          finish(resolve)
        },
        // Terminal failure (the mint rejected the issuance for good): fail now
        // instead of sitting on the 5-minute arrival timeout, which reports
        // "timed out" for a swap the user can already see never happened.
        (error) => {
          finish(() => reject(error))
        },
      )
    })

    return {
      promise,
      cancel: () => finish(),
    }
  }
}
