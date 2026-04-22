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
import { amount as amt } from '@/core/domain/amount'
import { createTransaction, settleAsDelivered, settleAsReclaimed } from '@/core/domain/transaction'
import type { PaymentError } from '@/core/errors/payment.errors'
import type { EventBus } from '@/core/events/event-bus'
import type {
  PaymentUseCase,
  PaymentMethodInfo,
  SendResult,
  ReclaimResult,
  RecoveryReport,
  InputInspectionResult,
} from '@/core/ports/driving/payment.usecase'
import type { WalletModule, ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import type {
  PaymentMethodAdapter,
  FeeEstimate,
  ReceiveRequest,
  RedeemResult,
  RedeemFeeEstimate,
} from '@/core/ports/driven/payment-method.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'

/** Recipient claimed the proofs or SDK already finalized — treat as consumed. */
function isAlreadySpentMessage(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('already spent') ||
    m.includes('token spent') ||
    m.includes('token_spent') ||
    m.includes("state 'finalized'")
  )
}

/** SDK op already rolled back — the reclaim intent was already fulfilled. */
function isAlreadyRolledBackMessage(message: string): boolean {
  return message.toLowerCase().includes("state 'rolled_back'")
}

/**
 * SDK op is mid-rollback (operation stuck in transition). Common causes:
 * - A previous reclaim attempt crashed / network-interrupted partway through
 * - Recipient spent the proofs concurrently with our rollback attempt
 * In either case the pending entry is stale; reconcile it to the user's
 * original intent (reclaim) so the UI surfaces a definitive outcome.
 */
function isRollingBackStateMessage(message: string): boolean {
  return message.toLowerCase().includes("state 'rolling_back'")
}

