import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReceiveRequestStep } from '@/ui/screens/Receive/steps/ReceiveRequestStep'

const mockBuildUnifiedBitcoinUri = vi.fn()
const mockWriteText = vi.fn()
const mockAddToast = vi.fn()
const mockSetPendingEcashRequestId = vi.fn()

const stableStore = {
  addToast: mockAddToast,
  setPendingEcashRequestId: mockSetPendingEcashRequestId,
  lastRedeemedQuoteId: null as string | null,
  lastRedeemedQuoteAmount: 0,
  setLastRedeemedQuote: vi.fn(),
  lastReceivedRequestId: null as string | null,
  lastReceivedAmount: 0,
  setLastReceivedPayment: vi.fn(),
}

vi.mock('@/ui/hooks/use-payment-request', () => ({
  usePaymentRequest: () => ({
    buildUnifiedBitcoinUri: mockBuildUnifiedBitcoinUri,
    startHttpPoller: vi.fn(),
  }),
}))

vi.mock('@/store', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAppStore: (selector: (state: typeof stableStore) => any) => selector(stableStore),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/ui/components/common/ScreenHeader', () => ({
  ScreenHeader: ({ title, onBack }: { title: string; onBack: () => void }) => (
    <div data-testid="screen-header">
      <button onClick={onBack}>back</button>
      <span>{title}</span>
    </div>
  ),
}))

vi.mock('@/ui/components/common/QRCodeDisplay', () => ({
  QRCodeDisplay: ({ value }: { value: string }) => <div data-testid="qr-value">{value}</div>,
}))

vi.mock('@/ui/utils/haptic', () => ({
  hapticTap: vi.fn(),
  hapticSuccess: vi.fn(),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount} sat`,
  useFormatFiat: () => () => null,
}))

const baseProps = {
  onBack: vi.fn(),
  onEdit: vi.fn(),
  onRegenerate: vi.fn(),
  onPaymentDetected: vi.fn(),
  amount: 1234,
  mintUrl: 'https://alpha.mint',
  mintDisplayName: 'Mint',
  memo: '',
  invoice: 'lnbc123n1test',
  quoteId: 'quote-1',
  ecashRequest: 'CREQB1TEST',
  ecashRequestId: 'request-1',
  httpEndpoint: null,
}

describe('ReceiveRequestStep protocol tabs', () => {
  beforeEach(() => {
    mockBuildUnifiedBitcoinUri.mockReset()
    mockWriteText.mockReset()
    mockAddToast.mockReset()
    mockSetPendingEcashRequestId.mockReset()
    stableStore.setLastRedeemedQuote.mockReset()
    stableStore.setLastReceivedPayment.mockReset()
    stableStore.lastRedeemedQuoteId = null
    stableStore.lastRedeemedQuoteAmount = 0
    stableStore.lastReceivedRequestId = null
    stableStore.lastReceivedAmount = 0
    mockBuildUnifiedBitcoinUri.mockReturnValue('bitcoin:?lightning=LNB...&creq=CREQB1TEST')

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockWriteText,
      },
    })
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockWriteText,
      },
    })
  })

  it('defaults to unified when both lightning and cashu requests are available', () => {
    render(<ReceiveRequestStep {...baseProps} />)

    expect(mockBuildUnifiedBitcoinUri).toHaveBeenCalledWith({
      lightningInvoice: 'lnbc123n1test',
      cashuRequest: 'CREQB1TEST',
    })
    expect(screen.getByTestId('qr-value')).toHaveTextContent('bitcoin:?lightning=LNB...&creq=CREQB1TEST')
  })

  it('switches protocol payloads and copies the selected value', async () => {
    const user = userEvent.setup()
    mockWriteText.mockResolvedValue(undefined)

    render(<ReceiveRequestStep {...baseProps} />)

    await user.click(screen.getByRole('tab', { name: 'receive.qr.protocols.cashu' }))
    expect(screen.getByTestId('qr-value')).toHaveTextContent('CREQB1TEST')

    // Two buttons share the "common.copy" accessible name here: the QR
    // tap-to-copy wrapper (static aria-label) and the visible copy/share
    // row button (toggling text) — the row button is the last match.
    const copyButtons = screen.getAllByRole('button', { name: 'common.copy' })
    await user.click(copyButtons[copyButtons.length - 1])
    expect(screen.getByRole('button', { name: 'common.copied' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'receive.qr.protocols.lightning' }))
    expect(screen.getByTestId('qr-value')).toHaveTextContent('LNBC123N1TEST')

    await user.click(screen.getByRole('button', { name: 'common.copied' }))
    expect(screen.getByRole('button', { name: 'common.copied' })).toBeInTheDocument()
  })

  it('reports lightning quote settlement as canonical bolt11 receive method', async () => {
    stableStore.lastRedeemedQuoteId = 'quote-1'
    stableStore.lastRedeemedQuoteAmount = 1234
    const onPaymentDetected = vi.fn()

    render(<ReceiveRequestStep {...baseProps} onPaymentDetected={onPaymentDetected} />)

    expect(onPaymentDetected).toHaveBeenCalledWith(1234, 'bolt11')
    expect(stableStore.setLastRedeemedQuote).toHaveBeenCalledWith(null, 0)
  })

  it('expired request hides copy/share and offers regenerate', () => {
    render(<ReceiveRequestStep {...baseProps} expiresAt={Date.now() - 1000} />)
    expect(screen.getByText('receive.request.regenerate')).toBeInTheDocument()
  })
})
