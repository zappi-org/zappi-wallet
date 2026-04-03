import type { TokenReceiver, TokenReceiveResult, TokenReceiveError } from '@/core/ports/driven/token-receiver.port'
import { PaymentService } from '@/services/payment/payment.service'

/**
 * TokenReceiverAdapter — old PaymentService.receiveEcash()를 TokenReceiver port로 래핑.
 * PaymentService가 core use case로 전환되면 이 adapter도 교체.
 */
export class TokenReceiverAdapter implements TokenReceiver {
  private payment = new PaymentService()

  async receiveToken(token: string): Promise<
    { ok: true; value: TokenReceiveResult } |
    { ok: false; error: TokenReceiveError }
  > {
    const result = await this.payment.receiveEcash(token)

    if (result.isOk()) {
      return {
        ok: true,
        value: {
          amount: result.value.amount,
          transactionId: result.value.transactionId,
        },
      }
    }

    const err = result.error as { code?: string; message?: string; isRetryable?: boolean }
    return {
      ok: false,
      error: {
        code: err.code ?? 'UNKNOWN',
        message: err.message ?? String(result.error),
        isRetryable: err.isRetryable ?? false,
      },
    }
  }
}
