import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReceiveQRStep } from '@/ui/screens/Receive/steps/ReceiveQRStep'

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

describe('ReceiveQRStep protocol tabs', () => {
  beforeEach(() => {
    mockBuildUnifiedBitcoinUri.mockReset()
    mockWriteText.mockReset()
    mockAddToast.mockReset()
    mockSetPendingEcashRequestId.mockReset()
    stableStore.setLastRedeemedQuote.mockReset()
    stableStore.setLastReceivedPayment.mockReset()
    mockBuildUnifiedBitcoinUri.mockReturnValue('bitcoin:?lightning=LNB...&cr=creqA-test')

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
    render(
      <ReceiveQRStep
        onBack={vi.fn()}
        onPaymentDetected={vi.fn()}
        amount={1234}
        mintUrl="https://alpha.mint"
        invoice="lnbc123n1test"
        quoteId="quote-1"
        ecashRequest="creqA-test"
        ecashRequestId="request-1"
        httpEndpoint={null}
      />,
    )

    expect(mockBuildUnifiedBitcoinUri).toHaveBeenCalledWith({
      lightningInvoice: 'lnbc123n1test',
      cashuRequest: 'creqA-test',
    })
    expect(screen.getByTestId('qr-value')).toHaveTextContent('bitcoin:?lightning=LNB...&cr=creqA-test')
  })

  it('switches protocol payloads and copies the selected value', async () => {
    const user = userEvent.setup()
    mockWriteText.mockResolvedValue(undefined)

    render(
      <ReceiveQRStep
        onBack={vi.fn()}
        onPaymentDetected={vi.fn()}
        amount={1234}
        mintUrl="https://alpha.mint"
        invoice="lnbc123n1test"
        quoteId="quote-1"
        ecashRequest="creqA-test"
        ecashRequestId="request-1"
        httpEndpoint={null}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'receive.qr.protocols.cashu' }))
    expect(screen.getByTestId('qr-value')).toHaveTextContent('creqA-test')

    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(screen.getByRole('button', { name: 'common.copied' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'receive.qr.protocols.lightning' }))
    expect(screen.getByTestId('qr-value')).toHaveTextContent('LNBC123N1TEST')

    await user.click(screen.getByRole('button', { name: 'common.copied' }))
    expect(screen.getByRole('button', { name: 'common.copied' })).toBeInTheDocument()
  })
})
