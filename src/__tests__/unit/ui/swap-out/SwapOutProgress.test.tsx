import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useAppStore } from '@/store'
import { SwapOutProgressModal } from '@/ui/screens/SwapOut/SwapOutProgress'
import type { SwapOutView } from '@/core/ports/driving/swap-out.usecase'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

function view(patch: Partial<SwapOutView> = {}): SwapOutView {
  return {
    id: 'payout-1',
    mintUrl: 'https://mint.example.com',
    offerId: 'fake:offer-1',
    identifier: 'npub1fake',
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

describe('SwapOutProgressModal', () => {
  beforeEach(() => {
    useAppStore.getState().resetSwapOuts()
  })

  it('follows the live payout in the store while open', () => {
    useAppStore.getState().setSwapOuts([view()])
    render(<SwapOutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByText('swapOut.stage.funded')).toBeInTheDocument()

    act(() => {
      useAppStore.getState().upsertSwapOut(
        view({ stage: 'sweeping', phase: 'awaiting_confirmation', payoutTxId: 'tx-live' }),
      )
    })
    expect(screen.getByText('swapOut.stage.sweeping')).toBeInTheDocument()
    expect(screen.getByText('tx-live')).toBeInTheDocument()
  })

  it('renders nothing when no payout is selected', () => {
    useAppStore.getState().setSwapOuts([view()])
    render(<SwapOutProgressModal payoutId={null} onClose={() => {}} />)
    expect(screen.queryByText('swapOut.stage.funded')).not.toBeInTheDocument()
  })

  it('translates known failure codes and falls back for unknown ones', () => {
    useAppStore.getState().setSwapOuts([view({ failureReason: 'fee_too_high' })])
    const { unmount } = render(<SwapOutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByTestId('swap-out-failure')).toHaveTextContent('swapOut.failure.feeTooHigh')
    expect(screen.queryByText('fee_too_high')).not.toBeInTheDocument()
    unmount()

    useAppStore.getState().setSwapOuts([view({ stage: 'aborted', failureReason: 'something_new' })])
    render(<SwapOutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByTestId('swap-out-failure')).toHaveTextContent('swapOut.failure.unknown')
  })

  it('shows a failure reason only when it applies to the current stage', () => {
    useAppStore.getState().setSwapOuts([
      view({ stage: 'completed', phase: 'settled', failureReason: 'fee_too_high', payoutTxId: 'tx-done' }),
    ])
    const completed = render(<SwapOutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.queryByTestId('swap-out-failure')).not.toBeInTheDocument()
    completed.unmount()

    useAppStore.getState().setSwapOuts([
      view({ stage: 'sweeping', phase: 'awaiting_confirmation', failureReason: 'fee_too_high' }),
    ])
    const sweeping = render(<SwapOutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.queryByTestId('swap-out-failure')).not.toBeInTheDocument()
    sweeping.unmount()

    useAppStore.getState().setSwapOuts([
      view({ stage: 'refunded', phase: 'failed', failureReason: 'spent_by_provider' }),
    ])
    const refunded = render(<SwapOutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByTestId('swap-out-failure')).toHaveTextContent('swapOut.failure.reclaimed')
    refunded.unmount()

    useAppStore.getState().setSwapOuts([view({ stage: 'funded', failureReason: 'fee_too_high' })])
    render(<SwapOutProgressModal payoutId="payout-1" onClose={() => {}} />)
    expect(screen.getByTestId('swap-out-failure')).toHaveTextContent('swapOut.failure.feeTooHigh')
  })
})
