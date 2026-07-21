import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DirectReceiptStep } from '@/ui/screens/Send/steps/DirectReceiptStep'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ko' } }) }))
vi.mock('@/utils/format', () => ({
  useFormatSats: () => (n: number) => `${n} sat`,
  useFormatFiat: () => () => null,
}))
vi.mock('@/ui/hooks/use-mint-metadata', () => ({ useMintMetadata: () => ({ getDisplayName: () => 'Lemonfizz' }) }))
vi.mock('@/ui/hooks/use-own-payment-event', () => ({ useOwnPaymentEvent: vi.fn() }))
// Drive the claim signal from the test.
let claimCb: (() => void) | undefined
vi.mock('@/ui/hooks/use-send-claimed', () => ({ useSendClaimed: (_id: unknown, cb: () => void) => { claimCb = cb } }))
// QRCodeDisplay pulls in bc-ur -> cborg, whose package.json exports map
// vitest/vite can't resolve — mock the component to keep that import out.
vi.mock('@/ui/components/common/QRCodeDisplay', () => ({ QRCodeDisplay: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }))

const base = {
  amount: 1000, memo: '', mintUrl: 'https://mint.a', tokenString: 'cashuAxyz',
  txId: 'tx1', onExit: vi.fn(), onReclaim: vi.fn(),
}

describe('DirectReceiptStep', () => {
  it('pre-claim shows awaiting status, the token QR, and reclaim + exit', () => {
    render(<DirectReceiptStep {...base} />)
    expect(screen.getByText('send.direct.awaitingClaim')).toBeInTheDocument()
    expect(screen.getByTestId('qr')).toHaveTextContent('cashuAxyz')
    expect(screen.getByText('send.tokenCreate.reclaim')).toBeInTheDocument()
  })

  it('stamps and collapses to exit-only once the token is claimed', () => {
    const onExit = vi.fn()
    render(<DirectReceiptStep {...base} onExit={onExit} />)
    act(() => claimCb?.())
    expect(screen.getByText('send.direct.claimed')).toBeInTheDocument()
    // Reclaim is hidden + inert after the claim (kept in the layout only to
    // reserve its footprint so the receipt above doesn't drop).
    const reclaim = screen.getByText('send.tokenCreate.reclaim')
    expect(reclaim).toHaveAttribute('aria-hidden', 'true')
    expect(reclaim).toBeDisabled()
    fireEvent.click(screen.getByText('common.confirm'))
    expect(onExit).toHaveBeenCalled()
  })
})
