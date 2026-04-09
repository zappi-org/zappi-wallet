import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import { Ok, Err } from '@/core/domain/result'
import type { Result } from '@/core/domain/result'
import type { PaymentError } from '@/core/errors/payment.errors'
import { sat } from '@/core/domain/amount'
import type {
  WithdrawUseCase,
  WithdrawInfo,
  WithdrawResult,
} from '@/core/ports/driving/withdraw.usecase'

export class WithdrawService implements WithdrawUseCase {
  constructor(
    private readonly lnurl: Required<Pick<LnurlGateway, 'parseWithdraw' | 'executeWithdraw'>>,
    private readonly payment: PaymentMethodAdapter,
  ) {}

  async parseWithdrawUrl(url: string): Promise<Result<WithdrawInfo, PaymentError>> {
    try {
      const params = await this.lnurl.parseWithdraw(url)
      return Ok({
        domain: new URL(params.callback).hostname,
        minSats: params.minWithdrawable / 1000,
        maxSats: params.maxWithdrawable / 1000,
        description: params.defaultDescription,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse withdraw URL'
      return Err({ code: 'LNURL_PARSE_FAILED', message })
    }
  }

  async executeWithdraw(params: {
    url: string
    amountSats: number
    accountId: string
  }): Promise<Result<WithdrawResult, PaymentError>> {
    try {
      // 1. Parse withdraw URL
      const withdrawParams = await this.lnurl.parseWithdraw(params.url)

      // 2. Create Lightning invoice via mint
      const req = await this.payment.createReceiveRequest({
        amount: sat(params.amountSats),
        accountId: params.accountId,
        protocol: 'bolt11',
      })

      // 3. Submit invoice to withdraw service
      const result = await this.lnurl.executeWithdraw(withdrawParams, req.encoded)
      if (result.status === 'ERROR') {
        return Err({ code: 'WITHDRAW_FAILED', message: result.reason || 'LNURL-withdraw failed' })
      }

      // 4. Wait for payment completion
      if (!this.payment.onReceiveCompleted) {
        return Err({ code: 'ADAPTER_NOT_FOUND', message: 'Payment adapter does not support receive completion' })
      }

      return new Promise((resolve) => {
        const unsubscribe = this.payment.onReceiveCompleted!(req.id, (completed) => {
          unsubscribe()
          resolve(Ok({
            amount: completed.amount,
            completedAt: completed.completedAt,
          }))
        })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Withdraw failed'
      return Err({ code: 'WITHDRAW_FAILED', message })
    }
  }
}
