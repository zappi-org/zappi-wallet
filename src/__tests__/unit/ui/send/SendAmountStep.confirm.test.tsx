import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SendAmountStep } from '@/ui/screens/Send/steps/SendAmountStep'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@/ui/hooks/use-wallet', () => ({
  useWallet: () => ({ balance: { byMint: { 'https://mint.example.com': 10000 } } }),
}))
vi.mock('@/store', () => ({
  useAppStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }),
}))
vi.mock('@/utils/format', () => ({
  appendFiatInput: (current: string, key: string) => key === 'decimal' ? `${current || '0'}.` : `${current}${key}`,
  getFiatDecimalSeparator: () => '.',
  getFiatFractionDigits: () => 2,
  useFormatSats: () => (n: number) => `${n} sat`,
  useSatUnit: () => 'sat',
  useFormatFiat: () => (n: number) => `$${n}`,
  isZeroDecimalCurrency: () => false,
  formatFiatInputForDisplay: (v: string) => {
    if (!v) return '0'
    const [integer = '0', fraction] = v.split('.')
    const groupedInteger = Number(integer || '0').toLocaleString()
    return v.includes('.') ? `${groupedInteger}.${fraction ?? ''}` : groupedInteger
  },
}))
vi.mock('@/ui/hooks/use-fiat-toggle', () => ({
  useFiatToggle: () => ({
    isFiatMode: false,
    fiatInput: '',
    fiatCurrency: 'USD',
    currencySymbol: '$',
    exchangeRate: null,
    showFiat: true,
    handleToggleFiat: vi.fn(),
    handleFiatChange: vi.fn(),
    syncFiatFromSats: vi.fn(),
  }),
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: () => 'My Mint',
    getIconUrl: () => undefined,
  }),
}))
vi.mock('@/utils/url', () => ({
  getMintBalance: (url: string, byMint: Record<string, number>) => byMint[url] ?? 0,
}))
vi.mock('@/ui/hooks/use-contacts', () => ({
  useContacts: () => ({ findByAddress: vi.fn(async () => null) }),
}))
vi.mock('@/ui/screens/Send/sendDisplayHelpers', () => ({
  findContactName: vi.fn(async () => null),
  formatNpubShort: (s: string) => s,
  formatRecipientDisplayText: (s: string) => s,
  formatLightningAddress: (s: string) => s,
  isDirectCashuRecipient: (data: { type: string; parsed?: { sameMintOnly?: boolean; nostrTarget?: string } }) =>
    data.type === 'cashu-request' && data.parsed?.sameMintOnly === true && !!data.parsed.nostrTarget,
  middleEllipsis: (s: string) => s,
  shouldShowRecipientInMainMessage: () => true,
}))
vi.mock('@/ui/components/common/ScreenHeader', () => ({
  ScreenHeader: ({ title }: { title?: string }) => <div>{title}</div>,
}))
vi.mock('@/ui/components/common/MintIcon', () => ({
  MintIcon: () => <span data-testid="mint-icon" />,
}))
vi.mock('@/ui/components/payment/MintSelectBottomSheet', () => ({
  MintSelectBottomSheet: () => null,
}))

const baseProps = {
  onBack: vi.fn(),
  onNext: vi.fn(),
  mintUrl: 'https://mint.example.com',
  destination: 'alice@example.com',
  initialAmount: 5000,
  confirming: true,
  confirmMemo: '',
  onEditMemo: vi.fn(),
  onCancelConfirm: vi.fn(),
  onConfirmSend: vi.fn(),
}

