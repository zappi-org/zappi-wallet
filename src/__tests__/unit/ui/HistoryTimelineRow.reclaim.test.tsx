import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'

const KO: Record<string, string> = {
  'history.sent': '보냄',
  'history.reclaimed': '되찾음',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => KO[key] ?? key,
    i18n: { language: 'ko' },
  }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (amount: number) => `${amount}`,
  useFormatFiat: () => () => null,
  formatTransactionFiat: () => null,
  getLocaleCode: () => 'ko-KR',
}))

import { HistoryTimelineRow } from '@/ui/screens/History/components/HistoryTimelineRow'

function makeReclaimedSend(): Transaction {
  return {
    id: 'send-1',
    direction: 'send',
    method: 'cashu:ecash',
    protocol: 'cashu-token',
    amount: sat(1000),
    accountId: 'https://mint.example.com',
    status: 'settled',
    outcome: 'reclaimed',
    createdAt: new Date('2026-07-20T10:00:00Z').getTime(),
  }
}

// Flat redesign: no icons, direction-based labels, reclaims unsigned.
describe('HistoryTimelineRow — reclaim presentation', () => {
  it('opId shape (no companion): 되찾음 + unsigned amount', () => {
    render(
      <HistoryTimelineRow transaction={makeReclaimedSend()} groupKind="today" />,
    )

    expect(screen.getByText('되찾음')).toBeInTheDocument()
    expect(screen.getByText('1000')).toBeInTheDocument()
  })

  it('legacy shape (companion exists): 보냄 + signed amount', () => {
    render(
      <HistoryTimelineRow transaction={makeReclaimedSend()} groupKind="today" hasCompanionReceive />,
    )

    expect(screen.getByText('보냄')).toBeInTheDocument()
    expect(screen.getByText('- 1000')).toBeInTheDocument()
  })
})
