/**
 * useReclaimFees — batch fee quote for pending send tokens.
 *
 * Calls `payment.quoteReclaim` for each transactionId in parallel.
 * Fees are fetched after mount; cards render with undefined fee until quotes return.
 */

import { useContext, useEffect, useState } from 'react'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { toNumber } from '@/core/domain/amount'

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
    setIsLoading(true)

    Promise.all(
      transactionIds.map(async (id) => {
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
        const next = new Map<string, number>()
        for (const entry of results) {
          if (entry) next.set(entry[0], entry[1])
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