export class PaymentService implements PaymentUseCase {
  constructor(
    private modules: WalletModule[],
    private txRepo: TransactionRepository,
    private eventBus: EventBus,
    private operationMap?: OperationMap,
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
      protocol: a.protocol,
      capabilities: { ...a.capabilities },
      supportedUnits: [...a.supportedUnits],
    }))
  }

  // ─── Send ───

  async send(params: {
    accountId: string
    destination?: string
    amount: Amount
    memo?: string
    options?: Record<string, unknown>
  }): Promise<Result<SendResult, PaymentError>> {
    const module = this.findModuleForAccount(params.accountId)
    if (!module) {
      return Err({ code: 'MODULE_NOT_FOUND', message: `No module found for account: ${params.accountId}` })
    }

    const txId = crypto.randomUUID()

    try {
      const tx = createTransaction({
        id: txId,
        direction: 'send',
        method: module.id,
        protocol: '',
        amount: params.amount,
        accountId: params.accountId,
        memo: params.memo,
      })
      await this.txRepo.save(tx)

      const isTokenCreate = !params.destination

      const tx2 = isTokenCreate
        ? { ...tx, outcome: 'unclaimed' as const }
        : tx
      if (isTokenCreate) {
        await this.txRepo.update(txId, { outcome: 'unclaimed' })
      }

      const result = await module.send({
        destination: params.destination,
        accountId: params.accountId,
        amount: params.amount,
        memo: params.memo,
        options: params.options,
      })

      let eventFee: Amount | undefined
      if (!isTokenCreate) {
        const settled = settleAsDelivered(tx2)
        const feeData = result.data?.fee != null
          ? {
              fee: {
                quoted: amt(result.data.fee as number, params.amount.unit),
                effective: result.effectiveFee,
              },
            }
          : {}
        eventFee = result.effectiveFee ?? (result.data?.fee != null ? amt(result.data.fee as number, params.amount.unit) : undefined)
        await this.txRepo.update(txId, {
          status: settled.status,
          outcome: settled.outcome,
          completedAt: settled.completedAt,
          method: result.method,
          protocol: result.protocol,
          metadata: result.data,
          ...feeData,
        })
      } else {
        const feeData = result.data?.fee != null
          ? {
              fee: {
                quoted: amt(result.data.fee as number, params.amount.unit),
                effective: result.effectiveFee,
              },
            }
          : {}
        await this.txRepo.update(txId, {
          method: result.method,
          protocol: result.protocol,
          metadata: { ...result.data, operationId: result.operationId },
          ...feeData,
        })
        // operationMap에 등록 → sendTokenObserver가 send:finalized 시 txId 조회 가능
        if (result.operationId) {
          this.operationMap?.register(result.operationId, txId)
        }
      }

      this.eventBus.emit({
        type: isTokenCreate ? 'payment:deferred' : 'payment:completed',
        payload: { txId, method: module.id, amount: params.amount, fee: eventFee },
      })
      this.eventBus.emit({
        type: 'balance:changed',
        payload: { moduleId: module.id, accountId: params.accountId },
      })

      return Ok({
        transactionId: txId,
        state: result.state,
        data: { ...result.data, operationId: result.operationId },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      await this.txRepo.update(txId, { status: 'failed', completedAt: Date.now() }).catch(() => {})

      this.eventBus.emit({
        type: 'payment:failed',
        payload: { txId, method: module.id, error: message },
      })

      return Err({ code: 'UNKNOWN', message })
    }
  }

  private findModuleForAccount(_accountId: string): WalletModule | undefined {
    // TODO: accountId로 정확한 module 매칭 (현재는 첫 번째 enabled module 반환)
    return this.modules.find(m => m.isEnabled())
  }

  // ─── Receive ───

  async receive(params: {
    accountId: string
    protocol?: string
    amount: Amount
    description?: string
  }): Promise<Result<ReceiveRequest, PaymentError>> {
    const adapter = this.resolveAdapter(params.accountId, params.protocol)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `No adapter found for account: ${params.accountId}` })
    }
    if (!adapter.createReceiveRequest) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter does not support receive: ${adapter.id}` })
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
        metadata: { quoteId: request.id, bolt11: request.encoded },
      })
      await this.txRepo.save(tx)

      // quoteId → txId 매핑 등록 (mintQuoteObserver가 settle 시 사용)
      this.operationMap?.register(request.id, request.id)

      return Ok(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Err({ code: 'UNKNOWN', message })
    }
  }

  // ─── Redeem ───

  async redeem(params: {
    input: string
    transactionId?: string
  }): Promise<Result<RedeemResult, PaymentError>> {
    const adapter = this.resolveRedeemAdapter(params.input)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `No adapter can redeem this input` })
    }

    if (!adapter.redeem) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter ${adapter.id} does not support redeem` })
    }

    // Idempotency: 지정된 txId로 이미 기록된 TX가 있으면 skip
    const txId = params.transactionId ?? crypto.randomUUID()
    if (params.transactionId) {
      const existing = await this.txRepo.getById(txId)
      if (existing) {
        return Ok({
          requestId: txId,
          method: existing.method,
          protocol: existing.protocol,
          amount: existing.amount,
          accountId: existing.accountId,
        } as RedeemResult)
      }
    }

    try {
      const result = await adapter.redeem(params.input)

      // TX 기록 (redeem은 수신이므로 direction: receive)
      const tx = createTransaction({
        id: txId,
        direction: 'receive',
        method: result.method,
        protocol: result.protocol,
        amount: result.amount,
        accountId: result.accountId ?? adapter.moduleId,
        memo: result.memo,
        // eCash receive는 정확한 fee이므로 quoted = effective
        ...(result.fee && { fee: { quoted: result.fee, effective: result.fee } }),
        // Adapter 가 결정한 audit payload 만 저장 — service 는 내용 해석 안 함
        ...(result.metadata && { metadata: result.metadata }),
      })
      const settled = settleAsDelivered(tx)
      await this.txRepo.save(settled)

      this.eventBus.emit({
        type: 'receive:claimed',
        payload: {
          txId: settled.id,
          method: settled.method,
          protocol: settled.protocol,
          amount: settled.amount,
          memo: settled.memo,
        },
      })
      this.eventBus.emit({
        type: 'balance:changed',
        payload: { moduleId: adapter.moduleId, accountId: adapter.moduleId },
      })

      return Ok(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Err({ code: 'UNKNOWN', message })
    }
  }

  // ─── Estimate Redeem Fee ───

  async estimateRedeemFee(params: {
    input: string
  }): Promise<Result<RedeemFeeEstimate, PaymentError>> {
    const adapter = this.resolveRedeemAdapter(params.input)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: 'No adapter can handle this input' })
    }

    if (!adapter.estimateRedeemFee) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter ${adapter.id} does not support fee estimation` })
    }

    try {
      const estimate = await adapter.estimateRedeemFee(params.input)
      return Ok(estimate)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Err({ code: 'UNKNOWN', message })
    }
  }

  // ─── Quote Reclaim (dry-run fee estimate) ───

  async quoteReclaim(params: {
    transactionId: string
  }): Promise<Result<RedeemFeeEstimate, PaymentError>> {
    const tx = await this.txRepo.getById(params.transactionId)
    if (!tx) {
      return Err({ code: 'UNKNOWN', message: `Transaction not found: ${params.transactionId}` })
    }
    if (tx.outcome !== 'unclaimed') {
      return Err({ code: 'UNKNOWN', message: `Transaction is not reclaimable (outcome: ${tx.outcome})` })
    }

    const adapter = this.findAdapter(tx.method)
    if (!adapter?.estimateReclaimFee) {
      return Err({
        code: 'ADAPTER_NOT_FOUND',
        message: `Adapter does not support reclaim fee estimation: ${tx.method}`,
      })
    }

    try {
      const estimate = await adapter.estimateReclaimFee(tx)
      return Ok(estimate)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Err({ code: 'UNKNOWN', message })
    }
  }

  // ─── Inspect Input ───

  async inspectInput(params: {
    input: string
    recipientPubkey?: string
  }): Promise<Result<InputInspectionResult, PaymentError>> {
    const adapter = this.resolveRedeemAdapter(params.input)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: 'No adapter can inspect this input' })
    }

    if (!adapter.inspectInput) {
      return Ok({ lockStatus: 'not-supported', proofIntegrity: 'not-supported' })
    }

    try {
      const inspection = await adapter.inspectInput(params.input)

      // Service-level judgment: compare lockTarget with recipientPubkey
      let lockStatus: InputInspectionResult['lockStatus']
      if (inspection.lockStatus === 'not-supported') {
        lockStatus = 'not-supported'
      } else if (inspection.lockStatus === 'unlocked') {
        lockStatus = 'unlocked'
      } else if (params.recipientPubkey && inspection.lockTarget === params.recipientPubkey) {
        lockStatus = 'locked-to-recipient'
      } else {
        lockStatus = 'locked-to-other'
      }

      return Ok({ lockStatus, proofIntegrity: inspection.proofIntegrity })
    } catch {
      return Ok({ lockStatus: 'not-supported', proofIntegrity: 'not-supported' })
    }
  }

  // ─── Complete Send (finalize deferred token) ───

  async completeSend(params: {
    transactionId: string
  }): Promise<Result<{ transactionId: string }, PaymentError>> {
    const tx = await this.txRepo.getById(params.transactionId)
    if (!tx) {
      return Err({ code: 'UNKNOWN', message: `Transaction not found: ${params.transactionId}` })
    }
    if (tx.outcome !== 'unclaimed') {
      return Err({ code: 'UNKNOWN', message: `Transaction is not completable (outcome: ${tx.outcome})` })
    }

    const operationId = tx.metadata?.operationId as string | undefined
    if (operationId) {
      // adapter에 finalize 위임 (SDK finalize 호출)
      // SDK가 이미 finalize한 경우 (send:finalized 이벤트 경유) 무시
      const adapter = this.findAdapter(tx.method)
      if (adapter?.finalizeSend) {
        try {
          await adapter.finalizeSend(operationId)
        } catch { /* already finalized by SDK — safe to ignore */ }
      }
    }

    const settled = settleAsDelivered(tx)
    await this.txRepo.update(tx.id, {
      status: settled.status,
      outcome: settled.outcome,
      completedAt: settled.completedAt,
    })

    this.eventBus.emit({
      type: 'send:claimed',
      payload: {
        txId: tx.id,
        method: tx.method,
        protocol: tx.protocol,
        amount: tx.amount,
        memo: tx.memo,
      },
    })

    return Ok({ transactionId: tx.id })
  }

  // ─── Reclaim ───

  async reclaim(params: {
    transactionId: string
  }): Promise<Result<ReclaimResult, PaymentError>> {
    const tx = await this.txRepo.getById(params.transactionId)
    if (!tx) {
      return Err({ code: 'UNKNOWN', message: `Transaction not found: ${params.transactionId}` })
    }
    if (tx.outcome !== 'unclaimed') {
      return Err({ code: 'UNKNOWN', message: `Transaction is not reclaimable (outcome: ${tx.outcome})` })
    }

    const operationId = tx.metadata?.operationId as string | undefined
    if (!operationId) {
      return Err({ code: 'UNKNOWN', message: 'No operationId found for reclaim' })
    }

    const adapter = this.findAdapter(tx.method)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `Adapter not found: ${tx.method}` })
    }

    try {
      await adapter.cancelPrepared(operationId)

      const reclaimed = settleAsReclaimed(tx)
      await this.txRepo.update(tx.id, {
        status: reclaimed.status,
        outcome: reclaimed.outcome,
        completedAt: reclaimed.completedAt,
      })

      this.eventBus.emit({
        type: 'send:reclaimed',
        payload: {
          txId: tx.id,
          method: tx.method,
          protocol: tx.protocol,
          amount: tx.amount,
        },
      })
      this.eventBus.emit({
        type: 'balance:changed',
        payload: { moduleId: adapter.moduleId, accountId: tx.accountId },
      })

      return Ok({ transactionId: tx.id, amount: tx.amount, state: 'reclaimed' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      // Edge: recipient already claimed → reconcile as consumed.
      if (isAlreadySpentMessage(message)) {
        const settled = settleAsDelivered(tx)
        await this.txRepo.update(tx.id, {
          status: settled.status,
          outcome: settled.outcome,
          completedAt: settled.completedAt,
        })
        this.eventBus.emit({
          type: 'send:claimed',
          payload: {
            txId: tx.id,
            method: tx.method,
            protocol: tx.protocol,
            amount: tx.amount,
            memo: tx.memo,
          },
        })
        this.eventBus.emit({
          type: 'balance:changed',
          payload: { moduleId: adapter.moduleId, accountId: tx.accountId },
        })
        return Ok({ transactionId: tx.id, amount: tx.amount, state: 'already_consumed' })
      }

      // Edge: SDK op already rolled back or stuck mid-rollback — settle as
      // reclaimed so the stale pending entry is cleared. Balance remains
      // authoritative via the SDK wallet state; tx.outcome is just history.
      if (isAlreadyRolledBackMessage(message) || isRollingBackStateMessage(message)) {
        const reclaimed = settleAsReclaimed(tx)
        await this.txRepo.update(tx.id, {
          status: reclaimed.status,
          outcome: reclaimed.outcome,
          completedAt: reclaimed.completedAt,
        })
        this.eventBus.emit({
          type: 'send:reclaimed',
          payload: {
            txId: tx.id,
            method: tx.method,
            protocol: tx.protocol,
            amount: tx.amount,
          },
        })
        this.eventBus.emit({
          type: 'balance:changed',
          payload: { moduleId: adapter.moduleId, accountId: tx.accountId },
        })
        return Ok({ transactionId: tx.id, amount: tx.amount, state: 'reclaimed' })
      }

      return Err({ code: 'UNKNOWN', message })
    }
  }

  // ─── Fee Estimation ───

  async estimateFee(params: {
    accountId: string
    destination: string
    amount: Amount
  }): Promise<Result<FeeEstimate, PaymentError>> {
    const protocol = this.inferProtocolFromDestination(params.destination)
    const adapter = this.resolveAdapter(params.accountId, protocol)
    if (!adapter) {
      return Err({ code: 'ADAPTER_NOT_FOUND', message: `No adapter found for destination: ${params.destination}` })
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

  private resolveAdapter(accountId: string, protocol?: string): PaymentMethodAdapter | undefined {
    const adapters = this.findAdaptersForAccount(accountId)
    if (protocol) {
      return adapters.find(a => a.protocol === protocol)
    }
    return adapters.find(a => a.capabilities.canReceive)
  }

  private resolveRedeemAdapter(input: string): PaymentMethodAdapter | undefined {
    for (const module of this.modules) {
      if (!module.isEnabled()) continue
      for (const adapter of module.getPaymentAdapters()) {
        if (adapter.canRedeem?.(input)) return adapter
      }
    }
    return undefined
  }

  private inferProtocolFromDestination(dest: string): string {
    const trimmed = dest.trim().toLowerCase()
    if (trimmed.startsWith('lnbc') || trimmed.startsWith('lntb') || trimmed.startsWith('lnbcrt')) return 'bolt11'
    if (trimmed.startsWith('lno')) return 'bolt12'
    return 'ecash'
  }

  private findAdapter(adapterId: string): PaymentMethodAdapter | undefined {
    for (const module of this.modules) {
      if (!module.isEnabled()) continue
      const adapter = module.getPaymentAdapters().find(a => a.id === adapterId)
      if (adapter) return adapter
    }
    return undefined
  }

  private findAdaptersForAccount(_accountId: string): PaymentMethodAdapter[] {
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
