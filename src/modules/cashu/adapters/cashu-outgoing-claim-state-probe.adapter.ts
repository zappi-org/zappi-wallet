import type { OutgoingClaimCheckResult } from '@/core/domain/outgoing-ecash-lifecycle'
import type { OutgoingClaimStateProbe } from '@/core/ports/driven/outgoing-claim-state-probe.port'
import { checkProofStates, getSendOperationState } from '../internal/cashu-backend'

export class CashuOutgoingClaimStateProbeAdapter implements OutgoingClaimStateProbe {
  async checkClaimState(params: {
    token?: string
    operationId?: string
  }): Promise<OutgoingClaimCheckResult> {
    const operationState = params.operationId
      ? await this.getOperationState(params.operationId)
      : null
    if (operationState === 'finalized') return 'claimed'
    if (operationState === 'rolled_back') return 'reclaimed'
    if (!params.token) {
      return operationState === 'prepared' || operationState === 'pending' || operationState === 'executing'
        ? 'claimable'
        : 'unknown'
    }

    try {
      const result = await checkProofStates(params.token)
      if (result.states.length === 0) return 'unknown'
      if (result.allSpent) return 'claimed'
      if (result.allPending || result.states.some((state) => state.state === 'pending')) return 'pending'
      if (result.states.every((state) => state.state === 'unspent')) return 'claimable'
      return 'pending'
    } catch {
      return 'unknown'
    }
  }

  private async getOperationState(operationId: string): Promise<string | null> {
    try {
      return await getSendOperationState(operationId)
    } catch {
      return null
    }
  }
}
