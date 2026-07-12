/**
 * CashuEcashAdapter — PaymentMethodAdapter for eCash token send/receive.
 *
 * Takes an injected EcashBackend so it doesn't depend on the Coco SDK directly.
 */
import type {
  PaymentMethodAdapter,
  InputInspection,
  SendParams,
  PreparedPayment,
  ExecutingPayment,
  FeeEstimate,
  RecoveryReport,
  ReceiveParams,
  ReceiveRequest,
  RedeemResult,
} from '@/core/ports/driven/payment-method.port'
import { amount as toAmount, sat, toNumber } from '@/core/domain/amount'
import type { Unit } from '@/core/domain/amount'
import type { RedeemFeeEstimate } from '@/core/ports/driven/payment-method.port'
import type { Transaction } from '@/core/domain/transaction'
import type { TransferOperator, TransferIntent, MessageTransport } from '@/core/ports/driven/transfer-operator.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import { createPendingTransfer, transitionPhase, isExpired } from '@/core/domain/pending-transfer'
import type { EventBus } from '@/core/events/event-bus'
import { getTokenMetadata } from '@cashu/cashu-ts'

// ─── Backend interface (for DI) ───

export interface LockingCondition {
  kind: 'P2PK'
  data: string
  tags?: string[][]
}

/** Return type of receiveToken — unit is decided by the backend (cashu-backend.ts) */
export interface ReceivedTokenResult {
  /** Actual received amount (gross - fee) */
  amount: number
  /** Fee based on input_fee_ppk (0 = no fee) */
  fee: number
  /** Mint's token unit — decided by the backend (currently always 'sat', structured for multi-unit) */
  unit: string
  mintUrl: string
  memo?: string
}

/** Return type of estimateReceiveFee */
export interface ReceiveFeeEstimate {
  grossAmount: number
  fee: number
  netAmount: number
  unit: string
  mintUrl: string
}

import type { ProofStateResult } from '@/core/ports/driven/send-token-operator.port'

export interface EcashBackend {
  prepareSend(params: {
    mintUrl: string
    amount: number
    lockingCondition?: LockingCondition
  }): Promise<{ operationId: string; fee: number; needsSwap: boolean }>
  executeSend(operationId: string, options?: { memo?: string }): Promise<{ token: string }>
  rollbackSend(operationId: string): Promise<void>
  finalizeSend(operationId: string): Promise<void>
  receiveToken(token: string): Promise<ReceivedTokenResult>
  estimateReceiveFee(token: string): Promise<ReceiveFeeEstimate>
  recoverPendingSendTokens(): Promise<{ reclaimed: number; recorded: number }>
  redeemPendingReceivedTokens(): Promise<{ redeemed: number; failed: number }>
  storeOfflineToken(token: string, amount: number, mintUrl: string, dleqStatus: 'valid' | 'missing'): Promise<string>
  inspectInput?(token: string): Promise<InputInspection>
  checkProofStates(token: string): Promise<ProofStateResult>
  getSendOperationState(operationId: string): Promise<string | null>
}

// ─── Constants ───

const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

// ─── Adapter ───

export class CashuEcashAdapter implements PaymentMethodAdapter, TransferOperator {
  readonly id = 'cashu:ecash'
  readonly moduleId = 'cashu'
  readonly protocol = 'ecash'
  readonly supportedUnits = ['sat']
  readonly capabilities = {
    canSend: true,
    canReceive: true,
    canEstimateFee: true,
  }

  private pendingMemos = new Map<string, string>()

  constructor(
    private backend: EcashBackend,
    private transport?: MessageTransport,
    private tokenCodec?: TokenCodec,
    private eventBus?: EventBus,
  ) { }

  // ─── TransferOperator ───

