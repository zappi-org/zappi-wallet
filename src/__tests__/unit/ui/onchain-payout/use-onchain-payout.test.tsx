import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Ok } from '@/core/domain/result'
import { useOnchainPayout } from '@/ui/hooks/use-onchain-payout'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { OnchainPayoutUseCase } from '@/core/ports/driving/onchain-payout.usecase'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function createWrapper(service: OnchainPayoutUseCase) {
  const registry = { onchainPayout: service } as unknown as ServiceRegistry
  return ({ children }: { children: ReactNode }) => (
    <ServiceContext.Provider value={registry}>{children}</ServiceContext.Provider>
  )
}

describe('useOnchainPayout', () => {
  it('exposes the driving port without adapter imports', async () => {
    const quote = vi.fn(async () => Ok({}))
    const start = vi.fn(async () => Ok({}))
    const listOffers = vi.fn(async () => Ok([]))
    const service = {
      isEnabled: () => true,
      listOffers,
      quote,
      start,
      get: vi.fn(async () => null),
    } as unknown as OnchainPayoutUseCase

    const { result } = renderHook(() => useOnchainPayout(), {
      wrapper: createWrapper(service),
    })

    expect(result.current.isEnabled).toBe(true)
    await result.current.listOffers()
    expect(listOffers).toHaveBeenCalled()
    await result.current.quote({
      offerId: 'offer-1',
      sendAmount: 100000,
      destination: 'bcrt1qdestination',
      mintUrl: 'https://mint.example.com',
    })
    expect(quote).toHaveBeenCalledWith(expect.objectContaining({ offerId: 'offer-1' }))
  })

  it('is disabled without a registry', async () => {
    const { result } = renderHook(() => useOnchainPayout())
    expect(result.current.isEnabled).toBe(false)
    const offers = await result.current.listOffers()
    expect(offers.ok).toBe(false)
  })
})
