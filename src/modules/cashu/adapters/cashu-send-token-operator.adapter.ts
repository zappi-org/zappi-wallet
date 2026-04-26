import type { SendTokenOperator, ProofStateResult, ReclaimedTokenResult } from '@/core/ports/driven/send-token-operator.port'
import { amount as toAmount, type Unit } from '@/core/domain/amount'

export interface CashuSendTokenOperatorBackend {
  rollbackSend(operationId: string): Promise<void>
  finalizeSend(operationId: string): Promise<void>
  receiveToken(token: string): Promise<{ amount: number; fee: number; unit: string; mintUrl: string }>
  checkProofStates(token: string): Promise<ProofStateResult>
}

export class CashuSendTokenOperatorAdapter implements SendTokenOperator {
  constructor(private readonly backend: CashuSendTokenOperatorBackend) {}

  async rollbackSendToken(operationId: string): Promise<void> {
    await this.backend.rollbackSend(operationId)
  }

  async finalizeSend(operationId: string): Promise<void> {
    await this.backend.finalizeSend(operationId)
  }

  async reclaimToken(token: string): Promise<ReclaimedTokenResult> {
    const result = await this.backend.receiveToken(token)
    const unit = result.unit as Unit
    return {
      amount: toAmount(result.amount, unit),
      fee: result.fee > 0 ? toAmount(result.fee, unit) : undefined,
      accountId: result.mintUrl,
    }
  }

  async checkProofStates(token: string): Promise<ProofStateResult> {
    return this.backend.checkProofStates(token)
  }
}
