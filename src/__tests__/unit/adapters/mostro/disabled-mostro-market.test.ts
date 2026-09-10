import { describe, it, expect } from 'vitest'
import { DisabledMostroMarket } from '@/adapters/mostro'

describe('DisabledMostroMarket', () => {
  it('reports unavailable with the given reason', () => {
    const market = new DisabledMostroMarket('not_configured')
    const snapshot = market.getSnapshot()
    expect(snapshot.availability).toEqual({ available: false, reason: 'not_configured' })
    expect(snapshot.orders).toEqual([])
    expect(snapshot.trades).toEqual({})
  })

  it('rejects every mutating action', async () => {
    const market = new DisabledMostroMarket()
    await expect(market.createOrder({ kind: 'sell', fiatAmount: 1, paymentMethod: 'x' })).rejects.toThrow(
      'not configured',
    )
    await expect(market.takeOrder({ orderId: 'o' })).rejects.toThrow('not configured')
    await expect(market.submitInvoice('o', 'lnbc')).rejects.toThrow('not configured')
    await expect(market.waitForOrderLive('o')).rejects.toThrow('not configured')
    await expect(market.sendTradeAction('o', 'release')).rejects.toThrow('not configured')
    await expect(market.cancelOrder('o')).rejects.toThrow('not configured')
    await expect(market.openDispute('o')).rejects.toThrow('not configured')
    await expect(market.rateUser('o', 5)).rejects.toThrow('not configured')
  })

  it('connect/restore/destroy are no-ops', async () => {
    const market = new DisabledMostroMarket()
    await expect(market.connect()).resolves.toBe(market.getSnapshot())
    await expect(market.restore()).resolves.toBeUndefined()
    await expect(market.destroy()).resolves.toBeUndefined()
  })

  it('emits the unavailable snapshot to new subscribers', () => {
    const market = new DisabledMostroMarket()
    let seen = 0
    const unsubscribe = market.subscribe({
      onSnapshot: (s) => {
        if (!s.availability.available) seen++
      },
    })
    expect(seen).toBe(1)
    unsubscribe()
  })
})
