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

  // ─── 견적 캐시 (설계 §8.4 — TTL 60s + in-flight 공유 + 실패 5s 쿨다운) ───

  describe('estimate cache', () => {
    it('same (route,src,tgt,amount) tuple within TTL hits the cache — estimator once', async () => {
      const fe = createMockFeeEstimator()
      const svc = new RoutingService(fe)

      const first = await svc.estimateRouteFee(PaymentRoute.LN_CROSS_MINT, 'https://src', 1000, 'https://tgt')
      const second = await svc.estimateRouteFee(PaymentRoute.LN_CROSS_MINT, 'https://src', 1000, 'https://tgt')

      expect(fe.estimateRouteFee).toHaveBeenCalledTimes(1)
      expect(second).toEqual(first)
    })

    it('amount/invoice change misses the cache — 금액 편집은 매번 원 왕복 [N4]', async () => {
      const fe = createMockFeeEstimator()
      const svc = new RoutingService(fe)

      await svc.estimateRouteFee(PaymentRoute.MELT_TO_LN, 'https://src', 1000, undefined, 'lnbc-a')
      await svc.estimateRouteFee(PaymentRoute.MELT_TO_LN, 'https://src', 2000, undefined, 'lnbc-a')
      await svc.estimateRouteFee(PaymentRoute.MELT_TO_LN, 'https://src', 1000, undefined, 'lnbc-b')

      expect(fe.estimateRouteFee).toHaveBeenCalledTimes(3)
    })

    it('concurrent identical estimates share one in-flight call', async () => {
      const fe = createMockFeeEstimator()
      let resolveEstimate!: (v: { fee: number; totalNeeded: number }) => void
      vi.mocked(fe.estimateRouteFee).mockImplementation(
        () => new Promise((resolve) => { resolveEstimate = resolve }),
      )
      const svc = new RoutingService(fe)

      const a = svc.estimateRouteFee(PaymentRoute.MELT_TO_LN, 'https://src', 1000)
      const b = svc.estimateRouteFee(PaymentRoute.MELT_TO_LN, 'https://src', 1000)
      resolveEstimate({ fee: 7, totalNeeded: 1007 })

      const [ra, rb] = await Promise.all([a, b])
      expect(fe.estimateRouteFee).toHaveBeenCalledTimes(1)
      expect(ra).toEqual(rb)
    })

    it('failure is re-thrown from a 5s cooldown, then retried after it expires', async () => {
      vi.useFakeTimers()
      try {
        const fe = createMockFeeEstimator()
        vi.mocked(fe.estimateRouteFee)
          .mockRejectedValueOnce(new Error('mint down'))
          .mockResolvedValueOnce({ fee: 3, totalNeeded: 1003 })
        const svc = new RoutingService(fe)

        await expect(
          svc.estimateRouteFee(PaymentRoute.MELT_TO_LN, 'https://src', 1000),
        ).rejects.toThrow('mint down')

        // 쿨다운 내 재시도 — 같은 rejection, estimator 재호출 없음
        await expect(
          svc.estimateRouteFee(PaymentRoute.MELT_TO_LN, 'https://src', 1000),
        ).rejects.toThrow('mint down')
        expect(fe.estimateRouteFee).toHaveBeenCalledTimes(1)

        // 쿨다운(5s) 경과 후 실제 재견적
        await vi.advanceTimersByTimeAsync(5_001)
        await expect(
          svc.estimateRouteFee(PaymentRoute.MELT_TO_LN, 'https://src', 1000),
        ).resolves.toEqual({ fee: 3, totalNeeded: 1003 })
        expect(fe.estimateRouteFee).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
