import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PendingItemsList } from '@/ui/components/wallet/PendingItemsList'
import type { OnchainPayoutView } from '@/core/ports/driving/onchain-payout.usecase'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

const payout: OnchainPayoutView = {
  id: 'payout-1',
  mintUrl: 'https://mint.example.com',
  offerId: 'fake:offer-1',
  identifier: 'npub1fake',
  destination: 'bcrt1qdestination',
  sendAmount: 100000,
  receiveAmount: 99000,
  stage: 'sweeping',
  phase: 'awaiting_confirmation',
  payoutTxId: 'tx-1',
  failureReason: null,
  hasOpenPayments: true,
  deadline: { blockHeight: 209, estimatedAt: Date.now() + 3600_000 },
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

describe('PendingItemsList payout rows', () => {
  it('renders an active payout row and opens it on tap', () => {
    const onPayoutClick = vi.fn()
    render(
      <PendingItemsList
        items={[]}
        payouts={[payout]}
        onPayoutClick={onPayoutClick}
      />,
    )
    const title = screen.getAllByText('onchainPayout.pendingTitle')[0]
    expect(title).toBeInTheDocument()
    fireEvent.click(title)
    expect(onPayoutClick).toHaveBeenCalledWith(payout)
  })

  it('shows the amount sent, the same amount the home row uses', () => {
    render(<PendingItemsList items={[]} payouts={[payout]} />)
    expect(screen.getByText(/100,000/)).toBeInTheDocument()
    expect(screen.queryByText(/99,000/)).not.toBeInTheDocument()
  })
})
