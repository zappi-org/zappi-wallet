import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReceiveReceiptStep } from '@/ui/screens/Receive/steps/ReceiveReceiptStep'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ko' } }) }))
vi.mock('@/utils/format', () => ({ useFormatSats: () => (n: number) => `${n} sat`, useFormatFiat: () => () => null }))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({ useMintMetadata: () => ({ getDisplayName: () => 'Lemonfizz' }) }))
// Stub the receipt so the stamp resolves immediately (jsdom has no animation).
// Fired from an effect, not the render body, to keep React's console clean.
vi.mock('@/ui/components/payment/PaymentReceipt', async () => {
  const { useEffect } = await import('react')
  return {
    PaymentReceipt: ({ onStampComplete, doneLine, statusLine }: { onStampComplete?: () => void; doneLine?: { right: string }; statusLine?: string }) => {
      useEffect(() => { onStampComplete?.() }, [onStampComplete])
      return <div data-testid="receipt">{doneLine ? doneLine.right : statusLine}</div>
    },
  }
})

const base = { amount: 1000, mintUrl: 'https://mint.a', method: 'bolt11' as const, receivedAt: 1750000000000, onExit: vi.fn() }

describe('ReceiveReceiptStep (merged)', () => {
  it('after stamp shows completed doneLine, make-another (when provided), and exit', () => {
    const onMakeAnother = vi.fn()
    render(<ReceiveReceiptStep {...base} onMakeAnother={onMakeAnother} />)
    expect(screen.getByText('receive.receipt.completed')).toBeInTheDocument()
    fireEvent.click(screen.getByText('receive.request.makeAnother'))
    expect(onMakeAnother).toHaveBeenCalled()
    fireEvent.click(screen.getByText('receive.request.exit'))
    expect(base.onExit).toHaveBeenCalled()
  })

  it('hides make-another for the redeem entry', () => {
    render(<ReceiveReceiptStep {...base} method="redeem" />)
    expect(screen.queryByText('receive.request.makeAnother')).not.toBeInTheDocument()
  })
})
