import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TokenQrModal, BACKDROP_SHIELD_MS } from '@/ui/screens/TransactionDetail/TokenQrModal'

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

    const { container } = render(
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
    expect(container.querySelector('.lucide-eye-off')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'bearer' }))
    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('cashuBearer'))
    expect(container.querySelector('.lucide-eye-off')).toBeInTheDocument()
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

describe('TokenQrModal — backdrop ghost-tap shield', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes on backdrop click and arms a transient shield that clears after ~350ms', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()

    const { container, rerender } = render(
      <TokenQrModal isOpen token="cashuAbc123" onClose={onClose} veil={false} />,
    )

    const backdrop = container.querySelector('.backdrop-blur-sm')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop as Element)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Parent reacts to onClose by flipping isOpen — the modal stays mounted
    // (both real call sites keep it rendered), so the shield can render in its place.
    rerender(<TokenQrModal isOpen={false} token="cashuAbc123" onClose={onClose} veil={false} />)
    expect(screen.getByTestId('qr-backdrop-shield')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(BACKDROP_SHIELD_MS)
    })
    expect(screen.queryByTestId('qr-backdrop-shield')).not.toBeInTheDocument()
  })

  it('absorbs a follow-up tap instead of letting it reach a control underneath', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const probe = vi.fn()

    function Harness({ isOpen }: { isOpen: boolean }) {
      return (
        <div>
          <button onClick={probe}>underneath control</button>
          <TokenQrModal isOpen={isOpen} token="cashuAbc123" onClose={onClose} veil={false} />
        </div>
      )
    }

    const { container, rerender } = render(<Harness isOpen />)
    const backdrop = container.querySelector('.backdrop-blur-sm')
    fireEvent.click(backdrop as Element)
    rerender(<Harness isOpen={false} />)

    const shield = screen.getByTestId('qr-backdrop-shield')
    fireEvent.click(shield)
    expect(probe).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(BACKDROP_SHIELD_MS)
    })
    expect(screen.queryByTestId('qr-backdrop-shield')).not.toBeInTheDocument()
  })

  it('X-button close is instant, with no shield', () => {
    const onClose = vi.fn()

    const { container, rerender } = render(
      <TokenQrModal isOpen token="cashuAbc123" onClose={onClose} veil={false} />,
    )

    const closeButton = container.querySelector('button.rounded-full.bg-muted')
    expect(closeButton).toBeTruthy()
    fireEvent.click(closeButton as Element)
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<TokenQrModal isOpen={false} token="cashuAbc123" onClose={onClose} veil={false} />)
    expect(screen.queryByTestId('qr-backdrop-shield')).not.toBeInTheDocument()
  })
})
