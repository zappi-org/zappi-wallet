import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SendAmountStep } from '@/ui/screens/Send/steps/SendAmountStep'
import { confirmAmountSizeClass } from '@/ui/screens/Send/sendDisplayHelpers'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  // Renders the key plus interpolated values so identity assertions can
  // target the real recipient string.
  Trans: ({ i18nKey, values }: { i18nKey: string; values?: Record<string, unknown> }) => (
    <>{[i18nKey, ...(values ? Object.values(values).map(String) : [])].join(' ')}</>
  ),
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
vi.mock('@/ui/screens/Send/sendDisplayHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/screens/Send/sendDisplayHelpers')>()
  // Real display logic (the confirm identity line depends on it); only the
  // async contact lookup is stubbed.
  return { ...actual, findContactName: vi.fn(async () => null) }
})
vi.mock('@/ui/components/common/ScreenHeader', () => ({
  ScreenHeader: ({ title, onBack }: { title?: string; onBack?: () => void }) => (
    <div>
      {onBack && <button aria-label="header-back" onClick={onBack} />}
      {title}
    </div>
  ),
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

  it('asks the Toss question with the full identity per recipient type', () => {
    const { rerender } = render(
      <SendAmountStep
        {...baseProps}
        feeQuote={30}
        validatedData={{ type: 'bolt11', invoice: 'lnbc1invoice', amountSats: 5000, expiry: 9999999999 }}
      />,
    )
    // bolt11: anonymous request question + invoice fingerprint as the identity.
    expect(screen.getByText(/send\.confirm\.requestQuestion/)).toBeInTheDocument()
    expect(screen.getByText('lnbc1invoice')).toBeInTheDocument()

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
    // The question carries the FULL address — identity is never erased at commit.
    expect(screen.getByText(/send\.confirm\.question alice@example\.com/)).toBeInTheDocument()

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
    expect(screen.getByText(/send\.confirm\.requestQuestion/)).toBeInTheDocument()
    expect(screen.getByText('npub1rec…ient')).toBeInTheDocument()
  })

  it('sending prints the receipt with the recipient identity', () => {
    const { rerender } = render(
      <SendAmountStep
        {...baseProps}
        feeQuote={30}
        sending
        validatedData={{ type: 'bolt11', invoice: 'lnbc1invoice', amountSats: 5000, expiry: 9999999999 }}
      />,
    )
    expect(screen.getByText('send.receipt.title')).toBeInTheDocument()
    expect(screen.getByText('send.receipt.sending')).toBeInTheDocument()
    // The fingerprint row is the anonymous request's identity on paper.
    expect(screen.getByText('lnbc1invoice')).toBeInTheDocument()

    rerender(
      <SendAmountStep
        {...baseProps}
        feeQuote={30}
        sending
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
    expect(screen.getByText('npub1rec…ient')).toBeInTheDocument()
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

  it('boundary: total exactly equal to the balance stays sendable (3 sats — send 2 + fee 1)', () => {
    render(<SendAmountStep {...baseProps} initialAmount={2} feeQuote={1} quotedBalance={3} />)
    expect(screen.queryByText('send.confirm.insufficientWithTotal')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'send.confirm.send' })).toBeEnabled()
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

  it('card names the source mint (the diagram is gone from confirm)', () => {
    render(<SendAmountStep {...baseProps} feeQuote={30} />)
    expect(screen.getByText('send.confirm.sourceMint')).toBeInTheDocument()
    expect(screen.getByText('My Mint')).toBeInTheDocument()
  })

  it('while sending: controls and card disappear — the printing receipt carries the state', () => {
    render(<SendAmountStep {...baseProps} sending feeQuote={30} />)
    expect(screen.queryByRole('button', { name: 'common.cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'send.confirm.send' })).not.toBeInTheDocument()
    // Regression (QA-caught): the keypad must not resurrect in the else-branch.
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.confirm' })).not.toBeInTheDocument()
    // The receipt carries the cost story while printing
    expect(screen.getByText('send.receipt.title')).toBeInTheDocument()
    expect(screen.getByText('send.receipt.sending')).toBeInTheDocument()
    expect(screen.getByText('5030 sat')).toBeInTheDocument()
    // No tappable rows on paper — the memo edit button is confirm-only
    expect(screen.queryByRole('button', { name: /send\.confirm\.memo/ })).not.toBeInTheDocument()
  })

  it('renames the header to the confirm title and keeps the back arrow until sending', () => {
    const { rerender } = render(<SendAmountStep {...baseProps} feeQuote={30} />)
    expect(screen.getByText('send.confirm.title')).toBeInTheDocument()
    expect(screen.getByLabelText('header-back')).toBeInTheDocument()

    rerender(<SendAmountStep {...baseProps} feeQuote={30} sending />)
    expect(screen.queryByLabelText('header-back')).not.toBeInTheDocument()
  })

  it('shows the total (amount + fee) once the fee is quoted, with a skeleton while pending', () => {
    const { rerender } = render(<SendAmountStep {...baseProps} feeQuote="pending" />)
    expect(screen.getByText('send.confirm.total')).toBeInTheDocument()
    expect(screen.queryByText('5030 sat')).not.toBeInTheDocument()

    rerender(<SendAmountStep {...baseProps} feeQuote={30} />)
    expect(screen.getByText('5030 sat')).toBeInTheDocument()

    // Unavailable fee: the total row disappears — the error line owns that state.
    rerender(<SendAmountStep {...baseProps} feeQuote="unavailable" />)
    expect(screen.queryByText('send.confirm.total')).not.toBeInTheDocument()
  })

  it('truncates a long memo instead of deforming the card', () => {
    const longMemo = '가'.repeat(200)
    render(<SendAmountStep {...baseProps} feeQuote={30} confirmMemo={longMemo} />)
    expect(screen.getByText(longMemo)).toHaveClass('truncate')
  })

  it('steps the question amount size down for very long values (digit count, unit-agnostic)', () => {
    expect(confirmAmountSizeClass('₿5,000')).toBe('text-[32px]')
    expect(confirmAmountSizeClass('5000 sat')).toBe('text-[32px]')
    expect(confirmAmountSizeClass('1,234,567,890 sats')).toBe('text-[26px]')
    expect(confirmAmountSizeClass('123,456,789,012 sats')).toBe('text-[22px]')
  })

  it('locks back and cancel while the confirm handler is in flight', async () => {
    let resolveSend: () => void = () => {}
    const onConfirmSend = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve }))
    render(<SendAmountStep {...baseProps} feeQuote={30} onConfirmSend={onConfirmSend} />)

    fireEvent.click(screen.getByRole('button', { name: 'send.confirm.send' }))
    expect(onConfirmSend).toHaveBeenCalledOnce()
    // Direct transfers never enter the flow-level 'sending' step, so the
    // in-flight lock must come from the local busy state.
    expect(screen.queryByLabelText('header-back')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled()

    resolveSend()
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.cancel' })).toBeEnabled())
    expect(screen.getByLabelText('header-back')).toBeInTheDocument()
  })

  it('shows the contact name in the question and the raw address as the detail line', () => {
    render(
      <SendAmountStep
        {...baseProps}
        feeQuote={30}
        displayName="Alice"
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
    expect(screen.getByText(/send\.confirm\.question Alice/)).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  })
})
