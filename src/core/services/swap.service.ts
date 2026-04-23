/**
 * SwapService — SwapUseCase 구현
 *
 * 동일 모듈 내 cross-account(mint) swap을 orchestrate.
 * target에서 receive request(invoice) 생성 → source에서 send(melt) → target 수신 완료 대기.
 *
 * 의존성: port interface만.
 */

import { Ok, Err } from '@/core/domain/result'
import type { Result } from '@/core/domain/result'
import { sat, toNumber } from '@/core/domain/amount'
import { createTransaction } from '@/core/domain/transaction'
import type { PaymentError } from '@/core/errors/payment.errors'
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

      // Lightning adapter가 있어야 swap 가능 (melt/mint)
      const lightning = module.getPaymentAdapters().find(a =>
        a.capabilities.canSend && a.capabilities.canReceive && a.createReceiveRequest,
      )
      if (!lightning) continue

      // 이 모듈의 모든 계정 조합으로 swap pair 생성
      // 실제 계정 목록은 getBalance에서 얻지만, sync 메서드에서 async 불가
      // → pair는 moduleId만 반환, 실제 accountId는 UI에서 선택
      pairs.push({
        sourceAccountId: '*',
        targetAccountId: '*',
        moduleId: module.id,
      })
    }

    return pairs
  }

  async estimateSwap(params: SwapParams): Promise<Result<SwapEstimate, PaymentError>> {
    const lightning = this.findLightningAdapter(params.sourceAccountId)
    if (!lightning) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: 'No lightning adapter for source account' })
    }

    try {
      // target에서 임시 invoice 생성하여 fee 추정
      const targetLightning = this.findLightningAdapter(params.targetAccountId)
      if (!targetLightning?.createReceiveRequest) {
        return Err({ code: 'ADAPTER_NOT_FOUND', message: 'No lightning adapter for target account' })
      }

      const request = await targetLightning.createReceiveRequest({
        amount: params.amount,
        accountId: params.targetAccountId,
      })

      const feeEstimate = await lightning.estimateFee({
        destination: request.encoded,
        amount: params.amount,
        accountId: params.sourceAccountId,
      })

      return Ok({
        fee: feeEstimate.fee,
        sourceAmount: params.amount,
        targetAmount: params.amount,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Err({ code: 'SWAP_FAILED', message })
    }
  }

  async executeSwap(params: SwapParams): Promise<Result<SwapResult, PaymentError>> {
    const sourceLightning = this.findLightningAdapter(params.sourceAccountId)
    const targetLightning = this.findLightningAdapter(params.targetAccountId)

    if (!sourceLightning) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: 'No lightning adapter for source' })
    }
    if (!targetLightning?.createReceiveRequest) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: 'No lightning adapter for target' })
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

    try {
      // 1. Target에서 receive request 생성
      let request = await targetLightning.createReceiveRequest({
        amount: swapAmount,
        accountId: params.targetAccountId,
      })

      // 스왑 quote 마킹 — mint-quote-observer가 중복 TX 생성하지 않도록
      swapQuoteId = request.id
      this.swapQuoteMarker?.mark(swapQuoteId)

      // 2. Receive 완료 대기 등록 (send 전에 등록 — race condition 방지)
      receiveCompletion = this.createReceiveCompletionHandle(targetLightning, request.id)

      // 3. Source에서 send (melt) 준비
      let prepared = await sourceLightning.prepareSend({
        destination: request.encoded,
        amount: swapAmount,
        accountId: params.sourceAccountId,
      })

      // 4. Drain mode: 전달받은 amount를 총 예산으로 보고 fee를 내부에서 차감한다.
      if (params.drain) {
        const drainBudget = toNumber(params.amount)
        let drainAttempts = 0

        while (toNumber(prepared.amount) + toNumber(prepared.fee) > drainBudget) {
          await sourceLightning.cancelPrepared(prepared.id)

          const adjustedNum = drainBudget - toNumber(prepared.fee)
          if (adjustedNum <= 0) {
            receiveCompletion.cancel()
            if (swapQuoteId) {
              await this.abandonSwapQuote(params.targetAccountId, swapQuoteId)
              swapQuoteId = null
            }
            return Err({ code: 'INSUFFICIENT_BALANCE', message: 'Balance too low to cover swap fees' })
          }
          if (adjustedNum >= toNumber(swapAmount)) {
            receiveCompletion.cancel()
            if (swapQuoteId) {
              await this.abandonSwapQuote(params.targetAccountId, swapQuoteId)
              swapQuoteId = null
            }
            return Err({ code: 'SWAP_FAILED', message: 'Unable to reduce swap amount for drain mode' })
          }

          swapAmount = sat(adjustedNum)

          receiveCompletion.cancel()
          if (swapQuoteId) {
            await this.abandonSwapQuote(params.targetAccountId, swapQuoteId)
            swapQuoteId = null
          }
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
            receiveCompletion.cancel()
            if (swapQuoteId) {
              await this.abandonSwapQuote(params.targetAccountId, swapQuoteId)
              swapQuoteId = null
            }
            return Err({ code: 'SWAP_FAILED', message: 'Unable to finalize drain swap amount' })
          }
        }
      }

      // 4. Transaction 기록
      const swapMeta = {
        fromMintUrl: params.sourceAccountId,
        toMintUrl: params.targetAccountId,
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

      // 5. Execute send
      sendAttempted = true
      const sendResult = await sourceLightning.executeSend(prepared.id)

      // 6. Receive 완료 대기
      await receiveCompletion.promise

      // 7. Transaction 완료 처리
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

      // 스왑 quote 마킹 해제
      if (swapQuoteId) this.swapQuoteMarker?.unmark(swapQuoteId)

      return Ok({
        sendTxId,
        receiveTxId,
        amount: swapAmount,
        fee: prepared.fee,
      })
    } catch (error) {
      receiveCompletion.cancel()

      if (!sendAttempted && swapQuoteId) {
        await this.abandonSwapQuote(params.targetAccountId, swapQuoteId)
        swapQuoteId = null
      }

      // 스왑 quote 마킹 해제 (실패 시에도)
      if (swapQuoteId) this.swapQuoteMarker?.unmark(swapQuoteId)

      const message = error instanceof Error ? error.message : 'Unknown error'

      await Promise.all([
        this.txRepo.update(sendTxId, { status: 'failed' }).catch(() => {}),
        this.txRepo.update(receiveTxId, { status: 'failed' }).catch(() => {}),
      ])

      this.eventBus.emit({
        type: 'swap:failed',
        payload: {
          sourceAccountId: params.sourceAccountId,
          targetAccountId: params.targetAccountId,
          error: message,
        },
      })

      return Err({ code: 'SWAP_FAILED', message })
    }
  }

  // ─── Private helpers ───

  private findLightningAdapter(_accountId: string): PaymentMethodAdapter | undefined {
    for (const module of this.modules) {
      if (!module.isEnabled()) continue
      // swap은 lightning adapter 사용 (melt on source, mint on target)
      const lightning = module.getPaymentAdapters().find(a =>
        a.protocol === 'bolt11' && a.capabilities.canSend && a.capabilities.canReceive,
      )
      if (lightning) return lightning
    }
    return undefined
  }

  private async abandonSwapQuote(accountId: string, quoteId: string): Promise<void> {
    this.swapQuoteMarker?.unmark(quoteId)
    if (!this.swapQuoteMarker?.abandon) return

    try {
      await this.swapQuoteMarker.abandon(accountId, quoteId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[SwapService] Failed to abandon orphaned swap quote ${quoteId}: ${message}`)
    }
  }

  private createReceiveCompletionHandle(
    adapter: PaymentMethodAdapter,
    requestId: string,
  ): ReceiveCompletionHandle {
    if (!adapter.onReceiveCompleted) {
      // adapter가 수신 완료 감지를 지원하지 않으면 즉시 resolve
      // (Coco watcher가 대신 처리하는 경우)
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
      }, 5 * 60 * 1000) // 5분 타임아웃

      unsubscribe = adapter.onReceiveCompleted!(requestId, () => {
        finish(resolve)
      })
    })

    return {
      promise,
      cancel: () => finish(),
    }
  }
}
