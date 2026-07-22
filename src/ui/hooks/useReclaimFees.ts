/**
 * useReclaimFees — batch fee quote for pending send tokens.
 *
 * Calls `payment.quoteReclaim` for each transactionId in parallel.
 * Fees are fetched after mount; cards render with undefined fee until quotes return.
 *
 * Cache: a txId-keyed module cache. Instead of re-running N pending tokens ×
 * (receive.prepare+cancel) on every tab visit, already-quoted txIds are skipped.
 * A pending token's reclaim fee is deterministic because the token is fixed — only
 * rare changes like keyset rotation need the soft TTL (10 min) to absorb them, and
 * txIds that settle out of the list are never re-queried.
 */

import { useCallback, useContext, useEffect, useState } from 'react'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { toNumber } from '@/core/domain/amount'

const FEE_CACHE_TTL_MS = 10 * 60_000
const feeCache = new Map<string, { fee: number; at: number }>()

/** Test-only — reset the cache */
export function clearReclaimFeeCache(): void {
  feeCache.clear()
}

export function useReclaimFees(transactionIds: string[]) {
  const registry = useContext(ServiceContext)
  const [fees, setFees] = useState<Map<string, number>>(new Map())
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  // A failed quote must not dead-end the reclaim UI — retry re-runs the effect
  // for every id the cache doesn't cover.
  const [retryNonce, setRetryNonce] = useState(0)
  const retry = useCallback(() => setRetryNonce((n) => n + 1), [])
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

    // Apply cache hits immediately — zero network
    setFees(new Map(cached))
    setFailedIds(new Set())
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
        const failed = new Set<string>()
        results.forEach((entry, i) => {
          if (entry) {
            next.set(entry[0], entry[1])
            feeCache.set(entry[0], { fee: entry[1], at: Date.now() })
          } else {
            failed.add(toQuote[i])
          }
        })
        setFees(next)
        setFailedIds(failed)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, registry, retryNonce])

  return { fees, isLoading, failedIds, retry }
}