describe('SendAmountStep confirm variant', () => {
  it('keeps Send disabled and shows a local skeleton while the fee quote is pending', () => {
    render(<SendAmountStep {...baseProps} feeQuote="pending" />)
    expect(screen.getByRole('status', { name: 'send.confirm.feeChecking' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'send.confirm.send' })).toBeDisabled()
    // keypad is gone in confirm state
    expect(screen.queryByText('send.max')).not.toBeInTheDocument()
  })

  it('shows the fee and enables Send once quoted', () => {
    render(<SendAmountStep {...baseProps} feeQuote={30} />)
    expect(screen.getByRole('button', { name: 'send.confirm.send' })).toBeEnabled()
  })

  it('uses recipient-specific endpoint icons', () => {
    const { rerender } = render(
      <SendAmountStep
        {...baseProps}
        feeQuote={30}
        validatedData={{ type: 'bolt11', invoice: 'lnbc1invoice', amountSats: 5000, expiry: 9999999999 }}
      />,
    )
    expect(screen.getByTestId('recipient-lightning-icon')).toBeInTheDocument()
    expect(screen.getByText('send.confirm.paymentRequest')).toBeInTheDocument()

    rerender(
      <SendAmountStep
        {...baseProps}
        feeQuote={30}
        validatedData={{
          type: 'lightning-address',
          address: 'alice@example.com',
          lnurlParams: {
            callback: 'https://example.com/pay',
            minSendable: 1000,
            maxSendable: 1000000,
            metadata: '[["text/plain","Alice"]]',
            tag: 'payRequest',
            domain: 'example.com',
          },
        }}
      />,
    )
    expect(screen.getByTestId('recipient-lightning-icon')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()

    rerender(
      <SendAmountStep
        {...baseProps}
        feeQuote={30}
        validatedData={{
          type: 'cashu-request',
          request: 'npub1recipient',
          parsed: {
            id: 'request-id',
            unit: 'sat',
            mints: [],
            transports: [{ type: 'nostr', target: 'npub1recipient' }],
            hasNostrTransport: true,
            nostrTarget: 'npub1recipient',
            hasPostTransport: false,
          },
        }}
      />,
    )
    expect(screen.getByTestId('recipient-nostr-icon')).toBeInTheDocument()
    expect(screen.getByText('send.confirm.paymentRequest')).toBeInTheDocument()
  })

  it('blocks Send with the fee-unavailable message', () => {
    const onRetryFee = vi.fn()
    render(<SendAmountStep {...baseProps} feeQuote="unavailable" onRetryFee={onRetryFee} />)
    expect(screen.getByText('send.confirm.feeUnavailableValue')).toBeInTheDocument()
    expect(screen.getByText('send.confirm.feeUnavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'send.confirm.send' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'send.confirm.retryFee' }))
    expect(onRetryFee).toHaveBeenCalledOnce()
  })

  it('blocks Send when amount plus fee exceeds the balance and names the total', () => {
    render(<SendAmountStep {...baseProps} initialAmount={9990} feeQuote={30} />)
    expect(screen.getByText('send.confirm.insufficientWithTotal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'send.confirm.send' })).toBeDisabled()
  })

  it('uses the post-unlock quoted balance instead of a transient lower live balance', () => {
    render(<SendAmountStep {...baseProps} initialAmount={9990} feeQuote={30} quotedBalance={10020} />)
    expect(screen.queryByText('send.confirm.insufficientWithTotal')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'send.confirm.send' })).toBeEnabled()
  })

  it('cancel returns to editing, send fires the confirm handler', () => {
    render(<SendAmountStep {...baseProps} feeQuote={30} />)
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(baseProps.onCancelConfirm).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'send.confirm.send' }))
    expect(baseProps.onConfirmSend).toHaveBeenCalled()
  })

  it('memo row shows 없음 when empty and opens the memo sheet', () => {
    render(<SendAmountStep {...baseProps} feeQuote={30} />)
    expect(screen.getByText('send.memo.none')).toBeInTheDocument()
    fireEvent.click(screen.getByText('send.confirm.memo'))
    expect(screen.getByText('send.memo.changeTitle')).toBeInTheDocument()
  })

  it('while sending: Cancel/Send are replaced by the sending status row and the memo row is disabled', () => {
    render(<SendAmountStep {...baseProps} sending journeyStatus="pending" feeQuote={30} />)
    expect(screen.queryByRole('button', { name: 'common.cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'send.confirm.send' })).not.toBeInTheDocument()
    expect(screen.getByText('send.sending.fullRequestMessage')).toBeInTheDocument()
    expect(screen.getByText('send.confirm.memo').closest('button')).toBeDisabled()
    const journey = document.querySelector('[data-journey-status="pending"]')
    expect(journey).toBeInTheDocument()
    expect(journey).toHaveClass('absolute')
    expect(journey).not.toHaveClass('relative')
    expect(screen.getByTestId('send-journey-star')).toBeInTheDocument()
    const track = screen.getByTestId('send-journey-track')
    expect(track).toHaveClass('overflow-hidden')
    expect(track).not.toContainElement(screen.getByTestId('send-journey-star'))
    expect(screen.queryByTestId('send-journey-direction')).not.toBeInTheDocument()
    expect(screen.getByTestId('send-journey-remaining')).toBeInTheDocument()
    expect(screen.getByTestId('send-journey-progress')).not.toHaveAttribute('pathLength')
  })
})
