import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { RecoveredTokenReceiver } from '@/core/ports/driven/recovered-token-receiver.port'

export class PaymentRecoveredTokenReceiver implements RecoveredTokenReceiver {
  constructor(private readonly payment: PaymentUseCase) {}

  async receiveRecoveredToken(token: string) {
    const result = await this.payment.redeem({ input: token })
    if (!result.ok) {
      return { success: false as const, error: result.error.message }
    }
    return { success: true as const, amount: result.value.amount }
  }
}