  async prepare(intent: TransferIntent): Promise<PendingTransfer> {
    const prepared = await this.backend.prepareSend({
      mintUrl: intent.accountId,
      amount: toNumber(intent.amount),
    })

    if (intent.memo) {
      this.pendingMemos.set(prepared.operationId, intent.memo)
    }

    return createPendingTransfer({
      id: crypto.randomUUID(),
      txId: intent.txId,
      direction: 'outgoing',
      finality: 'deferred',
      onExpiry: 'reclaim',
      expiresAt: Date.now() + TOKEN_TTL,
      transportRef: {
        type: 'ecash-token',
        operationId: prepared.operationId,
        recipient: intent.recipient,
        amount: toNumber(intent.amount), // for building the Transaction
        mintUrl: intent.accountId, // for building the Transaction
        fee: prepared.fee, // for showing the fee in transaction history
        memo: intent.memo,
      },
      now: Date.now(),
    })
  }

  async execute(transfer: PendingTransfer): Promise<PendingTransfer> {
    // incoming: redeem (user taps "Receive")
    if (transfer.direction === 'incoming') {
      return this.executeIncoming(transfer)
    }

    // outgoing: create token + send
    return this.executeOutgoing(transfer)
  }

  async processIncoming(transfer: PendingTransfer): Promise<PendingTransfer> {
    return this.executeIncoming(transfer)
  }

  private async executeOutgoing(transfer: PendingTransfer): Promise<PendingTransfer> {
    const ref = transfer.transportRef as {
      operationId: string
      recipient?: string
      memo?: string
    }

    // 1. Create token (prefer transportRef.memo; legacy prepareSend path falls back to pendingMemos)
    const memo = ref.memo ?? this.pendingMemos.get(ref.operationId)
    const result = await this.backend.executeSend(ref.operationId, { memo })
    this.pendingMemos.delete(ref.operationId)

    // 2. Send (only when a recipient exists — QR/clipboard don't send)
    let deliveryId: string | undefined
    if (ref.recipient && this.transport) {
      const publishResult = await this.transport.publish({
        recipient: ref.recipient,
        content: result.token,
      })
      deliveryId = publishResult.deliveryId
    }

    const prevRef = transfer.transportRef as {
      type: string
      operationId: string
      recipient?: string
      amount: number
      mintUrl: string
    }

    return {
      ...transitionPhase(transfer, 'submitted', Date.now()),
      transportRef: {
        ...prevRef,
        token: result.token,
        deliveryId,
      },
    } as PendingTransfer
  }

  private async executeIncoming(transfer: PendingTransfer): Promise<PendingTransfer> {
    const ref = transfer.transportRef as {
      content?: string
      token?: string
      requestId?: string
      eventId?: string
      memo?: string
    }

    const token = ref.token ?? this.extractTokenFromContent(ref.content ?? '')
    if (!token) {
      throw new Error('No token found in incoming transfer')
    }

    // redeem — store fee/net amount in transportRef for bridge/tx records
    const { amount, fee, unit, mintUrl, memo } = await this.backend.receiveToken(token)

    // Restores the receive:settled event lost in the GiftWrapWatcher → TLS migration.
    // Needed so ReceiveQRStep switches to the completion page via lastReceivedRequestId
    // and EventStoreBridge removes the pending quote.
    if (this.eventBus && ref.requestId) {
      this.eventBus.emit({
        type: 'receive:settled',
        payload: {
          requestId: ref.requestId,
          amount,
          ...(fee > 0 ? { fee } : undefined),
          accountId: mintUrl,
          method: 'nostr-gift-wrap',
          isSwapStep: false,
          wasRequestFulfilled: true,
          metadata: { eventId: ref.eventId },
        },
      })
    }

    return {
      ...transitionPhase(transfer, 'settled', Date.now()),
      transportRef: {
        ...ref,
        token,
        receivedAmount: amount,
        fee,
        unit,
        mintUrl,
        memo: memo ?? ref.memo,
      },
    } as PendingTransfer
  }

