import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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
  useReceiveRequest: () => ({ create: vi.fn(async () => {}), cancel: vi.fn(), complete: vi.fn(async () => {}) }),
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

// Step stubs expose the conductor callbacks under test as buttons.
vi.mock('@/ui/screens/Receive/steps/ReceiveAddressStep', () => ({
  ReceiveAddressStep: ({ onSpecifyAmount }: { onSpecifyAmount: () => void }) => (
    <button data-testid="specify-amount" onClick={onSpecifyAmount} />
  ),
}))
vi.mock('@/ui/screens/Receive/ReceiveAmountSheet', () => ({
  ReceiveAmountSheet: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: (d: { amount: number; memo: string }) => void }) =>
    isOpen ? <button data-testid="amount-sheet" onClick={() => onConfirm({ amount: 100, memo: '' })} /> : null,
}))
vi.mock('@/ui/screens/Receive/steps/ReceiveRequestStep', () => ({
  ReceiveRequestStep: ({ onEdit, onPaymentDetected }: { onEdit: () => void; onPaymentDetected: (a: number, m: 'bolt11' | 'ecash') => void }) => (
    <div data-testid="step-request">
      <button data-testid="request-edit" onClick={onEdit} />
      <button data-testid="request-pay" onClick={() => onPaymentDetected(100, 'ecash')} />
    </div>
  ),
}))
vi.mock('@/ui/screens/Receive/steps/ReceiveReceiptStep', () => ({
  ReceiveReceiptStep: () => <div data-testid="step-received" />,
}))
vi.mock('@/ui/screens/Receive/steps/ReceiveCompleteStep', () => ({
  ReceiveCompleteStep: () => <div data-testid="step-complete" />,
}))
vi.mock('@/ui/screens/Receive/redeem/RedeemSheet', () => ({
  RedeemSheet: ({ isOpen, onValidated }: { isOpen: boolean; onValidated: (t: unknown) => void }) =>
    isOpen ? (
      <button
        data-testid="redeem-validate"
        onClick={() =>
          onValidated({ type: 'cashu-token', token: 'cashuB_manualX', mintUrl: 'https://trusted.mint', amount: sat(21) })
        }
      />
    ) : null,
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

function baseProps() {
  return {
    onBack: vi.fn(),
    onComplete: vi.fn(),
    onCreateInvoice: vi.fn(async () => ({ invoice: 'lnbc1', quoteId: 'q1', expiry: Math.floor(Date.now() / 1000) + 600 })),
    onPaymentReceived: vi.fn(),
    onReceiveRequestFulfilled: vi.fn(async () => ({ success: true })),
    onReceiveToken: vi.fn(async () => ({ success: true, amount: 21 })),
    onAddTrustedMint: vi.fn(async () => true),
  }
}

describe('ReceiveFlow conductor — overlay + review races', () => {
  it('payment detected while the amount sheet is open closes the sheet and shows the receipt', async () => {
    const props = baseProps()
    render(<ReceiveFlow {...props} incomingReview={null} />)

    // address → open amount sheet → confirm → request step
    fireEvent.click(screen.getByTestId('specify-amount'))
    fireEvent.click(screen.getByTestId('amount-sheet'))
    await waitFor(() => expect(screen.getByTestId('step-request')).toBeInTheDocument())
    expect(screen.queryByTestId('amount-sheet')).not.toBeInTheDocument()

    // edit-from-request reopens the amount sheet as an overlay
    fireEvent.click(screen.getByTestId('request-edit'))
    expect(screen.getByTestId('amount-sheet')).toBeInTheDocument()

    // payment arrives while that overlay is open
    fireEvent.click(screen.getByTestId('request-pay'))
    await waitFor(() => expect(screen.getByTestId('step-received')).toBeInTheDocument())
    expect(screen.queryByTestId('amount-sheet')).not.toBeInTheDocument()
  })

  it('does NOT resolve a different pending review when a manual redeem finalizes', async () => {
    const onResolveIncomingReview = vi.fn(async () => {})
    let resolveToken: (v: { success: boolean; amount: number }) => void = () => {}
    const onReceiveToken = vi.fn(
      () => new Promise<{ success: boolean; amount: number }>((res) => { resolveToken = res }),
    )
    const props = { ...baseProps(), onReceiveToken, onResolveIncomingReview }

    const { rerender } = render(
      <ReceiveFlow {...props} incomingReview={null} launch={{ redeemOpen: true }} />,
    )

    // Manually validate token X → trusted confirm step.
    fireEvent.click(screen.getByTestId('redeem-validate'))
    await waitFor(() => expect(screen.getByTestId('step-confirm-trusted')).toBeInTheDocument())

    // Start the redeem (in flight), then a DIFFERENT review arrives mid-flight.
    fireEvent.click(screen.getByTestId('step-confirm-trusted'))
    rerender(<ReceiveFlow {...props} incomingReview={makeReview('rY', 'https://trusted.mint')} launch={{ redeemOpen: true }} />)

    // Redeem completes → receipt, but the unrelated review is left unresolved.
    await act(async () => { resolveToken({ success: true, amount: 21 }) })
    await waitFor(() => expect(screen.getByTestId('step-received')).toBeInTheDocument())
    expect(onResolveIncomingReview).not.toHaveBeenCalled()
  })

  it('resolves the review whose own token was redeemed', async () => {
    const onResolveIncomingReview = vi.fn(async () => {})
    const review = makeReview('rA', 'https://trusted.mint')
    const props = { ...baseProps(), onResolveIncomingReview }

    render(<ReceiveFlow {...props} incomingReview={review} />)
    fireEvent.click(screen.getByTestId('step-confirm-trusted'))

    await waitFor(() => expect(screen.getByTestId('step-received')).toBeInTheDocument())
    expect(onResolveIncomingReview).toHaveBeenCalledTimes(1)
  })
})
