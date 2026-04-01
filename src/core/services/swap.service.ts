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

export class SwapService implements SwapUseCase {
  constructor(
    private modules: WalletModule[],
    private txRepo: TransactionRepository,
    private eventBus: EventBus,
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

    try {
      // 1. Target에서 receive request 생성
      const request = await targetLightning.createReceiveRequest({
        amount: params.amount,
        accountId: params.targetAccountId,
      })

      // 2. Receive 완료 대기 등록 (send 전에 등록 — race condition 방지)
      const receiveCompleted = this.waitForReceiveCompletion(targetLightning, request.id)

      // 3. Source에서 send (melt)
      const prepared = await sourceLightning.prepareSend({
        destination: request.encoded,
        amount: params.amount,
        accountId: params.sourceAccountId,
      })

      // 4. Transaction 기록
      const sendTx = createTransaction({
        id: sendTxId,
        direction: 'send',
        method: prepared.method,
        protocol: prepared.protocol,
        amount: prepared.amount,
        accountId: params.sourceAccountId,
        intent: 'swap',
        linkedTxId: receiveTxId,
      })
      const receiveTx = createTransaction({
        id: receiveTxId,
        direction: 'receive',
        method: request.method,
        protocol: request.protocol,
        amount: params.amount,
        accountId: params.targetAccountId,
        intent: 'swap',
        linkedTxId: sendTxId,
      })
      await Promise.all([this.txRepo.save(sendTx), this.txRepo.save(receiveTx)])

      // 5. Execute send
      await sourceLightning.executeSend(prepared.id)

      // 6. Receive 완료 대기
      await receiveCompleted

      // 7. Transaction 완료 처리
      const now = Date.now()
      await Promise.all([
        this.txRepo.update(sendTxId, { status: 'completed', completedAt: now }),
        this.txRepo.update(receiveTxId, { status: 'completed', completedAt: now }),
      ])

      this.eventBus.emit({
        type: 'swap:completed',
        payload: {
          sendTxId,
          receiveTxId,
          sourceAccountId: params.sourceAccountId,
          targetAccountId: params.targetAccountId,
          amount: params.amount,
          fee: prepared.fee,
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

      return Ok({
        sendTxId,
        receiveTxId,
        amount: params.amount,
        fee: prepared.fee,
      })
    } catch (error) {
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
        a.id.includes('lightning') && a.capabilities.canSend && a.capabilities.canReceive,
      )
      if (lightning) return lightning
    }
    return undefined
  }

  private waitForReceiveCompletion(
    adapter: PaymentMethodAdapter,
    requestId: string,
  ): Promise<void> {
    if (!adapter.onReceiveCompleted) {
      // adapter가 수신 완료 감지를 지원하지 않으면 즉시 resolve
      // (Coco watcher가 대신 처리하는 경우)
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe()
        reject(new Error('Swap receive timed out'))
      }, 5 * 60 * 1000) // 5분 타임아웃

      const unsubscribe = adapter.onReceiveCompleted!(requestId, () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
}
