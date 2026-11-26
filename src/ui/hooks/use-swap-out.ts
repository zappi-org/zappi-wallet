import { useCallback, useContext } from 'react'
import { useAppStore } from '@/store'
import { selectPendingSwapOuts } from '@/store/selectors'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { Err } from '@/core/domain/result'
import { SwapOutUnavailableError } from '@/core/errors/swap-out'
import type {
  SwapOutOffer,
  SwapOutQuoteView,
  SwapOutView,
} from '@/core/ports/driving/swap-out.usecase'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

export interface UseSwapOut {
  isEnabled: boolean
  payouts: SwapOutView[]
  inFlightByMint: Record<string, number>
  listOffers(): Promise<Result<SwapOutOffer[], BaseError>>
  quote(params: {
    offerId: string
    sendAmount: number
    destination: string
    mintUrl: string
  }): Promise<Result<SwapOutQuoteView, BaseError>>
  start(params: {
    quoteId: string
    mintUrl: string
  }): Promise<Result<SwapOutView, BaseError>>
  get(id: string): Promise<SwapOutView | null>
}

export function useSwapOut(): UseSwapOut {
  const registry = useContext(ServiceContext)
  const payouts = useAppStore(selectPendingSwapOuts)
  const inFlightByMint = useAppStore((state) => state.swapOutInFlightByMint ?? {})
  const service = registry?.swapOut ?? null

  const listOffers = useCallback(async () => {
    if (!service) {
      return Err(new SwapOutUnavailableError('on-chain payout is unavailable'))
    }
    return service.listOffers()
  }, [service])

  const quote = useCallback(
    async (params: { offerId: string; sendAmount: number; destination: string; mintUrl: string }) => {
      if (!service) {
        return Err(new SwapOutUnavailableError('on-chain payout is unavailable'))
      }
      return service.quote(params)
    },
    [service],
  )

  const start = useCallback(
    async (params: { quoteId: string; mintUrl: string }) => {
      if (!service) {
        return Err(new SwapOutUnavailableError('on-chain payout is unavailable'))
      }
      return service.start(params)
    },
    [service],
  )

  const get = useCallback(
    async (id: string) => (service ? service.get(id) : null),
    [service],
  )

  return {
    isEnabled: service?.isEnabled() ?? false,
    payouts,
    inFlightByMint,
    listOffers,
    quote,
    start,
    get,
  }
}
