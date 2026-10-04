import type { MostroMarket } from '@/core/ports/driven/mostro-market.port'

/**
 * MostroUseCase — the UI-facing marketplace contract.
 *
 * Same shape as the driven port; kept as its own type so the UI depends only
 * on core/ports/driving.
 */
export type MostroUseCase = MostroMarket