  private extractTokenFromContent(content: string): string | undefined {
    const trimmed = content.trim()
    if (/^cashu[ab]/i.test(trimmed)) return trimmed
    // JSON proofs → encoded token (backend.receiveToken expects encoded form)
    if (trimmed.startsWith('{"mint"') || trimmed.includes('"proofs"')) {
      if (!this.tokenCodec) return undefined
      try {
        const parsed = JSON.parse(trimmed) as { mint?: string; unit?: string; proofs?: unknown[]; memo?: string }
        if (!parsed.mint || !Array.isArray(parsed.proofs)) return undefined
        return this.tokenCodec.encodeCashuToken({
          mint: parsed.mint,
          unit: parsed.unit ?? 'sat',
          proofs: parsed.proofs as import('@/core/domain/cashu-payment-payload').CashuProof[],
          memo: parsed.memo,
        })
      } catch {
        return undefined
      }
    }
    return undefined
  }

  async poll(transfer: PendingTransfer): Promise<TransferPhase> {
    const ref = transfer.transportRef as {
      operationId?: string
      token?: string
    }

    // 1. Check SDK internal state first
    if (ref.operationId) {
      const opState = await this.backend.getSendOperationState(ref.operationId)
      if (opState === 'finalized') return 'settled'
      if (opState === 'rolled_back') return 'recoverable'
    }

    // 2. Check token chain state
    if (ref.token) {
      const proofState = await this.backend.checkProofStates(ref.token)
      if (proofState.allSpent) return 'settled'
      if (proofState.allPending) return 'awaiting_confirmation'
    }

    // 3. Expiry check
    if (isExpired(transfer)) return 'recoverable'

    return 'awaiting_confirmation'
  }

  /**
   * Local first-pass sweep verdict (network 0).
   * send: Coco local op state only. Does NOT finalize expiry as recoverable here:
   * recoverable falls outside listActive so sweep won't revisit it, and if the
   * recipient already redeemed the token the reclaim UI would suggest a reclaim
   * bound to fail — so the expiry verdict is left to confirmStuck, which first checks
   * checkProofStates (allSpent→settled). incoming (awaiting manual receive): expiry
   * only — there is no remote-state concept.
   */
  async pollLocal(transfer: PendingTransfer): Promise<TransferPhase> {
    if (transfer.direction === 'incoming') {
      if (isExpired(transfer)) return 'failed'
      return transfer.phase
    }

    const ref = transfer.transportRef as { operationId?: string }
    if (ref.operationId) {
      const opState = await this.backend.getSendOperationState(ref.operationId)
      if (opState === 'finalized') return 'settled'
      if (opState === 'rolled_back') return 'recoverable'
    }
    return transfer.phase
  }

  /**
   * One remote stuck-check: send uses `checkProofsStates` (an isolated raw call that
   * must stay reachable from the stuck path, not just the reclaim screen). incoming is
   * null — no remote-check concept, and sweep doesn't count it as stuck (so
   * awaiting-manual-receive doesn't pollute the gate).
   */
  async confirmStuck(transfer: PendingTransfer): Promise<TransferPhase | null> {
    if (transfer.direction === 'incoming') return null

    const ref = transfer.transportRef as { token?: string }
    if (!ref.token) return null

    const proofState = await this.backend.checkProofStates(ref.token)
    if (proofState.allSpent) return 'settled'
    if (isExpired(transfer)) return 'recoverable'
    return transfer.phase
  }

  async reclaim(transfer: PendingTransfer): Promise<void> {
    const ref = transfer.transportRef as { operationId: string }
    await this.backend.rollbackSend(ref.operationId)
  }

  // ─── Send ───

  async estimateFee(params: SendParams): Promise<FeeEstimate> {
    const prepared = await this.backend.prepareSend({
      mintUrl: params.accountId,
      amount: toNumber(params.amount),
    })
    const fee = prepared.fee
    await this.backend.rollbackSend(prepared.operationId)
    return { fee: sat(fee), method: 'ecash', protocol: 'cashu-token' }
  }

  async prepareSend(params: SendParams): Promise<PreparedPayment> {
    const lockingCondition = params.options?.lockingCondition as LockingCondition | undefined

    const prepared = await this.backend.prepareSend({
      mintUrl: params.accountId,
      amount: toNumber(params.amount),
      lockingCondition,
    })

    if (params.memo) {
      this.pendingMemos.set(prepared.operationId, params.memo)
    }

    return {
      id: prepared.operationId,
      method: 'ecash',
      protocol: 'cashu-token',
      amount: params.amount,
      fee: sat(prepared.fee),
      memo: params.memo,
    }
  }

