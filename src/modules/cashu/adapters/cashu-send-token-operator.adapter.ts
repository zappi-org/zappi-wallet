import type { ProofStateResult, SendTokenOperator, } from '@/core/ports/driven/send-token-operator.port';
import { checkProofStates, finalizeSend, rollbackSend } from '../internal/cashu-backend';
export class CashuSendTokenOperatorAdapter implements SendTokenOperator {
  
  async rollbackSendToken(operationId: string): Promise<void> {
    await rollbackSend(operationId)
  }

  async finalizeSend(operationId: string): Promise<void> {
    await finalizeSend(operationId)
  }

  //could be move to another port eg.CashuProofChecker
  async checkProofStates(token: string): Promise<ProofStateResult> {
    return checkProofStates(token)
  }
}
