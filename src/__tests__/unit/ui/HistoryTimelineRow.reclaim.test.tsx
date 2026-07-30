import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'

const KO: Record<string, string> = {
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

function iconNameOf(container: HTMLElement): string {
  return container.querySelector('svg')?.getAttribute('class') ?? ''
}

// Label, icon and amount presentation must all key off the same predicate —
// a row saying 보냄 next to an Undo2 icon would be worse than either alone.
describe('HistoryTimelineRow — reclaim presentation is one decision', () => {
  it('opId shape (no companion): 되찾음 + Undo2 + unsigned muted amount', () => {
    const { container } = render(
      <HistoryTimelineRow transaction={makeReclaimedSend()} groupKind="today" />,
    )

    expect(screen.getByText('되찾음')).toBeInTheDocument()
    expect(iconNameOf(container)).toContain('undo')
    const amount = screen.getByText('1000')
    expect(amount.className).toContain('text-foreground-muted')
  })

  it('legacy shape (companion exists): 보냄 + directional icon + signed amount', () => {
    const { container } = render(
      <HistoryTimelineRow transaction={makeReclaimedSend()} groupKind="today" hasCompanionReceive />,
    )

    expect(screen.getByText('보냄')).toBeInTheDocument()
    expect(iconNameOf(container)).not.toContain('undo')
    expect(screen.getByText('- 1000')).toBeInTheDocument()
  })
})
