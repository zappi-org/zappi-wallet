import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'
import { TransactionRow } from '@/ui/components/wallet/TransactionRow'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount} sats`,
  useFormatFiat: () => () => null,
  formatTransactionFiat: () => null,
  getLocaleCode: () => 'en-US',
}))

function makeSwapTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx1',
    direction: 'send',
    method: 'cashu:lightning',
    protocol: 'bolt11',
    intent: 'swap',
    amount: sat(100),
    accountId: 'https://source.mint',
    status: 'settled',
    createdAt: new Date('2026-04-24T00:00:00Z').getTime(),
    metadata: {
      fromMintUrl: 'https://source.mint',
      toMintUrl: 'https://target.mint',
    },
    ...overrides,
  }
}

const getMintName = (url: string) => {
  if (url === 'https://source.mint') return 'Source Mint'
  if (url === 'https://target.mint') return 'Target Mint'
  return url
}

describe('TransactionRow', () => {
  it('renders the full swap route when both mints are known', () => {
    render(<TransactionRow transaction={makeSwapTx()} getMintName={getMintName} />)

    expect(screen.getByText(/Source Mint → Target Mint/)).toBeInTheDocument()
    expect(screen.getByText(/history.swap/)).toBeInTheDocument()
  })

  it('renders the same swap route for the target-side receive transaction', () => {
    render(
      <TransactionRow
        transaction={makeSwapTx({
          id: 'tx2',
          direction: 'receive',
          accountId: 'https://target.mint',
        })}
        getMintName={getMintName}
      />,
    )

    expect(screen.getByText(/Source Mint → Target Mint/)).toBeInTheDocument()
    expect(screen.getByText(/history.swap/)).toBeInTheDocument()
  })

  it('recovers the swap route from the linked transaction when source metadata was partially overwritten', () => {
    const targetTx = makeSwapTx({
      id: 'target-tx',
      direction: 'receive',
      accountId: 'https://target.mint',
    })
    const sourceTx = makeSwapTx({
      id: 'source-tx',
      linkedTxId: 'target-tx',
      metadata: { fee: 2 },
    })

    render(<TransactionRow transaction={sourceTx} linkedTransaction={targetTx} getMintName={getMintName} />)

    expect(screen.getByText(/Source Mint → Target Mint/)).toBeInTheDocument()
    expect(screen.getByText(/history.swap/)).toBeInTheDocument()
  })

  it('does not render a dangling swap route when the target mint is missing', () => {
    render(
      <TransactionRow
        transaction={makeSwapTx({ metadata: { fromMintUrl: 'https://source.mint' } })}
        getMintName={getMintName}
      />,
    )

    const rowText = screen.getByRole('button').textContent ?? ''
    expect(rowText).toContain('history.swap')
    expect(rowText).not.toContain('Source Mint →')
  })
})
