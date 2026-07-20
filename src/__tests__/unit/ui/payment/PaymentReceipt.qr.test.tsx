import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PaymentReceipt } from '@/ui/components/payment/PaymentReceipt'

const base = {
  status: 'finishing' as const,
  title: 'RECEIPT',
  amount: '₿1,000',
  rows: [{ label: 'Mint', value: 'Lemonfizz' }],
}

// The receipt takes a pre-rendered QR node (contract keeps the QR library
// out of the receipt's import chain), so a plain stub stands in for it.
const qrStub = <div data-testid="qr-stub">cashuAxyz</div>

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
