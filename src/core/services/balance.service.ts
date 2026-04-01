/**
 * BalanceService — BalanceUseCase 구현
 *
 * 모든 WalletModule의 잔액을 집계하는 application service.
 * 의존성: WalletModule[] (port interface만)
 */

import type { Amount } from '@/core/domain/amount'
import { sat, add } from '@/core/domain/amount'
import type { BalanceUseCase } from '@/core/ports/driving/balance.usecase'
import type { WalletModule, ModuleBalance } from '@/core/ports/driven/wallet-module.port'

export class BalanceService implements BalanceUseCase {
  constructor(private modules: WalletModule[]) {}

  async getTotal(): Promise<Amount> {
    const balances = await this.getByModule()
    return balances.reduce((sum, b) => add(sum, b.total), sat(0))
  }

  async getByModule(): Promise<ModuleBalance[]> {
    const enabled = this.modules.filter(m => m.isEnabled())
    return Promise.all(enabled.map(m => m.getBalance()))
  }
}
