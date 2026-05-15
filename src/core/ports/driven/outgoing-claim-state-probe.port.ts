import type { OutgoingClaimCheckResult } from '@/core/domain/outgoing-ecash-lifecycle'

export interface OutgoingClaimStateProbe {
  checkClaimState(params: {
    token?: string
    operationId?: string
  }): Promise<OutgoingClaimCheckResult>
}
