import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReceiveReceiptStep, buildReceiveRows } from '@/ui/screens/Receive/steps/ReceiveReceiptStep'
import { RECEIPT_PRINT_CRAWL_MS } from '@/ui/components/payment/payment-receipt-motion'
import type { TFunction } from 'i18next'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ko' } }) }))
vi.mock('@/utils/format', () => ({ useFormatSats: () => (n: number) => `${n} sat`, useFormatFiat: () => () => null }))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({ useMintMetadata: () => ({ getDisplayName: () => 'Lemonfizz' }) }))
vi.mock('@/ui/components/payment/PaymentReceipt', () => ({
  PaymentReceipt: ({ status, onStampComplete, doneLine, stampLabel, statusLine }: { status: string; onStampComplete?: () => void; doneLine?: string; stampLabel?: string; statusLine?: string }) => (
    <div>
      <div data-testid="receipt" data-status={status}>{doneLine ? stampLabel : statusLine}</div>
      <button data-testid="finish-stamp" onClick={onStampComplete}>finish stamp</button>
    </div>
  ),
}))

const base = { amount: 1000, mintUrl: 'https://mint.a', method: 'bolt11' as const, receivedAt: 1750000000000, onExit: vi.fn() }

describe('ReceiveReceiptStep (merged)', () => {
  it('after stamp shows completed doneLine, make-another (when provided), and exit', () => {
    const onMakeAnother = vi.fn()
    render(<ReceiveReceiptStep {...base} onMakeAnother={onMakeAnother} />)
    fireEvent.click(screen.getByTestId('finish-stamp'))
    expect(screen.getByText('receive.receipt.completed')).toBeInTheDocument()
    fireEvent.click(screen.getByText('receive.request.makeAnother'))
    expect(onMakeAnother).toHaveBeenCalled()
    fireEvent.click(screen.getByText('receive.request.exit'))
    expect(base.onExit).toHaveBeenCalled()
  })

  it('prevents animated receipt overflow from creating a horizontal scrollbar', () => {
    render(<ReceiveReceiptStep {...base} />)
    const receiptScrollRegion = screen.getByTestId('receipt').closest('.overflow-y-auto')

    expect(receiptScrollRegion).toHaveClass('overflow-x-hidden')
  })

  it('hides make-another for the redeem entry', () => {
    render(<ReceiveReceiptStep {...base} method="redeem" />)
    expect(screen.queryByText('receive.request.makeAnother')).not.toBeInTheDocument()
  })

  it('runs the short print crawl before finishing, then done on stamp', () => {
    vi.useFakeTimers()
    render(<ReceiveReceiptStep {...base} />)
    expect(screen.getByTestId('receipt')).toHaveAttribute('data-status', 'printing')
    act(() => { vi.advanceTimersByTime(RECEIPT_PRINT_CRAWL_MS) })
    expect(screen.getByTestId('receipt')).toHaveAttribute('data-status', 'finishing')
    fireEvent.click(screen.getByTestId('finish-stamp'))
    expect(screen.getByTestId('receipt')).toHaveAttribute('data-status', 'done')
    vi.useRealTimers()
  })
})

describe('buildReceiveRows', () => {
  const t = ((k: string) => k) as unknown as TFunction

  it('prints the receiving fee as its own row when the mint charged one', () => {
    const rows = buildReceiveRows(t, 'redeem', 'Lemonfizz', undefined, '2 sat')
    expect(rows.at(-1)).toEqual({ label: 'txDetail.fee', value: '2 sat' })
  })

  it('prints no fee row on a fee-free arrival', () => {
    const rows = buildReceiveRows(t, 'redeem', 'Lemonfizz', undefined, null)
    expect(rows.some((r) => r.label === 'txDetail.fee')).toBe(false)
  })
})
