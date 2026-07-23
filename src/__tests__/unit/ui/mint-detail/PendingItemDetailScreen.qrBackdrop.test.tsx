import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    eventBus: { emit: vi.fn(), on: vi.fn().mockReturnValue(() => {}), off: vi.fn() },
    mintInfo: { getInfo: vi.fn() } as unknown as ServiceRegistry['mintInfo'],
    recoveryScheduler: {} as unknown as ServiceRegistry['recoveryScheduler'],
    incomingReviewQueue: {} as unknown as ServiceRegistry['incomingReviewQueue'],
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
      // 'alive' — this test is about the QR-backdrop/back-button race, not expiry.
      checkEffectiveExpiry: vi.fn().mockResolvedValue('alive'),
      expireById: vi.fn().mockResolvedValue(undefined),
    } as ServiceRegistry['pendingItems'],
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
    diagnostics: { readNetCounters: vi.fn().mockResolvedValue({}) },
    transferLifecycle: {} as ServiceRegistry['transferLifecycle'],
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PendingItemDetailScreen — QR backdrop vs back button', () => {
  it('swallows a back-button tap that lands right after the QR backdrop dismisses it, but honors one that arrives later', async () => {
    const registry = createMockRegistry()
    const onBack = vi.fn()

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServiceProvider registry={registry}>{children}</ServiceProvider>
    )

    const { container } = render(
      <PendingItemDetailScreen
        item={{
          id: 'receive-request-1',
          direction: 'receive',
          kind: 'request',
          amount: 1000,
          accountId: 'https://mint.test',
          createdAt: Date.now(),
          details: { quoteId: 'quote-1', invoice: 'lnbc1000n1...' },
        }}
        onBack={onBack}
      />,
      { wrapper },
    )

    // Let the mount-time expiry check settle first — unrelated to this test,
    // but its pending promise would otherwise resolve mid-assertion outside act().
    await waitFor(() => expect(registry.pendingItems.checkEffectiveExpiry).toHaveBeenCalled())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // Open the QR sheet (the chip row's QR button).
    fireEvent.click(screen.getByRole('button', { name: /QR/ }))
    const backdrop = container.querySelector('.backdrop-blur-sm')
    expect(backdrop).toBeTruthy()

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000)
    fireEvent.click(backdrop as Element) // dismisses the QR sheet, stamps the guard

    // A follow-up tap 100ms later lands on the now-exposed back button — same
    // coordinate a real double-tap or ghost-click would hit. It must be swallowed.
    nowSpy.mockReturnValue(1_100)
    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))
    expect(onBack).not.toHaveBeenCalled()

    // A deliberate back tap well outside the guard window still works.
    nowSpy.mockReturnValue(2_000)
    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
