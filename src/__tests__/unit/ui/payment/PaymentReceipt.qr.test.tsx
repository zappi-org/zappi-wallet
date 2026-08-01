import { render, screen, fireEvent, act } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { PaymentReceipt } from '@/ui/components/payment/PaymentReceipt'
import { shouldStartReceiptTorn } from '@/ui/components/payment/payment-receipt-motion'

interface AnimationHarness {
  animation: Animation
  resolve: () => void
}

const animationHarnesses: AnimationHarness[] = []
const animateMock = vi.fn(() => {
  let resolve = () => {}
  const finished = new Promise<void>((done) => { resolve = done })
  const animation = {
    cancel: vi.fn(),
    finished,
  } as unknown as Animation
  animationHarnesses.push({ animation, resolve })
  return animation
})

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: animateMock,
})

const base = {
  status: 'finishing' as const,
  title: 'RECEIPT',
  amount: '₿1,000',
  rows: [{ label: 'Mint', value: 'Lemonfizz' }],
}

// The receipt takes a pre-rendered QR node (contract keeps the QR library
// out of the receipt's import chain), so a plain stub stands in for it.
const qrStub = <div data-testid="qr-stub">cashuAxyz</div>

beforeEach(() => {
  animationHarnesses.length = 0
  animateMock.mockClear()
})

describe('PaymentReceipt paper motion', () => {
  it('prints with full compositor transform keyframes and one continuous easing', () => {
    render(<PaymentReceipt {...base} status="printing" />)

    expect(animateMock).toHaveBeenCalledWith(
      [
        { transform: 'translate3d(0, -101%, 0)' },
        { transform: 'translate3d(0, -7%, 0)' },
      ],
      {
        duration: 8000,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        fill: 'forwards',
      },
    )
  })

  it('retargets an early success from the current paper position before stamping', async () => {
    const computedStyle = vi.spyOn(window, 'getComputedStyle')
    computedStyle.mockReturnValue({ transform: 'matrix(1, 0, 0, 1, 0, -240)' } as CSSStyleDeclaration)
    const { rerender } = render(
      <PaymentReceipt {...base} status="printing" stampSrc="/seal.png" stampLabel="전송 완료" />,
    )

    rerender(<PaymentReceipt {...base} status="finishing" stampSrc="/seal.png" stampLabel="전송 완료" />)

    expect(animateMock).toHaveBeenLastCalledWith(
      [
        { transform: 'matrix(1, 0, 0, 1, 0, -240)' },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      {
        duration: 320,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        fill: 'forwards',
      },
    )
    expect(screen.queryByText('전송 완료')).not.toBeInTheDocument()

    await act(async () => animationHarnesses.at(-1)?.resolve())

    expect(screen.getByText('전송 완료')).toBeInTheDocument()
    computedStyle.mockRestore()
  })

  it('finishes and tears a receipt that mounts directly in the finishing state', async () => {
    render(<PaymentReceipt {...base} status="finishing" stampSrc="/seal.png" stampLabel="전송 완료" />)

    expect(screen.queryByText('전송 완료')).not.toBeInTheDocument()
    await act(async () => animationHarnesses.at(-1)?.resolve())

    expect(screen.getByText('전송 완료')).toBeInTheDocument()
  })

  it('uses CSS opacity loops for the printing status dots', () => {
    render(<PaymentReceipt {...base} status="printing" statusLine="전송 중" />)

    const dots = screen.getAllByText('.')
    expect(dots).toHaveLength(3)
    for (const dot of dots) expect(dot).toHaveClass('receipt-status-dot--active')
  })

  it('starts a finishing receipt torn when the Web Animations API is unavailable', () => {
    expect(shouldStartReceiptTorn('finishing', false)).toBe(true)
    expect(shouldStartReceiptTorn('finishing', true)).toBe(false)
  })
})

describe('PaymentReceipt QR slot', () => {
  it('renders the provided QR node when qr is set', () => {
    render(<PaymentReceipt {...base} qr={qrStub} />)
    expect(screen.getByTestId('qr-stub')).toHaveTextContent('cashuAxyz')
  })

  it('shows the reveal hint while veiled and toggles on tap', () => {
    const onToggleQr = vi.fn()
    render(<PaymentReceipt {...base} qr={qrStub} qrVeiled qrRevealLabel="tap to reveal" onToggleQr={onToggleQr} />)
    expect(screen.getByText('tap to reveal')).toBeInTheDocument()
    fireEvent.click(screen.getByText('tap to reveal').closest('button')!)
    expect(onToggleQr).toHaveBeenCalled()
  })

  it('renders no QR block when qr is absent', () => {
    render(<PaymentReceipt {...base} />)
    expect(screen.queryByTestId('qr-stub')).not.toBeInTheDocument()
  })
})

describe('PaymentReceipt stamp label and bottom line', () => {
  it('prints the stamp label on the seal', () => {
    render(<PaymentReceipt {...base} status="done" stampSrc="/seal.png" stampLabel="전송 완료" />)
    expect(screen.getByText('전송 완료')).toBeInTheDocument()
  })

  it('keeps a bottom line through finishing (statusLine) → done (doneLine)', () => {
    const { rerender } = render(<PaymentReceipt {...base} status="finishing" statusLine="전송 중" />)
    expect(screen.getByText('전송 중')).toBeInTheDocument()
    rerender(<PaymentReceipt {...base} status="done" doneLine="7/29 15:00" />)
    expect(screen.getByText('7/29 15:00')).toBeInTheDocument()
  })

  it('prints no bottom rule at all when neither line is given', () => {
    const { container: withLine } = render(<PaymentReceipt {...base} status="done" doneLine="7/29 15:00" />)
    const { container: without } = render(<PaymentReceipt {...base} status="done" />)
    expect(without.querySelectorAll('.border-dashed').length).toBe(
      withLine.querySelectorAll('.border-dashed').length - 1,
    )
  })

  it('prints the timeline above the rows', () => {
    render(<PaymentReceipt {...base} timeline={<div data-testid="timeline" />} />)
    const position = screen.getByTestId('timeline').compareDocumentPosition(screen.getByText('Mint'))
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// Receipt vertical stability: the finishing→done transition must not change the
// receipt's height, or the my-auto-centered receipt visibly jumps on stamp.
describe('PaymentReceipt slot-space reservation', () => {
  it('keeps the printer-slot height reserved through finishing→done', () => {
    const { rerender } = render(<PaymentReceipt {...base} status="finishing" />)
    rerender(<PaymentReceipt {...base} status="done" />)
    expect(screen.getByTestId('receipt-slot')).toBeInTheDocument()
  })

  it('reserves no slot height for a standalone done receipt (never had a slot)', () => {
    render(<PaymentReceipt {...base} status="done" />)
    expect(screen.queryByTestId('receipt-slot')).not.toBeInTheDocument()
  })
})
