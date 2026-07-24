import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// QRCodeDisplay pulls in bc-ur/cborg (no jsdom-resolvable "main" export) —
// surface its `value` prop instead, same pattern as TokenQrModal.test.tsx.
vi.mock('@/ui/components/common/QRCodeDisplay', () => ({
  QRCodeDisplay: ({ value }: { value: string }) => <div data-testid="qr-value">{value}</div>,
}))

function createMockRegistry(): ServiceRegistry {
  return {
    eventBus: {
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
      off: vi.fn(),
    },
    mintInfo: { getInfo: vi.fn() } as unknown as ServiceRegistry['mintInfo'],
    recoveryScheduler: {
      reconcile: vi.fn().mockResolvedValue({ settled: 0, reclaimed: 0, failed: 0, cleaned: 0 }),
      recoverTargeted: vi.fn().mockResolvedValue({ moduleId: 'cashu', recovered: 0, failed: 0 }),
      drainReviewQueue: vi.fn().mockResolvedValue({ redeemed: 0, amount: 0 }),
      runFullNetworkRecovery: vi.fn().mockResolvedValue({ moduleId: 'cashu', recovered: 0, failed: 0 }),
    } as unknown as ServiceRegistry['recoveryScheduler'],
    incomingReviewQueue: {
      enqueue: vi.fn(), listAll: vi.fn().mockResolvedValue([]), listByMint: vi.fn().mockResolvedValue([]), remove: vi.fn(),
    } as unknown as ServiceRegistry['incomingReviewQueue'],
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
      // Not expired/fulfilled — the request stays open for the QR interaction below.
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

describe('PendingItemDetailScreen — chip QR reflects a late-arriving invoice', () => {
  it('adds the lightning tab once the async invoice resolves, without resetting the active tab', async () => {
    const registry = createMockRegistry()
    const user = userEvent.setup()

    let resolveQuote: (value: { state: string; request?: string }) => void = () => {}
    const onCheckQuote = vi.fn(
      () => new Promise<{ state: string; request?: string }>((resolve) => { resolveQuote = resolve }),
    )

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
          details: {
            quoteId: 'quote-1',
            invoice: '', // orphan quote — no invoice yet, fetched async below
            bip321Uri: 'bitcoin:bc1unified?lightning=...',
            ecashRequest: 'creqBcashu...',
          },
        }}
        onBack={vi.fn()}
        callbacks={{ onCheckQuote }}
      />,
      { wrapper },
    )

    await user.click(screen.getByRole('button', { name: 'QR' }))

    // Only the unified + cashu tabs before the invoice resolves.
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))

    await user.click(screen.getByRole('tab', { name: 'receive.qr.protocols.cashu' }))
    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('creqBcashu...'))

    resolveQuote({ state: 'UNPAID', request: 'lnbc1lateinvoice...' })

    // The lightning tab appears without the sheet closing or resetting...
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(3))
    expect(screen.getByRole('tab', { name: 'receive.qr.protocols.lightning' })).toBeInTheDocument()
    // ...and the user's current selection (cashu) is left alone.
    expect(screen.getByTestId('qr-value')).toHaveTextContent('creqBcashu...')
  })
})
