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
  // Sticky payment signals — the setters mutate this plain object so the
  // flow's consumption (clearing the signal) is observable in assertions.
  lastRedeemedQuoteId: null as string | null,
  lastRedeemedQuoteAmount: 0,
  setLastRedeemedQuote: vi.fn((id: string | null, amount: number) => {
    storeState.lastRedeemedQuoteId = id
    storeState.lastRedeemedQuoteAmount = amount
  }),
  lastReceivedRequestId: null as string | null,
  lastReceivedAmount: 0,
  setLastReceivedPayment: vi.fn((id: string | null, amount: number) => {
    storeState.lastReceivedRequestId = id
    storeState.lastReceivedAmount = amount
  }),
}
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}))

vi.mock('@/ui/hooks/use-network', () => ({ useNetwork: () => ({ isOnline: true }) }))
// Stable spies (not per-render fns) so tests can assert cancel/complete calls.
const receiveReq = vi.hoisted(() => ({
  create: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  complete: vi.fn(async () => {}),
}))
vi.mock('@/ui/hooks/use-receive-request', () => ({
  useReceiveRequest: () => receiveReq,
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
vi.mock('@/ui/screens/Receive/steps/ReceiveAmountStep', () => ({
  ReceiveAmountStep: ({ onConfirm }: { onConfirm: (d: { amount: number; memo: string }) => void }) => (
    <button data-testid="amount-step" onClick={() => onConfirm({ amount: 100, memo: '' })} />
  ),
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
  it('routes address → amount → request via confirm, edit returns to amount, and a payment lands on the receipt', async () => {
    const props = baseProps()
    render(<ReceiveFlow {...props} incomingReview={null} />)

    // address → amount step → confirm → request step (the amount step unmounts)
    fireEvent.click(screen.getByTestId('specify-amount'))
    expect(screen.getByTestId('amount-step')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('amount-step'))
    await waitFor(() => expect(screen.getByTestId('step-request')).toBeInTheDocument())
    expect(screen.queryByTestId('amount-step')).not.toBeInTheDocument()

    // edit-from-request navigates back to the amount step (request unmounts)
    fireEvent.click(screen.getByTestId('request-edit'))
    expect(screen.getByTestId('amount-step')).toBeInTheDocument()
    expect(screen.queryByTestId('step-request')).not.toBeInTheDocument()

    // re-confirm regenerates → request step again, then a payment arrives
    fireEvent.click(screen.getByTestId('amount-step'))
    await waitFor(() => expect(screen.getByTestId('step-request')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('request-pay'))
    await waitFor(() => expect(screen.getByTestId('step-received')).toBeInTheDocument())
    expect(screen.queryByTestId('amount-step')).not.toBeInTheDocument()
  })

  it('confirm on an already-paid request surfaces the arrival receipt instead of regenerating', async () => {
    const props = baseProps()
    const { rerender } = render(<ReceiveFlow {...props} incomingReview={null} />)

    // address → amount → confirm creates the request (quoteId 'q1')
    fireEvent.click(screen.getByTestId('specify-amount'))
    fireEvent.click(screen.getByTestId('amount-step'))
    await waitFor(() => expect(screen.getByTestId('step-request')).toBeInTheDocument())
    expect(props.onCreateInvoice).toHaveBeenCalledTimes(1)

    // Enter edit — the request step (and its payment watchers) unmounts.
    fireEvent.click(screen.getByTestId('request-edit'))
    expect(screen.getByTestId('amount-step')).toBeInTheDocument()

    // The old quote settles during the blind window; the sticky signal lands.
    // Rerender stands in for the re-render a live zustand store would trigger.
    storeState.lastRedeemedQuoteId = 'q1'
    storeState.lastRedeemedQuoteAmount = 100
    rerender(<ReceiveFlow {...props} incomingReview={null} />)

    receiveReq.cancel.mockClear()
    receiveReq.complete.mockClear()
    fireEvent.click(screen.getByTestId('amount-step'))

    // Arrival receipt, not a regenerated request: the paid request survives.
    await waitFor(() => expect(screen.getByTestId('step-received')).toBeInTheDocument())
    expect(receiveReq.cancel).not.toHaveBeenCalled()
    expect(props.onCreateInvoice).toHaveBeenCalledTimes(1)
    expect(props.onPaymentReceived).toHaveBeenCalledWith(100, 'lightning')
    expect(receiveReq.complete).toHaveBeenCalledWith(expect.any(String), 'bolt11')
    // Signal consumed exactly once (mirrors the request step's watchers).
    expect(storeState.lastRedeemedQuoteId).toBeNull()
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
