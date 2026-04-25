import { describe, it, expect, beforeEach } from 'vitest'
import { LocalStorageBalanceCache } from '@/adapters/cache/local-storage-balance-cache.adapter'
import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import { sat } from '@/core/domain/amount'

function createTestBalances(): ModuleBalance[] {
  return [
    {
      moduleId: 'cashu',
      accounts: [
        { id: 'https://mint1.example.com', label: 'https://mint1.example.com', amount: sat(5000) },
        { id: 'https://mint2.example.com', label: 'https://mint2.example.com', amount: sat(3000) },
      ],
      total: sat(8000),
    },
  ]
}

describe('LocalStorageBalanceCache', () => {
  let cache: LocalStorageBalanceCache

  beforeEach(() => {
    localStorage.clear()
    cache = new LocalStorageBalanceCache()
  })

  it('round-trips ModuleBalance[] with bigint Amount', () => {
    cache.save(createTestBalances())
    const restored = cache.load()

    expect(restored).not.toBeNull()
    expect(restored).toHaveLength(1)
    expect(restored![0].moduleId).toBe('cashu')
    expect(restored![0].accounts).toHaveLength(2)
    expect(restored![0].accounts[0].amount.value).toBe(5000n)
    expect(restored![0].accounts[0].amount.unit).toBe('sat')
    expect(restored![0].accounts[1].amount.value).toBe(3000n)
    expect(restored![0].total.value).toBe(8000n)
    expect(restored![0].total.unit).toBe('sat')
  })

  it('returns null when no cache exists', () => {
    expect(cache.load()).toBeNull()
  })

  it('returns null on corrupt data', () => {
    localStorage.setItem('zappi-balance-cache', '{invalid json')
    expect(cache.load()).toBeNull()
  })

  it('clears cache', () => {
    cache.save(createTestBalances())
    expect(cache.load()).not.toBeNull()

    cache.clear()
    expect(cache.load()).toBeNull()
  })

  it('handles zero balance', () => {
    const balances: ModuleBalance[] = [
      { moduleId: 'cashu', accounts: [], total: sat(0) },
    ]
    cache.save(balances)
    const restored = cache.load()

    expect(restored).not.toBeNull()
    expect(restored![0].total.value).toBe(0n)
    expect(restored![0].accounts).toHaveLength(0)
  })

  it('handles multiple modules', () => {
    const balances: ModuleBalance[] = [
      {
        moduleId: 'cashu',
        accounts: [{ id: 'mint-a', label: 'Mint A', amount: sat(1000) }],
        total: sat(1000),
      },
      {
        moduleId: 'fedi',
        accounts: [{ id: 'fed-1', label: 'Fed 1', amount: sat(2000) }],
        total: sat(2000),
      },
    ]
    cache.save(balances)
    const restored = cache.load()

    expect(restored).toHaveLength(2)
    expect(restored![0].moduleId).toBe('cashu')
    expect(restored![1].moduleId).toBe('fedi')
    expect(restored![1].total.value).toBe(2000n)
  })
})
