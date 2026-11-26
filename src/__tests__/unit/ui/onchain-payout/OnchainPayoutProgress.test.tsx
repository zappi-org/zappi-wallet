import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useAppStore } from '@/store'
import { OnchainPayoutProgressModal } from '@/ui/screens/OnchainPayout/OnchainPayoutProgress'
import type { OnchainPayoutView } from '@/core/ports/driving/onchain-payout.usecase'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

function view(patch: Partial<OnchainPayoutView> = {}): OnchainPayoutView {
  return {
    id: 'payout-1',
    mintUrl: 'https://mint.example.com',
    destination: 'bcrt1qdestination',
    sendAmount: 100000,
    receiveAmount: 99000,
    stage: 'funded',
    phase: 'in_transit',
    payoutTxId: null,
    failureReason: null,
    hasOpenPayments: false,
    deadline: { blockHeight: 209, estimatedAt: Date.now() + 3600_000 },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

describe('OnchainPayoutProgressModal', () => {
  beforeEach(() => {
    useAppStore.getState().resetOnchainPayouts()
  })

  it('follows the live payout in the store while open', () => {
    useAppStore.getState().setOnchainPayouts([view()])
    render(<OnchainPayoutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByText('onchainPayout.stage.funded')).toBeInTheDocument()

    act(() => {
      useAppStore.getState().upsertOnchainPayout(
        view({ stage: 'sweeping', phase: 'awaiting_confirmation', payoutTxId: 'tx-live' }),
      )
    })
    expect(screen.getByText('onchainPayout.stage.sweeping')).toBeInTheDocument()
    expect(screen.getByText('tx-live')).toBeInTheDocument()
  })

  it('renders nothing when no payout is selected', () => {
    useAppStore.getState().setOnchainPayouts([view()])
    render(<OnchainPayoutProgressModal payoutId={null} onClose={() => {}} />)
    expect(screen.queryByText('onchainPayout.stage.funded')).not.toBeInTheDocument()
  })

  it('translates known failure codes and falls back for unknown ones', () => {
    useAppStore.getState().setOnchainPayouts([view({ failureReason: 'fee_too_high' })])
    const { unmount } = render(<OnchainPayoutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByTestId('onchain-payout-failure')).toHaveTextContent('onchainPayout.failure.feeTooHigh')
    expect(screen.queryByText('fee_too_high')).not.toBeInTheDocument()
    unmount()

    useAppStore.getState().setOnchainPayouts([view({ stage: 'aborted', failureReason: 'something_new' })])
    render(<OnchainPayoutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByTestId('onchain-payout-failure')).toHaveTextContent('onchainPayout.failure.unknown')
  })

  it('shows a failure reason only when it applies to the current stage', () => {
    useAppStore.getState().setOnchainPayouts([
      view({ stage: 'completed', phase: 'settled', failureReason: 'fee_too_high', payoutTxId: 'tx-done' }),
    ])
    const completed = render(<OnchainPayoutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.queryByTestId('onchain-payout-failure')).not.toBeInTheDocument()
    completed.unmount()

    useAppStore.getState().setOnchainPayouts([
      view({ stage: 'sweeping', phase: 'awaiting_confirmation', failureReason: 'fee_too_high' }),
    ])
    const sweeping = render(<OnchainPayoutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.queryByTestId('onchain-payout-failure')).not.toBeInTheDocument()
    sweeping.unmount()

    useAppStore.getState().setOnchainPayouts([
      view({ stage: 'refunded', phase: 'failed', failureReason: 'spent_by_provider' }),
    ])
    const refunded = render(<OnchainPayoutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByTestId('onchain-payout-failure')).toHaveTextContent('onchainPayout.failure.reclaimed')
    refunded.unmount()

    useAppStore.getState().setOnchainPayouts([view({ stage: 'funded', failureReason: 'fee_too_high' })])
    render(<OnchainPayoutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByTestId('onchain-payout-failure')).toHaveTextContent('onchainPayout.failure.feeTooHigh')
  })
})
