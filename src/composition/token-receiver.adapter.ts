import type { TokenReceiver, TokenReceiveResult, TokenReceiveError } from '@/core/ports/driven/token-receiver.port'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import { toNumber } from '@/core/domain/amount'

/**
 * TokenReceiverAdapter — PaymentUseCase.redeem()을 TokenReceiver port로 래핑.
 * 생성자 주입으로 composition root에서 PaymentUseCase 제공.
 */
export class TokenReceiverAdapter implements TokenReceiver {
  constructor(private payment: PaymentUseCase) {}

  async receiveToken(token: string): Promise<
    { ok: true; value: TokenReceiveResult } |
    { ok: false; error: TokenReceiveError }
  > {
    const result = await this.payment.redeem({ input: token })

    if (result.ok) {
      return {
        ok: true,
        value: {
          amount: toNumber(result.value.amount),
          transactionId: result.value.requestId,
        },
      }
    }

    return {
      ok: false,
      error: {
        code: result.error.code ?? 'UNKNOWN',
        message: result.error.message ?? 'Unknown error',
        isRetryable: false,
      },
    }
  }
}
