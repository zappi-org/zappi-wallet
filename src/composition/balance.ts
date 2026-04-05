/**
 * Composition root for BalanceUseCase
 */

import { BalanceService } from '@/core/services/balance.service'
import type { BalanceUseCase } from '@/core/ports/driving/balance.usecase'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'

export function createBalanceService(
  modules: WalletModule[],
): BalanceUseCase {
  return new BalanceService(modules)
}
