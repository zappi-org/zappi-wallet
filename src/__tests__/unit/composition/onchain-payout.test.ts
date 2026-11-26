import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from '@/core/events/event-bus'
import { OnchainPayoutUnavailableError } from '@/core/errors/onchain-payout'
import { createOnchainPayout } from '@/composition/onchain-payout'
import type { OnchainPayoutConfig } from '@/composition/onchain-payout-config'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'

function disabledConfig(patch: Partial<OnchainPayoutConfig> = {}): OnchainPayoutConfig {
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

describe('createOnchainPayout', () => {
  it('returns a disabled service that never reaches the provider', async () => {
    const bundle = createOnchainPayout({
      config: disabledConfig(),
      routePaymentOperator: payments,
      eventBus: createEventBus(),
    })
    try {
      expect(bundle.service.isEnabled()).toBe(false)
      const quote = await bundle.service.quote({
        sendAmount: 100000,
        destination: 'bcrt1qdestination',
        mintUrl: 'https://mint.example.com',
      })
      expect(quote.ok).toBe(false)
      expect(!quote.ok && quote.error).toBeInstanceOf(OnchainPayoutUnavailableError)
      expect(await bundle.service.listActive()).toEqual([])
    } finally {
      bundle.dispose()
      await bundle.store.wipe()
    }
  })
})
