import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'
import TransactionDetailScreen from '@/ui/screens/TransactionDetail/TransactionDetailScreen'

const addToast = vi.fn()
const reclaimMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ addToast, balance: { total: 0 }, settings: { mints: [], mintColors: {} } }),
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: (url: string) => url,
    getMetadata: () => undefined,
    getIconUrl: () => undefined,
  }),
}))

vi.mock('@/ui/hooks/use-reclaim', () => ({
  useReclaim: () => ({ reclaim: reclaimMock }),
}))

vi.mock('@/ui/hooks/use-transaction-mgmt', () => ({
  useTransactionMgmt: () => ({ getById: vi.fn() }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount} sats`,
  useFormatFiat: () => () => null,
  formatTransactionFiat: () => null,
  getLocaleCode: () => 'en-US',
  truncateStr: (s: string) => s,
}))

vi.mock('@/ui/hooks/useReclaimFees', () => ({
  useReclaimFees: () => ({ fees: new Map([['tx-token', 2]]), isLoading: false }),
}))

vi.mock('@/ui/screens/TransactionDetail/TokenQrModal', () => ({
  TokenQrModal: () => null,
}))

function makeTokenTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-token',
    direction: 'send',
    method: 'cashu:ecash',
    protocol: 'cashu-token',
    amount: sat(1000),
    accountId: 'https://mint.test',
    status: 'pending',
    outcome: 'unclaimed',
    createdAt: Date.now(),
    metadata: {
      token: 'cashuAtoken',
      tokenState: 'unspent',
      operationId: 'op-token',
    },
    ...overrides,
  }
}

describe('TransactionDetailScreen token reclaim action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reclaimMock.mockResolvedValue({ success: true })
  })

  it('reclaims through the fee-quoted sheet and hides the CTA afterwards', async () => {
    render(<TransactionDetailScreen transaction={makeTokenTx()} onBack={vi.fn()} />)

    // CTA carries the quoted fee, opens the confirmation sheet
    fireEvent.click(screen.getByText('txDetail.reclaimWithFee'))
    fireEvent.click(screen.getByText('token.reclaim.confirm'))

    await waitFor(() => {
      expect(reclaimMock).toHaveBeenCalledWith('tx-token')
    })
    await waitFor(() => {
      expect(screen.queryByText('txDetail.reclaimWithFee')).not.toBeInTheDocument()
    })
  })

  it('does not show the reclaim CTA for an already reclaimed token send', () => {
    render(
      <TransactionDetailScreen
        transaction={makeTokenTx({
          status: 'settled',
          outcome: 'reclaimed',
        })}
        onBack={vi.fn()}
      />,
    )

    expect(screen.queryByText('txDetail.reclaimWithFee')).not.toBeInTheDocument()
  })
})