  async executeSend(preparedId: string): Promise<ExecutingPayment> {
    const memo = this.pendingMemos.get(preparedId)
    this.pendingMemos.delete(preparedId)
    const result = await this.backend.executeSend(preparedId, { memo })
    return {
      id: preparedId,
      state: 'pending',
      data: { token: result.token },
    }
  }

  async cancelPrepared(preparedId: string): Promise<void> {
    this.pendingMemos.delete(preparedId)
    await this.backend.rollbackSend(preparedId)
  }

  async reclaimFailed(operationId: string): Promise<void> {
    await this.backend.rollbackSend(operationId)
  }

  async finalizeSend(operationId: string): Promise<void> {
    await this.backend.finalizeSend(operationId)
  }

  // ─── Receive request ───

  async createReceiveRequest(_params: ReceiveParams): Promise<ReceiveRequest> {
    // creq creation is orchestrated by CashuModule (needs keyring + relay + nostr material)
    throw new Error('Use CashuModule.createReceiveRequest() for ecash receive requests')
  }

  // ─── Receive (redeem) ───

  canRedeem(input: string): boolean {
    return /^cashu[ab]/i.test(input.trim())
  }

  async inspectInput(input: string): Promise<InputInspection> {
    if (this.backend.inspectInput) {
      return this.backend.inspectInput(input)
    }
    return { lockStatus: 'not-supported', proofIntegrity: 'not-supported' }
  }

  async redeem(input: string): Promise<RedeemResult> {
    // Extract memo before redeem — the original token is inaccessible after receiveToken
    let memo: string | undefined
    try {
      const decoded = getTokenMetadata(input)
      if (decoded.memo) memo = decoded.memo
    } catch { /* ignore decode failure — receiveToken will handle */ }

    try {
      const { amount, fee, unit, mintUrl } = await this.backend.receiveToken(input)
      return {
        requestId: crypto.randomUUID(),
        // Build Amount with the backend-decided unit — no hardcoded sat
        amount: toAmount(amount, unit as Unit),
        fee: fee > 0 ? toAmount(fee, unit as Unit) : undefined,
        method: 'cashu:ecash',
        protocol: 'cashu-token',
        completed: true,
        accountId: mintUrl,
        memo,
        // Store the original token — read for audit in the Token tab Detail/RawSheet
        metadata: { token: input },
      }
    } catch (error) {
      console.error('[redeem] receiveToken failed:', error)
      console.error('[redeem] Error message:', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async estimateRedeemFee(input: string): Promise<RedeemFeeEstimate> {
    const { grossAmount, fee, netAmount, unit } = await this.backend.estimateReceiveFee(input)
    const u = unit as Unit
    return {
      grossAmount: toAmount(grossAmount, u),
      fee: toAmount(fee, u),
      netAmount: toAmount(netAmount, u),
    }
  }

  // ─── Reclaim estimate ───
  /**
   * The Cashu token is stored in tx.metadata.token. A reclaim swap applies the same
   * input_fee_ppk as a receive swap, so it delegates to estimateRedeemFee.
   */
  async estimateReclaimFee(tx: Transaction): Promise<RedeemFeeEstimate> {
    const token = tx.metadata?.token as string | undefined
    if (!token) {
      throw new Error('No cashu token stored in transaction metadata')
    }
    return this.estimateRedeemFee(token)
  }

  // ─── Recovery ───

  async recoverPending(): Promise<RecoveryReport> {
    const [sendResult, recvResult] = await Promise.allSettled([
      this.backend.recoverPendingSendTokens(),
      this.backend.redeemPendingReceivedTokens(),
    ])
    const send = sendResult.status === 'fulfilled' ? sendResult.value : { reclaimed: 0 }
    const recv = recvResult.status === 'fulfilled' ? recvResult.value : { redeemed: 0, failed: 0 }
    return {
      recovered: send.reclaimed + recv.redeemed,
      failed: recv.failed,
    }
  }
}
