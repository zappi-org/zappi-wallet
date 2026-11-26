import { useCallback, useContext } from 'react'
import { useAppStore } from '@/store'
import { selectPendingOnchainPayouts } from '@/store/selectors'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { Err } from '@/core/domain/result'
import { OnchainPayoutUnavailableError } from '@/core/errors/onchain-payout'
import type {
  OnchainPayoutOffer,
  OnchainPayoutQuoteView,
  OnchainPayoutView,
} from '@/core/ports/driving/onchain-payout.usecase'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

export interface UseOnchainPayout {
  isEnabled: boolean
  payouts: OnchainPayoutView[]
  inFlightByMint: Record<string, number>
  listOffers(): Promise<Result<OnchainPayoutOffer[], BaseError>>
  quote(params: {
    offerId: string
    sendAmount: number
    destination: string
    mintUrl: string
  }): Promise<Result<OnchainPayoutQuoteView, BaseError>>
  start(params: {
    quoteId: string
    mintUrl: string
  }): Promise<Result<OnchainPayoutView, BaseError>>
  get(id: string): Promise<OnchainPayoutView | null>
}

export function useOnchainPayout(): UseOnchainPayout {
  const registry = useContext(ServiceContext)
  const payouts = useAppStore(selectPendingOnchainPayouts)
  const inFlightByMint = useAppStore((state) => state.onchainPayoutInFlightByMint ?? {})
  const service = registry?.onchainPayout ?? null

  const listOffers = useCallback(async () => {
    if (!service) {
      return Err(new OnchainPayoutUnavailableError('on-chain payout is unavailable'))
    }
    return service.listOffers()
  }, [service])

  const quote = useCallback(
    async (params: { offerId: string; sendAmount: number; destination: string; mintUrl: string }) => {
      if (!service) {
        return Err(new OnchainPayoutUnavailableError('on-chain payout is unavailable'))
      }
      return service.quote(params)
    },
    [service],
  )

  const start = useCallback(
    async (params: { quoteId: string; mintUrl: string }) => {
      if (!service) {
        return Err(new OnchainPayoutUnavailableError('on-chain payout is unavailable'))
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
