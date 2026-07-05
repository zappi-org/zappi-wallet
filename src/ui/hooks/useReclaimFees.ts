/**
 * useReclaimFees — batch fee quote for pending send tokens.
 *
 * Calls `payment.quoteReclaim` for each transactionId in parallel.
 * Fees are fetched after mount; cards render with undefined fee until quotes return.
 *
 * 캐시 (설계 §8.4): txId 키 모듈 캐시 — 탭 방문마다 pending 토큰 N건 ×
 * (receive.prepare+cancel)을 재실행하던 것을, 이미 견적된 txId는 건너뛴다.
 * pending 토큰의 회수 수수료는 토큰이 고정이라 결정적이다 — keyset 회전 등
 * 드문 변동만 소프트 TTL(10분)로 흡수하고, 정산되어 목록에서 빠진 txId는
 * 재조회 자체가 없다.
 */

import { useContext, useEffect, useState } from 'react'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { toNumber } from '@/core/domain/amount'

const FEE_CACHE_TTL_MS = 10 * 60_000
const feeCache = new Map<string, { fee: number; at: number }>()

/** 테스트 전용 — 캐시 초기화 */
export function clearReclaimFeeCache(): void {
  feeCache.clear()
}

export function useReclaimFees(transactionIds: string[]) {
  const registry = useContext(ServiceContext)
  const [fees, setFees] = useState<Map<string, number>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const idsKey = transactionIds.join(',')

  useEffect(() => {
    const payment = registry?.payment
    if (!payment) return
    if (transactionIds.length === 0) {
      setFees(new Map())
      return
    }

    let cancelled = false
    const now = Date.now()
    const cached = new Map<string, number>()
    const toQuote: string[] = []
    for (const id of transactionIds) {
      const entry = feeCache.get(id)
      if (entry && now - entry.at < FEE_CACHE_TTL_MS) {
        cached.set(id, entry.fee)
      } else {
        toQuote.push(id)
      }
    }

    // 캐시 히트분은 즉시 반영 — 네트워크 0
    setFees(new Map(cached))
    if (toQuote.length === 0) return

    setIsLoading(true)

    Promise.all(
      toQuote.map(async (id) => {
        try {
          const result = await payment.quoteReclaim({ transactionId: id })
          if (result.ok) return [id, toNumber(result.value.fee)] as const
        } catch {
          /* adapter threw — fall through to skip */
        }
        return null
      }),
    )
      .then((results) => {
        if (cancelled) return
        const next = new Map(cached)
        for (const entry of results) {
          if (entry) {
            next.set(entry[0], entry[1])
            feeCache.set(entry[0], { fee: entry[1], at: Date.now() })
          }
        }
        setFees(next)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, registry])

  return { fees, isLoading }
}
