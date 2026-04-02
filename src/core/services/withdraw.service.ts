import type { LnurlGateway, LnurlWithdrawParams } from '@/core/ports/driven/lnurl-gateway.port'
import type {
  PaymentMethodAdapter,
  ReceiveCompletedResult,
} from '@/core/ports/driven/payment-method.port'
import { sat } from '@/core/domain/amount'

export interface WithdrawParams {
  withdraw: LnurlWithdrawParams
  minSats: number
  maxSats: number
  description: string
}

export class WithdrawService {
  constructor(
    private readonly lnurl: Required<Pick<LnurlGateway, 'parseWithdraw' | 'executeWithdraw'>>,
    private readonly payment: PaymentMethodAdapter,
  ) {}

  async parseWithdrawUrl(url: string): Promise<WithdrawParams> {
    const params = await this.lnurl.parseWithdraw(url)

    return {
      withdraw: params,
      minSats: params.minWithdrawable / 1000,
      maxSats: params.maxWithdrawable / 1000,
      description: params.defaultDescription,
    }
  }

  async executeWithdraw(
    params: LnurlWithdrawParams,
    amountSats: number,
    accountId: string,
  ): Promise<ReceiveCompletedResult> {
    const req = await this.payment.createReceiveRequest({
      amount: sat(amountSats),
      accountId,
      protocol: 'bolt11',
    })

    const result = await this.lnurl.executeWithdraw(params, req.encoded)
    if (result.status === 'ERROR') {
      throw new Error(result.reason || 'LNURL-withdraw failed')
    }

    return new Promise((resolve, reject) => {
      if (!this.payment.onReceiveCompleted) {
        reject(new Error('Payment adapter does not support receive completion events'))
        return
      }

      const unsubscribe = this.payment.onReceiveCompleted(req.id, (completed) => {
        unsubscribe()
        resolve(completed)
      })
    })
  }
}
