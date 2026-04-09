import { describe, it, expect, vi } from 'vitest'
import { RoutingService } from '@/core/services/routing.service'
import { PaymentRoute } from '@/core/domain/routing'
import type { FeeEstimator } from '@/core/ports/driven/fee-estimator.port'

function createMockFeeEstimator(): FeeEstimator {
  return {
    estimateRouteFee: vi.fn().mockResolvedValue({ fee: 10, totalNeeded: 1010 }),
    estimateMyWalletFee: vi.fn().mockResolvedValue({ fee: 5, totalNeeded: 1005 }),
  }
}

describe('RoutingService', () => {
  it('should delegate selectRoute to domain function', () => {
    const fe = createMockFeeEstimator()
    const svc = new RoutingService(fe)
    const route = svc.selectRoute({
      validatedData: { type: 'bolt11', invoice: 'lnbc1', amountSats: 1000, expiry: 9999 },
      senderMints: { 'https://mint.test': 5000 },
      amount: 1000,
      privacyMode: false,
    })
    expect(route).toBe(PaymentRoute.MELT_TO_LN)
  })

  it('should delegate findCommonMints to domain function', () => {
    const fe = createMockFeeEstimator()
    const svc = new RoutingService(fe)
    const common = svc.findCommonMints(['https://a.test', 'https://b.test'], ['https://b.test', 'https://c.test'])
    expect(common).toEqual(['https://b.test'])
  })

  it('should delegate estimateRouteFee to fee estimator', async () => {
    const fe = createMockFeeEstimator()
    const svc = new RoutingService(fe)
    const result = await svc.estimateRouteFee(PaymentRoute.MELT_TO_LN, 'https://mint', 1000)
    expect(result).toEqual({ fee: 10, totalNeeded: 1010 })
    expect(fe.estimateRouteFee).toHaveBeenCalledWith(PaymentRoute.MELT_TO_LN, 'https://mint', 1000, undefined, undefined)
  })

  it('should delegate estimateMyWalletFee to fee estimator', async () => {
    const fe = createMockFeeEstimator()
    const svc = new RoutingService(fe)
    const result = await svc.estimateMyWalletFee('https://source', 'https://target', 1000)
    expect(result).toEqual({ fee: 5, totalNeeded: 1005 })
  })
})
