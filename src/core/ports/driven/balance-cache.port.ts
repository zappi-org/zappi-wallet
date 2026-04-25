import type { ModuleBalance } from './wallet-module.port'

export interface BalanceCache {
  save(balances: ModuleBalance[]): void
  load(): ModuleBalance[] | null
  clear(): void
}
