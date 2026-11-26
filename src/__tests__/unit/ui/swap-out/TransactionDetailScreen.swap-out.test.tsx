import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'
import TransactionDetailScreen from '@/ui/screens/TransactionDetail/TransactionDetailScreen'

const copyMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options.amount === 'string' ? `${key}:${options.amount}` : key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ addToast: vi.fn(), balance: { total: 0 }, settings: { mints: [], mintColors: {} } }),
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: (url: string) => url,
    getMetadata: () => undefined,
    getIconUrl: () => undefined,
  }),
}))

vi.mock('@/ui/hooks/use-reclaim', () => ({
  useReclaim: () => ({ reclaim: vi.fn() }),
}))

vi.mock('@/ui/hooks/use-transaction-mgmt', () => ({
  useTransactionMgmt: () => ({ getById: vi.fn().mockResolvedValue(null), delete: vi.fn() }),
}))

vi.mock('@/ui/hooks/use-copy-feedback', () => ({
  useCopyFeedback: () => ({
    isCopied: () => false,
    isShared: () => false,
    copy: copyMock,
    share: vi.fn(),
  }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount} sats`,
  useFormatFiat: () => () => null,
  formatTransactionFiat: () => null,
  getLocaleCode: () => 'en-US',
  truncateStr: (s: string) => s,
}))

vi.mock('@/ui/hooks/useReclaimFees', () => ({
  useReclaimFees: () => ({ fees: new Map(), isLoading: false, retry: vi.fn() }),
}))

vi.mock('@/ui/screens/TransactionDetail/TokenQrModal', () => ({
  TokenQrModal: () => null,
}))

const DESTINATION = 'bc1qexampledestinationaddress0000xyz'
const PAYOUT_TX_ID = 'a'.repeat(64)

function makeSettled(): Transaction {
  return {
    id: 'payout-1',
    direction: 'send',
    method: 'swap-out',
    protocol: 'swap-out',
    amount: sat(99000),
    accountId: 'https://mint.example.com',
    status: 'settled',
    createdAt: Date.now() - 60_000,
    completedAt: Date.now(),
    fee: { quoted: sat(1500), effective: sat(1020) },
    metadata: {
      destination: DESTINATION,
      sendAmount: 100000,
      receiveAmount: 99000,
      identifier: 'npub1providerexampleidentifier',
      offerId: 'offer-1',
      payoutTxId: PAYOUT_TX_ID,
    },
  }
}

function makeFailed(): Transaction {
  return {
    ...makeSettled(),
    status: 'failed',
    amount: sat(2000),
    fee: { quoted: sat(1500), effective: sat(5) },
    metadata: {
      destination: DESTINATION,
      sendAmount: 100000,
      receiveAmount: 99000,
      identifier: 'npub1providerexampleidentifier',
      offerId: 'offer-1',
      failureReason: 'expired',
    },
  }
}

function rowValue(label: string): HTMLElement {
  const labelNode = screen.getByText(label)
  return labelNode.parentElement as HTMLElement
}

describe('TransactionDetailScreen swap-out', () => {
  it('shows destination, received amount, fee breakdown, total cost and provider for a settled payout', () => {
    render(<TransactionDetailScreen transaction={makeSettled()} onBack={vi.fn()} />)

    expect(screen.getByText('swapOut.record.sent')).toBeInTheDocument()
    expect(within(rowValue('swapOut.destination')).getByText('bc1qexampl…s0000xyz')).toBeInTheDocument()
    expect(within(rowValue('swapOut.record.receivedOnchain')).getByText('99000 sats')).toBeInTheDocument()
    expect(within(rowValue('swapOut.record.providerFees')).getByText('1000 sats')).toBeInTheDocument()
    expect(within(rowValue('swapOut.record.paymentFee')).getByText('20 sats')).toBeInTheDocument()
    expect(within(rowValue('swapOut.record.totalCost')).getByText('100020 sats')).toBeInTheDocument()
    expect(screen.getByTestId('provider-mark')).toBeInTheDocument()
    expect(screen.getByText('npub1provi…tifier')).toBeInTheDocument()
    expect(screen.queryByTestId('swap-out-loss-note')).not.toBeInTheDocument()
    expect(screen.queryByText('txDetail.failureReason')).not.toBeInTheDocument()
  })

  it('lets the destination and on-chain transaction id be copied', () => {
    render(<TransactionDetailScreen transaction={makeSettled()} onBack={vi.fn()} />)
    fireEvent.click(screen.getByText('txDetail.details'))

    expect(screen.getByText(DESTINATION)).toBeInTheDocument()
    expect(screen.getByText(PAYOUT_TX_ID)).toBeInTheDocument()

    const txIdBlock = screen.getByText('swapOut.record.payoutTxId').parentElement as HTMLElement
    fireEvent.click(within(txIdBlock).getByRole('button', { name: 'common.copy' }))
    expect(copyMock).toHaveBeenCalledWith(PAYOUT_TX_ID, 'swapOutPayoutTxId')

    const destinationBlock = screen.getAllByText('swapOut.destination')
      .map((node) => node.parentElement as HTMLElement)
      .find((block) => within(block).queryByRole('button', { name: 'common.copy' }))
    fireEvent.click(within(destinationBlock as HTMLElement).getByRole('button', { name: 'common.copy' }))
    expect(copyMock).toHaveBeenCalledWith(DESTINATION, 'swapOutDestination')
  })

  it('shows only the lost amount and a readable reason for a failed payout', () => {
    render(<TransactionDetailScreen transaction={makeFailed()} onBack={vi.fn()} />)

    expect(screen.getByText('swapOut.record.failed')).toBeInTheDocument()
    expect(within(rowValue('swapOut.record.amountSpent')).getByText('2005 sats')).toBeInTheDocument()
    expect(within(rowValue('swapOut.record.paymentFee')).getByText('5 sats')).toBeInTheDocument()
    expect(within(rowValue('txDetail.failureReason')).getByText('swapOut.failure.expired')).toBeInTheDocument()
    expect(screen.getByTestId('swap-out-loss-note')).toHaveTextContent('swapOut.record.lossNote:2005 sats')
    expect(screen.queryByText('swapOut.record.receivedOnchain')).not.toBeInTheDocument()
    expect(screen.queryByText('swapOut.record.totalCost')).not.toBeInTheDocument()
    expect(screen.queryByText('99000 sats')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('txDetail.details'))
    expect(screen.queryByText('swapOut.record.payoutTxId')).not.toBeInTheDocument()
  })
})
