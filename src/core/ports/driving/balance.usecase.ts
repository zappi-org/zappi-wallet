import type { Amount } from '@/core/domain/amount'
import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'

export interface BalanceUseCase {
  getTotal(): Promise<Amount>
  getByModule(): Promise<ModuleBalance[]>
}
