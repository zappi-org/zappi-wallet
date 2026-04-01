import { describe, it, expect, vi } from 'vitest'
import { BalanceService } from '@/core/services/balance.service'
import type { WalletModule, ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import { sat, toNumber } from '@/core/domain/amount'

function createMockModule(overrides?: Partial<WalletModule>): WalletModule {
  return {
    id: 'test',
    displayName: 'Test',
    initialize: vi.fn(),
    dispose: vi.fn(),
    isEnabled: vi.fn().mockReturnValue(true),
    getPaymentAdapters: vi.fn().mockReturnValue([]),
    getCapabilities: vi.fn().mockReturnValue([]),
    getBalance: vi.fn().mockResolvedValue({
      moduleId: 'test',
      accounts: [{ id: 'acc-1', label: 'Acc 1', amount: sat(1000) }],
      total: sat(1000),
    } satisfies ModuleBalance),
    on: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  }
}

describe('BalanceService', () => {
  let service: BalanceService

  describe('getByModule', () => {
    it('returns balances from enabled modules only', async () => {
      const enabled = createMockModule({ id: 'cashu' })
      const disabled = createMockModule({
        id: 'fedi',
        isEnabled: vi.fn().mockReturnValue(false),
      })

      service = new BalanceService([enabled, disabled])
      const result = await service.getByModule()

      expect(result).toHaveLength(1)
      expect(result[0].moduleId).toBe('test')
      expect(disabled.getBalance).not.toHaveBeenCalled()
    })

    it('returns empty when no modules enabled', async () => {
      const disabled = createMockModule({ isEnabled: vi.fn().mockReturnValue(false) })
      service = new BalanceService([disabled])

      const result = await service.getByModule()
      expect(result).toHaveLength(0)
    })

    it('returns multiple module balances', async () => {
      const mod1 = createMockModule({
        getBalance: vi.fn().mockResolvedValue({
          moduleId: 'cashu', accounts: [], total: sat(5000),
        }),
      })
      const mod2 = createMockModule({
        getBalance: vi.fn().mockResolvedValue({
          moduleId: 'fedi', accounts: [], total: sat(3000),
        }),
      })

      service = new BalanceService([mod1, mod2])
      const result = await service.getByModule()

      expect(result).toHaveLength(2)
    })
  })

  describe('getTotal', () => {
    it('sums all module totals', async () => {
      const mod1 = createMockModule({
        getBalance: vi.fn().mockResolvedValue({
          moduleId: 'a', accounts: [], total: sat(5000),
        }),
      })
      const mod2 = createMockModule({
        getBalance: vi.fn().mockResolvedValue({
          moduleId: 'b', accounts: [], total: sat(3000),
        }),
      })

      service = new BalanceService([mod1, mod2])
      const total = await service.getTotal()

      expect(toNumber(total)).toBe(8000)
    })

    it('returns zero when no modules', async () => {
      service = new BalanceService([])
      const total = await service.getTotal()

      expect(toNumber(total)).toBe(0)
    })

    it('returns zero when all modules disabled', async () => {
      const disabled = createMockModule({ isEnabled: vi.fn().mockReturnValue(false) })
      service = new BalanceService([disabled])

      const total = await service.getTotal()
      expect(toNumber(total)).toBe(0)
    })

    it('propagates module error', async () => {
      const broken = createMockModule({
        getBalance: vi.fn().mockRejectedValue(new Error('offline')),
      })
      service = new BalanceService([broken])

      await expect(service.getTotal()).rejects.toThrow('offline')
    })
  })
})
