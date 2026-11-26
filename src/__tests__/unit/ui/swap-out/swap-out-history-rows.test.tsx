import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount}`,
  useFormatFiat: () => () => null,
  formatTransactionFiat: () => null,
  getLocaleCode: () => 'en-US',
}))

import { HistoryTimelineRow } from '@/ui/screens/History/components/HistoryTimelineRow'
import { TransactionRow } from '@/ui/components/wallet/TransactionRow'
import { HomeRecentCard } from '@/ui/components/wallet/HomeRecentCard'
import { swapOutToRecentRow, toRecentRow } from '@/ui/components/wallet/homeRecentRow'
import { getTypeLabel } from '@/ui/components/wallet/transactionHelpers'
import {
  isListedInHistory,
  isShownAsPendingPayout,
  withoutPendingPayouts,
} from '@/ui/utils/swap-out-transaction'
import type { SwapOutView } from '@/core/ports/driving/swap-out.usecase'

const t = ((key: string) => key) as unknown as TFunction
const DESTINATION = 'bc1qexampledestinationaddress0000xyz'
const SHORT_DESTINATION = 'bc1qexampl…s0000xyz'

function makeSwapOutTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'payout-1',
    direction: 'send',
    method: 'swap-out',
    protocol: 'swap-out',
    amount: sat(99000),
    accountId: 'https://mint.example.com',
    status: 'settled',
    createdAt: new Date('2026-11-20T10:00:00Z').getTime(),
    completedAt: new Date('2026-11-20T10:30:00Z').getTime(),
    fee: { quoted: sat(1500), effective: sat(1020) },
    metadata: {
      destination: DESTINATION,
      sendAmount: 100000,
      receiveAmount: 99000,
      identifier: 'npub1providerexampleidentifier',
      offerId: 'offer-1',
      payoutTxId: 'f'.repeat(64),
    },
    ...overrides,
  }
}

function makeFailedSwapOutTx(): Transaction {
  return makeSwapOutTx({
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
  })
}

const pendingPayout: SwapOutView = {
  id: 'payout-1',
  mintUrl: 'https://mint.example.com',
  offerId: 'offer-1',
  identifier: 'npub1providerexampleidentifier',
  destination: DESTINATION,
  sendAmount: 100000,
  receiveAmount: 99000,
  stage: 'sweeping',
  phase: 'awaiting_confirmation',
  payoutTxId: null,
  failureReason: null,
  hasOpenPayments: true,
  deadline: { blockHeight: 209, estimatedAt: Date.now() + 3600_000 },
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

describe('swap-out rows in history', () => {
  it('labels the means as an on-chain send', () => {
    expect(getTypeLabel(makeSwapOutTx(), t)).toBe('swapOut.record.typeLabel')
  })

  it('renders a settled swap-out timeline row with the shortened destination and total cost', () => {
    render(<HistoryTimelineRow transaction={makeSwapOutTx()} groupKind="today" />)
    expect(screen.getByText('swapOut.record.sent')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(SHORT_DESTINATION))).toBeInTheDocument()
    expect(screen.getByText('- 100020')).toBeInTheDocument()
  })

  it('renders a failed swap-out timeline row with the lost amount unstruck', () => {
    render(<HistoryTimelineRow transaction={makeFailedSwapOutTx()} groupKind="today" />)
    expect(screen.getByText('swapOut.record.failed')).toBeInTheDocument()
    const amount = screen.getByText('- 2005')
    expect(amount.className).not.toContain('line-through')
  })

  it('renders a pending swap-out list row with the sending label and destination subtitle', () => {
    render(<TransactionRow transaction={makeSwapOutTx({ status: 'pending', fee: { quoted: sat(1500) } })} />)
    expect(screen.getByText('swapOut.record.sending')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(SHORT_DESTINATION))).toBeInTheDocument()
    expect(screen.getByText('-100500')).toBeInTheDocument()
  })
})

describe('swap-out home recent row', () => {
  it('maps a settled swap-out to an on-chain row titled with the destination', () => {
    const row = toRecentRow(makeSwapOutTx(), t)
    expect(row).toMatchObject({
      title: `swapOut.record.sent · ${SHORT_DESTINATION}`,
      amountSats: 100020,
      isReceive: false,
      state: 'settled',
      icon: 'onchain',
      lost: false,
    })
  })

  it('maps a failed swap-out to a failed row carrying only what was lost', () => {
    const row = toRecentRow(makeFailedSwapOutTx(), t)
    expect(row).toMatchObject({ state: 'failed', amountSats: 2005, lost: true, icon: 'onchain' })
  })

  it('marks the in-progress payout row as on-chain too', () => {
    expect(swapOutToRecentRow(pendingPayout, t).icon).toBe('onchain')
  })

  it('draws the on-chain icon on the home card', () => {
    render(<HomeRecentCard row={toRecentRow(makeSwapOutTx(), t)} />)
    expect(screen.getByTestId('home-recent-onchain-icon')).toBeInTheDocument()
    expect(screen.getByText(`swapOut.record.sent · ${SHORT_DESTINATION}`)).toBeInTheDocument()
  })
})

describe('swap-out duplicate rule', () => {
  const lightningSend: Transaction = {
    id: 'payout-1',
    direction: 'send',
    method: 'cashu:lightning',
    protocol: 'bolt11',
    amount: sat(10),
    accountId: 'https://mint.example.com',
    status: 'pending',
    createdAt: Date.now(),
  }

  it('hides a swap-out transaction while its payout is shown as pending', () => {
    const pendingTx = makeSwapOutTx({ status: 'pending' })
    const other = makeSwapOutTx({ id: 'payout-2' })
    const ids = new Set([pendingPayout.id])
    expect(isShownAsPendingPayout(pendingTx, ids)).toBe(true)
    expect(withoutPendingPayouts([pendingTx, other, lightningSend], ids)).toEqual([other, lightningSend])
  })

  it('shows the swap-out transaction again once no payout is pending', () => {
    const settled = makeSwapOutTx()
    expect(withoutPendingPayouts([settled], new Set())).toEqual([settled])
  })

  it('lists settled swap-outs and failed ones that cost money in history, never pending ones', () => {
    expect(isListedInHistory(makeSwapOutTx())).toBe(true)
    expect(isListedInHistory(makeFailedSwapOutTx())).toBe(true)
    expect(isListedInHistory(makeSwapOutTx({ status: 'pending', fee: { quoted: sat(1500) } }))).toBe(false)
    expect(
      isListedInHistory(
        makeSwapOutTx({ status: 'failed', amount: sat(0), fee: { quoted: sat(1500), effective: sat(0) } }),
      ),
    ).toBe(false)
    expect(isListedInHistory({ ...lightningSend, status: 'failed' })).toBe(false)
  })
})
