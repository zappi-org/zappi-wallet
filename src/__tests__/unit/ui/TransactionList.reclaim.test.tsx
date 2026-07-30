import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'

const KO: Record<string, string> = {
  'history.received': '받음',
  'history.sent': '보냄',
  'history.reclaimed': '되찾음',
  'history.ecash': '이캐시',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => KO[key] ?? key,
    i18n: { language: 'ko' },
  }),
}))

vi.mock('@/ui/hooks', () => ({
  useMintMetadata: () => ({ getDisplayName: (url: string) => url }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount}`,
  useFormatFiat: () => () => null,
  formatTransactionFiat: () => null,
  getLocaleCode: () => 'ko-KR',
}))

import { TransactionList } from '@/ui/components/wallet/TransactionList'

const BASE_TIME = new Date('2026-07-20T10:00:00Z').getTime()

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx1',
    direction: 'receive',
    method: 'cashu:ecash',
    protocol: 'cashu-token',
    amount: sat(1000),
    accountId: 'https://mint.example.com',
    status: 'settled',
    createdAt: BASE_TIME,
    ...overrides,
  }
}

const legacySend = makeTx({
  id: 'send-1',
  direction: 'send',
  outcome: 'reclaimed',
  createdAt: BASE_TIME,
})
const legacyCompanion = makeTx({
  id: 'send-1-reclaim',
  direction: 'receive',
  outcome: 'reclaimed',
  createdAt: BASE_TIME + 1000,
  metadata: { reclaimedFrom: 'send-1' },
})

function amountTextOf(title: string): string {
  const row = screen.getByText(title).closest('button')
  // Last node in the row is the amount cluster; the title lives in the first.
  return row?.querySelector('.font-display')?.textContent ?? ''
}

describe('TransactionList — one 되찾음 row per reclaim', () => {
  it('opId shape: the settled reclaimed send is the 되찾음 row, unsigned', () => {
    const sendOnly = makeTx({ id: 'send-2', direction: 'send', outcome: 'reclaimed' })
    render(<TransactionList transactions={[sendOnly]} allTransactions={[sendOnly]} showHeader={false} />)

    expect(screen.getAllByText('되찾음')).toHaveLength(1)
    expect(amountTextOf('되찾음')).toBe('1000')
  })

  it('legacy shape: only the companion receive says 되찾음, the send stays a send', () => {
    const all = [legacyCompanion, legacySend]
    render(<TransactionList transactions={all} allTransactions={all} showHeader={false} />)

    expect(screen.getAllByText('되찾음')).toHaveLength(1)
    expect(screen.getByText('보냄')).toBeInTheDocument()
    expect(amountTextOf('보냄')).toBe('-1000')
  })

  // The home list shows 5 rows but holds the whole set — the companion is
  // routinely off-screen, and the send half must still read as a send.
  it('legacy shape with the companion outside the visible slice: still one 되찾음', () => {
    const all = [legacyCompanion, legacySend]
    render(
      <TransactionList
        transactions={[legacySend]}
        allTransactions={all}
        maxItems={1}
        showHeader={false}
      />,
    )

    expect(screen.queryByText('되찾음')).not.toBeInTheDocument()
    expect(amountTextOf('보냄')).toBe('-1000')
  })

  it('without a full set the visible slice decides, and the send keeps its 되찾음', () => {
    render(<TransactionList transactions={[legacySend]} maxItems={1} showHeader={false} />)

    expect(screen.getAllByText('되찾음')).toHaveLength(1)
  })
})
