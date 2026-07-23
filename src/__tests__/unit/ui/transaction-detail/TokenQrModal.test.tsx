import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TokenQrModal } from '@/ui/screens/TransactionDetail/TokenQrModal'

const mockWriteText = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// QRCodeDisplay pulls in bc-ur/cborg (no jsdom-resolvable "main" export) —
// mock it to surface the `value` prop instead, same pattern as
// ReceiveRequestStep.protocols.test.tsx.
vi.mock('@/ui/components/common/QRCodeDisplay', () => ({
  QRCodeDisplay: ({ value }: { value: string }) => <div data-testid="qr-value">{value}</div>,
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TokenQrModal', () => {
  it('renders no tabs on the single-token path (backward compatible)', () => {
    render(
      <TokenQrModal isOpen token="cashuAbc123" onClose={vi.fn()} veil={false} />,
    )
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('qr-value')).toHaveTextContent('cashuAbc123')
  })

  it('renders a SegmentControl tab per payload when more than one is given', () => {
    render(
      <TokenQrModal
        isOpen
        token=""
        onClose={vi.fn()}
        payloads={[
          { id: 'unified', label: 'receive.qr.protocols.unified', value: 'bitcoin:unified' },
          { id: 'cashu', label: 'receive.qr.protocols.cashu', value: 'creqB...' },
          { id: 'lightning', label: 'receive.qr.protocols.lightning', value: 'lnbc1...' },
        ]}
      />,
    )
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByTestId('qr-value')).toHaveTextContent('bitcoin:unified')
  })

  it('switches the QR value and the copy target when a different protocol tab is selected', async () => {
    const user = userEvent.setup()
    mockWriteText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockWriteText },
    })

    render(
      <TokenQrModal
        isOpen
        token=""
        onClose={vi.fn()}
        payloads={[
          { id: 'unified', label: 'receive.qr.protocols.unified', value: 'bitcoin:unified' },
          { id: 'cashu', label: 'receive.qr.protocols.cashu', value: 'creqB...' },
        ]}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'receive.qr.protocols.cashu' }))
    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('creqB...'))

    await user.click(screen.getByRole('button', { name: 'mintDetail.copy' }))
    expect(mockWriteText).toHaveBeenCalledWith('creqB...')
  })

  it('veils only when the active payload says so, and re-veils on tab switch back', async () => {
    const user = userEvent.setup()

    render(
      <TokenQrModal
        isOpen
        token=""
        onClose={vi.fn()}
        payloads={[
          { id: 'bearer', label: 'bearer', value: 'cashuBearer', veil: true },
          { id: 'unified', label: 'unified', value: 'bitcoin:unified', veil: false },
        ]}
      />,
    )

    // First payload veils — reveal button present, QR value hidden behind it.
    expect(screen.getByLabelText('send.tokenCreate.tapToReveal')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'unified' }))
    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('bitcoin:unified'))
    // Unveiled payload — no reveal affordance needed.
    expect(screen.queryByText('🙈')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'bearer' }))
    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('cashuBearer'))
    expect(screen.getByText('🙈')).toBeInTheDocument()
  })

  it('resets to the first payload when reopened after closing on another tab', async () => {
    const user = userEvent.setup()
    const payloads = [
      { id: 'unified', label: 'receive.qr.protocols.unified', value: 'bitcoin:unified' },
      { id: 'cashu', label: 'receive.qr.protocols.cashu', value: 'creqB...' },
    ]

    const { rerender } = render(
      <TokenQrModal isOpen token="" onClose={vi.fn()} payloads={payloads} />,
    )

    await user.click(screen.getByRole('tab', { name: 'receive.qr.protocols.cashu' }))
    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('creqB...'))

    // Close, then reopen — should not remember the cashu tab.
    rerender(<TokenQrModal isOpen={false} token="" onClose={vi.fn()} payloads={payloads} />)
    rerender(<TokenQrModal isOpen token="" onClose={vi.fn()} payloads={payloads} />)

    expect(screen.getByTestId('qr-value')).toHaveTextContent('bitcoin:unified')
  })
})
