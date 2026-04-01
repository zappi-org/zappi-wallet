/**
 * PaymentService — PaymentUseCase 구현
 *
 * WalletModule + TransactionRepository + EventBus를 조합하여
 * 결제 유스케이스를 구현하는 application service.
 *
 * 의존성: port interface만. module/adapter 구체 구현에 무관.
 */

import { Ok, Err } from '@/core/domain/result'
import type { Result } from '@/core/domain/result'
import type { Amount } from '@/core/domain/amount'
import { createTransaction, completeTransaction } from '@/core/domain/transaction'
import type { PaymentError } from '@/core/errors/payment.errors'
import type { EventBus } from '@/core/events/event-bus'
import type {
  PaymentUseCase,
  PaymentMethodInfo,
  SendResult,
  ReceiveTokenResult,
  RecoveryReport,
} from '@/core/ports/driving/payment.usecase'
import type { WalletModule, ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import type {
  PaymentMethodAdapter,
  FeeEstimate,
  ParsedInput,
  ReceiveRequest,
} from '@/core/ports/driven/payment-method.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'

export class PaymentService implements PaymentUseCase {
  constructor(
    private modules: WalletModule[],
    private txRepo: TransactionRepository,
    private eventBus: EventBus,
  ) {}

  // ─── Query ───

  async getAccounts(): Promise<ModuleBalance[]> {
    const enabled = this.modules.filter(m => m.isEnabled())
    return Promise.all(enabled.map(m => m.getBalance()))
  }

  getMethodsForAccount(accountId: string): PaymentMethodInfo[] {
    const adapter = this.findAdaptersForAccount(accountId)
    return adapter.map(a => ({
      id: a.id,
      moduleId: a.moduleId,
      capabilities: { ...a.capabilities },
      supportedUnits: [...a.supportedUnits],
    }))
  }

  parseInput(input: string): ParsedInput | null {
    for (const module of this.modules) {
      if (!module.isEnabled()) continue
      for (const adapter of module.getPaymentAdapters()) {
        if (!adapter.parseInput) continue
        const result = adapter.parseInput(input)
        if (result) return result
      }
    }
    return null
  }

  // ─── Send ───

  async send(params: {
    accountId: string
    adapterId: string
    destination: string
    amount: Amount
    memo?: string
    options?: Record<string, unknown>
  }): Promise<Result<SendResult, PaymentError>> {
    const adapter = this.findAdapter(params.adapterId)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter not found: ${params.adapterId}` })
    }

    const txId = crypto.randomUUID()
    let preparedId: string | undefined

    try {
      const prepared = await adapter.prepareSend({
        destination: params.destination,
        amount: params.amount,
        accountId: params.accountId,
        memo: params.memo,
        options: params.options,
      })
      preparedId = prepared.id

      const tx = createTransaction({
        id: txId,
        direction: 'send',
        method: prepared.method,
        protocol: prepared.protocol,
        amount: prepared.amount,
        accountId: params.accountId,
        memo: params.memo,
      })
      await this.txRepo.save(tx)

      const executing = await adapter.executeSend(prepared.id)

      const completed = completeTransaction(tx)
      await this.txRepo.update(txId, {
        status: 'completed',
        completedAt: completed.completedAt,
        metadata: executing.data,
      })

      this.eventBus.emit({
        type: 'payment:completed',
        payload: { txId, method: prepared.method, amount: prepared.amount },
      })
      this.eventBus.emit({
        type: 'balance:changed',
        payload: { moduleId: adapter.moduleId, accountId: params.accountId },
      })

      return Ok({
        transactionId: txId,
        state: executing.state,
        data: executing.data,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      // prepared payment가 있으면 rollback하여 proof 누수 방지
      if (preparedId) {
        await adapter.cancelPrepared(preparedId).catch(() => {})
      }

      await this.txRepo.update(txId, { status: 'failed', completedAt: Date.now() }).catch(() => {})

      this.eventBus.emit({
        type: 'payment:failed',
        payload: { txId, method: adapter.id, error: message },
      })

      return Err({ code: 'UNKNOWN', message })
    }
  }

  // ─── Receive ───

  async receive(params: {
    accountId: string
    adapterId: string
    amount: Amount
    description?: string
  }): Promise<Result<ReceiveRequest, PaymentError>> {
    const adapter = this.findAdapter(params.adapterId)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter not found: ${params.adapterId}` })
    }
    if (!adapter.createReceiveRequest) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter does not support receive: ${params.adapterId}` })
    }

    try {
      const request = await adapter.createReceiveRequest({
        amount: params.amount,
        accountId: params.accountId,
        description: params.description,
      })

      const tx = createTransaction({
        id: request.id,
        direction: 'receive',
        method: request.method,
        protocol: request.protocol,
        amount: params.amount,
        accountId: params.accountId,
        memo: params.description,
      })
      await this.txRepo.save(tx)

      return Ok(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Err({ code: 'UNKNOWN', message })
    }
  }

  // ─── Receive Token ───

  async receiveToken(params: {
    adapterId: string
    token: string
  }): Promise<Result<ReceiveTokenResult, PaymentError>> {
    const adapter = this.findAdapter(params.adapterId)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter not found: ${params.adapterId}` })
    }
    if (!adapter.receiveToken) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter does not support receiveToken: ${params.adapterId}` })
    }

    try {
      const result = await adapter.receiveToken(params.token)
      return Ok({ amount: result.amount })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Err({ code: 'UNKNOWN', message })
    }
  }

  // ─── Fee Estimation ───

  async estimateFee(params: {
    accountId: string
    adapterId: string
    destination: string
    amount: Amount
  }): Promise<Result<FeeEstimate, PaymentError>> {
    const adapter = this.findAdapter(params.adapterId)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter not found: ${params.adapterId}` })
    }

    try {
      const estimate = await adapter.estimateFee({
        destination: params.destination,
        amount: params.amount,
        accountId: params.accountId,
      })
      return Ok(estimate)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Err({ code: 'UNKNOWN', message })
    }
  }

  // ─── Recovery ───

  async recoverAll(): Promise<RecoveryReport[]> {
    const reports: RecoveryReport[] = []

    for (const module of this.modules) {
      if (!module.isEnabled()) continue
      for (const adapter of module.getPaymentAdapters()) {
        try {
          const report = await adapter.recoverPending()
          reports.push({
            moduleId: adapter.moduleId,
            recovered: report.recovered,
            failed: report.failed,
          })

          if (report.recovered > 0) {
            this.eventBus.emit({
              type: 'recovery:completed',
              payload: {
                moduleId: adapter.moduleId,
                recovered: report.recovered,
                failed: report.failed,
              },
            })
          }
        } catch {
          reports.push({ moduleId: adapter.moduleId, recovered: 0, failed: 1 })
        }
      }
    }

    return reports
  }

  // ─── Private helpers ───

  private findAdapter(adapterId: string): PaymentMethodAdapter | undefined {
    for (const module of this.modules) {
      if (!module.isEnabled()) continue
      const adapter = module.getPaymentAdapters().find(a => a.id === adapterId)
      if (adapter) return adapter
    }
    return undefined
  }

  private findAdaptersForAccount(accountId: string): PaymentMethodAdapter[] {
    const result: PaymentMethodAdapter[] = []
    for (const module of this.modules) {
      if (!module.isEnabled()) continue
      // module의 모든 adapter를 반환 — accountId는 mint/federation 식별자이므로
      // 해당 module이 이 account를 소유하는지는 balance로 확인
      result.push(...module.getPaymentAdapters())
    }
    return result
  }
}
