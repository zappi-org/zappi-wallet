import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from '@/core/events/event-bus'
import { SwapOutUnavailableError } from '@/core/errors/swap-out'
import { createSwapOut } from '@/composition/swap-out'
import type { SwapOutConfig } from '@/composition/swap-out-config'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'

function disabledConfig(patch: Partial<SwapOutConfig> = {}): SwapOutConfig {
  return {
    enabled: false,
    network: 'regtest',
    chainApiUrl: null,
    relays: null,
    minAmount: 20000,
    maxAmount: 1000000,
    pollIntervalMs: 30000,
    powTargetBits: 30,
    ...patch,
  }
}

const payments = {
  prepareMelt: vi.fn(),
  executeMelt: vi.fn(),
  rollbackMelt: vi.fn(),
  refreshMelt: vi.fn(),
  heldAmounts: vi.fn().mockResolvedValue({}),
  checkMeltSettlement: vi.fn().mockResolvedValue({ state: 'pending' }),
} as unknown as Pick<
  RoutePaymentOperator,
  | 'prepareMelt'
  | 'executeMelt'
  | 'rollbackMelt'
  | 'refreshMelt'
  | 'checkMeltSettlement'
  | 'heldAmounts'
>

describe('createSwapOut', () => {
  it('returns a disabled service that never reaches the provider', async () => {
    const bundle = createSwapOut({
      config: disabledConfig(),
      routePaymentOperator: payments,
      eventBus: createEventBus(),
    })
    try {
      expect(bundle.service.isEnabled()).toBe(false)
      const quote = await bundle.service.quote({
        offerId: 'offer-1',
        sendAmount: 100000,
        destination: 'bcrt1qdestination',
        mintUrl: 'https://mint.example.com',
      })
      expect(quote.ok).toBe(false)
      expect(!quote.ok && quote.error).toBeInstanceOf(SwapOutUnavailableError)
      const offers = await bundle.service.listOffers()
      expect(offers.ok).toBe(false)
      expect(!offers.ok && offers.error).toBeInstanceOf(SwapOutUnavailableError)
      expect(await bundle.service.listActive()).toEqual([])
    } finally {
      bundle.dispose()
      await bundle.store.wipe()
    }
  })
})
