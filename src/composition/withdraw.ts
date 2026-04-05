/**
 * Composition root for WithdrawUseCase
 *
 * adapter map은 bootstrap에서 주입 — composition이 modules/를 직접 import하면 안 됨.
 */

import { WithdrawService } from '@/core/services/withdraw.service'
import { DirectLnurlAdapter } from '@/adapters/lnurl/direct-lnurl.adapter'
import type { WithdrawUseCase } from '@/core/ports/driving/withdraw.usecase'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'

export function createWithdrawService(
  paymentAdapter: PaymentMethodAdapter,
): WithdrawUseCase {
  const lnurlAdapter = new DirectLnurlAdapter()
  return new WithdrawService(lnurlAdapter, paymentAdapter)
}
