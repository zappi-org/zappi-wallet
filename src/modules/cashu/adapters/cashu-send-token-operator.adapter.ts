import type { SendTokenOperator } from '@/core/ports/driven/send-token-operator.port'
import { finalizeSend, rollbackSend } from '../internal/cashu-backend'

export class CashuSendTokenOperatorAdapter implements SendTokenOperator {
  async rollbackSendToken(operationId: string): Promise<void> {
    await rollbackSend(operationId)
  }

  async finalizeSend(operationId: string): Promise<void> {
    await finalizeSend(operationId)
  }
}
