import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PendingItemDetailScreen } from '@/ui/screens/MintDetail/PendingItemDetailScreen'
import { ServiceProvider } from '@/ui/hooks/service-context'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import type { ReactNode } from 'react'

const addToast = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { addToast: typeof addToast }) => unknown) => selector({ addToast }),
}))

vi.mock('@/ui/hooks', () => ({
  useMintMetadata: () => ({ getDisplayName: () => 'Mint' }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount}`,
  useFormatFiat: () => () => null,
  getLocaleCode: () => 'en-US',
}))

vi.mock('@/ui/components/common/QRCodeDisplay', () => ({
  QRCodeDisplay: () => null,
}))

function createMockRegistry(): ServiceRegistry {
  return {
    eventBus: {
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
      off: vi.fn(),
    },
    payment: {} as ServiceRegistry['payment'],
    balance: {} as ServiceRegistry['balance'],
    swap: {} as ServiceRegistry['swap'],
    contact: {} as ServiceRegistry['contact'],
    inputRouter: {} as ServiceRegistry['inputRouter'],
    addressResolver: {} as ServiceRegistry['addressResolver'],
    profile: {} as ServiceRegistry['profile'],
    recovery: {} as ServiceRegistry['recovery'],
    reclaim: {} as ServiceRegistry['reclaim'],
    incomingPayment: {} as ServiceRegistry['incomingPayment'],
    processedStore: {} as ServiceRegistry['processedStore'],
    nostrGateway: {} as ServiceRegistry['nostrGateway'],
    pendingItems: {
      getByMint: vi.fn(),
      getAll: vi.fn(),
      getActivePendingQuotes: vi.fn(),
      checkEffectiveExpiry: vi.fn().mockResolvedValue('expired'),
      expireById: vi.fn().mockResolvedValue(undefined),
    } as ServiceRegistry['pendingItems'],
    withdraw: {} as ServiceRegistry['withdraw'],
    lnurlAuth: {} as ServiceRegistry['lnurlAuth'],
    mintMetadata: {} as ServiceRegistry['mintMetadata'],
    mintHealth: {} as ServiceRegistry['mintHealth'],
    crypto: {} as ServiceRegistry['crypto'],
    receiveRequest: {} as ServiceRegistry['receiveRequest'],
    transactionMgmt: {} as ServiceRegistry['transactionMgmt'],
    inputParser: {} as ServiceRegistry['inputParser'],
    paymentRequest: {} as ServiceRegistry['paymentRequest'],
    routing: {} as ServiceRegistry['routing'],
    username: {} as ServiceRegistry['username'],
    trustRegistry: {} as ServiceRegistry['trustRegistry'],
    support: {} as ServiceRegistry['support'],
    nostrDirectPayment: {} as ServiceRegistry['nostrDirectPayment'],
    externalWalletRecovery: {} as ServiceRegistry['externalWalletRecovery'],
    transferLifecycle: {} as ServiceRegistry['transferLifecycle'],
  }
}

describe('PendingItemDetailScreen expiry cleanup', () => {
  it('auto-removes expired pending requests on mount', async () => {
    const registry = createMockRegistry()
    const onBack = vi.fn()
    const onItemRemoved = vi.fn()

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServiceProvider registry={registry}>{children}</ServiceProvider>
    )

    render(
      <PendingItemDetailScreen
        item={{
          id: 'receive-request-1',
          direction: 'receive',
          kind: 'request',
          amount: 1000,
          accountId: 'https://mint.test',
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          details: {
            quoteId: 'quote-1',
            invoice: 'lnbc1000n1...',
          },
        }}
        onBack={onBack}
        onItemRemoved={onItemRemoved}
      />,
      { wrapper },
    )

    await waitFor(() => {
      expect(registry.pendingItems.checkEffectiveExpiry).toHaveBeenCalledWith('receive-request-1')
      expect(registry.pendingItems.expireById).toHaveBeenCalledWith('receive-request-1')
      expect(onItemRemoved).toHaveBeenCalled()
      expect(onBack).toHaveBeenCalled()
      expect(addToast).toHaveBeenCalledWith({
        type: 'info',
        message: 'pending.expiredRemoved',
        duration: 2500,
      })
    })
  })
})
