import { useCallback, useContext } from 'react'
import { useAppStore } from '@/store'
import { selectPendingOnchainPayouts } from '@/store/selectors'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { Err } from '@/core/domain/result'
import { OnchainPayoutUnavailableError } from '@/core/errors/onchain-payout'
import type {
  OnchainPayoutQuoteView,
  OnchainPayoutView,
} from '@/core/ports/driving/onchain-payout.usecase'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

export interface UseOnchainPayout {
  isEnabled: boolean
  payouts: OnchainPayoutView[]
  inFlightByMint: Record<string, number>
  quote(params: {
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

  const quote = useCallback(
    async (params: { sendAmount: number; destination: string; mintUrl: string }) => {
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
    quote,
    start,
    get,
  }
}
