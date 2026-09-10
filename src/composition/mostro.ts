import {
  DisabledMostroMarket,
  MostroClientAdapter,
  createMostroStore,
  readMostroConfig,
} from '@/adapters/mostro'
import { MostroService } from '@/core/services/mostro.service'
import type { MostroUseCase } from '@/core/ports/driving/mostro.usecase'

export interface CreateMostroServiceDeps {
  /** BIP-39 seed — derives the Mostro identity/trade keys and the store key. */
  seed: Uint8Array
}

/**
 * Composition root for the Mostro marketplace.
 *
 * No instance configured (or invalid config) → disabled fallback so the
 * ServiceRegistry always has a `mostro` entry.
 */
export function createMostroService(deps: CreateMostroServiceDeps): MostroUseCase {
  const config = readMostroConfig()
  if (!config.ok) {
    return new MostroService(new DisabledMostroMarket(config.reason))
  }

  return new MostroService(
    new MostroClientAdapter({
      seed: deps.seed,
      mostroPubkeyHex: config.value.mostroPubkeyHex,
      relays: config.value.relays,
      store: createMostroStore(deps.seed),
    }),
  )
}
