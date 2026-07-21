import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReceiveFlow } from '@/ui/screens/Receive/ReceiveFlow'
import { sat } from '@/core/domain/amount'
import type { PendingIncomingReview } from '@/core/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/ui/components/common/PageTransition', () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const storeState = {
  addToast: vi.fn(),
  addPendingQuote: vi.fn(),
  settings: { mints: ['https://trusted.mint'], relays: [] },
  nostrPubkey: null,
}
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}))

vi.mock('@/ui/hooks/use-network', () => ({ useNetwork: () => ({ isOnline: true }) }))
vi.mock('@/ui/hooks/use-receive-request', () => ({
  useReceiveRequest: () => ({ create: vi.fn(), cancel: vi.fn(), complete: vi.fn() }),
}))
vi.mock('@/ui/hooks/use-payment-request', () => ({
  usePaymentRequest: () => ({
    createDualTransportPaymentRequest: vi.fn(),
    createNostrPaymentRequest: vi.fn(),
  }),
}))
vi.mock('@/ui/hooks/use-crypto', () => ({
  useCrypto: () => ({ encodeNpub: () => 'npub1x', encodeNprofile: () => 'nprofile1x' }),
}))
vi.mock('@/ui/hooks/use-mint-nut18-support', () => ({
  useMintNut18Support: () => ({ supportsHttp: false }),
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({ getDisplayName: () => 'Mint A', getIconUrl: () => null }),
}))
vi.mock('@/ui/hooks/use-trust-registry', () => ({
  useTrustRegistry: () => ({ isTrusted: (url: string) => url === 'https://trusted.mint' }),
}))

// Step stubs: markers only — this file tests the conductor's step routing.
vi.mock('@/ui/screens/Receive/steps/ReceiveAmountStep', () => ({
  ReceiveAmountStep: () => <div data-testid="amount-step" />,
}))
vi.mock('@/ui/screens/Receive/steps/ReceiveRequestStep', () => ({
  ReceiveRequestStep: () => <div data-testid="step-request" />,
}))
vi.mock('@/ui/screens/Receive/steps/ReceiveReceiptStep', () => ({
  ReceiveReceiptStep: () => <div data-testid="step-received" />,
}))
vi.mock('@/ui/screens/Receive/redeem/RedeemSheet', () => ({
  RedeemSheet: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="redeem-sheet" /> : null),
}))
vi.mock('@/ui/screens/Receive/redeem/ConfirmTrustedStep', () => ({
  ConfirmTrustedStep: ({ onReceive }: { onReceive: () => Promise<void> }) => (
    <button data-testid="step-confirm-trusted" onClick={() => void onReceive()} />
  ),
}))
vi.mock('@/ui/screens/Receive/redeem/ConfirmUntrustedStep', () => ({
  ConfirmUntrustedStep: () => <div data-testid="step-confirm-untrusted" />,
}))
vi.mock('@/ui/components/payment/MintSelectBottomSheet', () => ({
  MintSelectBottomSheet: () => null,
}))

function makeReview(externalId: string, mintUrl: string): PendingIncomingReview {
  return {
    externalId,
    token: { type: 'cashu-token', token: `cashuB${externalId}`, amount: sat(21), mintUrl },
    queuedAt: Date.now(),
    source: 'gift-wrap',
  }
}

function makeProps() {
  return {
    onBack: vi.fn(),
    onComplete: vi.fn(),
    onCreateInvoice: vi.fn(async () => null),
    onPaymentReceived: vi.fn(),
    onReceiveRequestFulfilled: vi.fn(async () => ({ success: true })),
    onReceiveToken: vi.fn(async () => ({ success: true, amount: 21 })),
    onAddTrustedMint: vi.fn(async () => true),
    onResolveIncomingReview: vi.fn(async () => {}),
  }
}

describe('ReceiveFlow incoming review while mounted', () => {
  it('a review arriving after mount jumps to its confirm step and closes overlays', () => {
    const props = makeProps()
    const { rerender } = render(
      <ReceiveFlow {...props} incomingReview={null} launch={{ redeemOpen: true }} />,
    )
    // Redeem launch opens the redeem host with the sheet over it (no step marker).
    expect(screen.getByTestId('redeem-sheet')).toBeInTheDocument()

    rerender(
      <ReceiveFlow {...props} incomingReview={makeReview('r1', 'https://trusted.mint')} launch={{ redeemOpen: true }} />,
    )
    expect(screen.getByTestId('step-confirm-trusted')).toBeInTheDocument()
    expect(screen.queryByTestId('redeem-sheet')).not.toBeInTheDocument()
    expect(screen.queryByTestId('amount-step')).not.toBeInTheDocument()
  })

  it('routes an untrusted-mint review to the untrusted confirm step', () => {
    const props = makeProps()
    const { rerender } = render(<ReceiveFlow {...props} incomingReview={null} />)
    rerender(<ReceiveFlow {...props} incomingReview={makeReview('r2', 'https://unknown.mint')} />)
    expect(screen.getByTestId('step-confirm-untrusted')).toBeInTheDocument()
  })

  it('does not hijack an in-progress receipt with a new review', async () => {
    const props = makeProps()
    const review = makeReview('r1', 'https://trusted.mint')
    const { rerender } = render(<ReceiveFlow {...props} incomingReview={review} />)

    // Initializer consumed the review; redeeming lands on the receipt.
    fireEvent.click(screen.getByTestId('step-confirm-trusted'))
    await waitFor(() => expect(screen.getByTestId('step-received')).toBeInTheDocument())

    rerender(<ReceiveFlow {...props} incomingReview={makeReview('r9', 'https://trusted.mint')} />)
    expect(screen.getByTestId('step-received')).toBeInTheDocument()
    expect(screen.queryByTestId('step-confirm-trusted')).not.toBeInTheDocument()
  })
})
