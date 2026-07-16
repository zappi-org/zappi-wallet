/**
 * transitionPhase — legal transition map. Without a guard, allowing a
 * settled→submitted regression is a real bug.
 *
 * Contract: only reject (throw) a regression from settled (funds delivered)
 * to a non-terminal phase; accept all other current legitimate transitions.
 * No new phases introduced.
 */
import { describe, it, expect } from 'vitest'
import { transitionPhase, type TransferPhase } from '@/core/domain/pending-transfer'
import type { PendingTransfer } from '@/core/domain/pending-transfer'

function makeTransfer(phase: TransferPhase): PendingTransfer {
  return {
    id: 'transfer-1',
    txId: 'tx-1',
    direction: 'outgoing',
    phase,
    finality: 'immediate',
    onExpiry: 'fail',
    amount: 21,
    transportRef: { type: 'cashu-token' },
    createdAt: 1,
    updatedAt: 1,
  } as unknown as PendingTransfer
}

const ALL_PHASES: TransferPhase[] = [
  'preparing', 'submitted', 'in_transit', 'awaiting_confirmation', 'settled', 'failed', 'recoverable',
]
const REJECTED_FROM_SETTLED = ALL_PHASES.filter((p) => p !== 'settled')

describe('transitionPhase', () => {
  it.each([
    ['preparing', 'settled', '즉시 melt'],
    ['submitted', 'settled', 'immediate finality'],
    ['recoverable', 'settled', 'reclaim'],
    ['preparing', 'submitted', '정상 진행'],
    ['submitted', 'failed', '실패 마킹'],
    ['failed', 'submitted', '재시도 계열 (현행 수용 유지)'],
    ['settled', 'settled', '멱등'],
  ] as Array<[TransferPhase, TransferPhase, string]>)(
    '%s → %s accepted (%s)',
    (from, to) => {
      const result = transitionPhase(makeTransfer(from), to, 99)
      expect(result.phase).toBe(to)
      expect(result.updatedAt).toBe(99)
    },
  )

  it.each(REJECTED_FROM_SETTLED.map((p) => [p]))(
    'settled → %s throws (no hiding the settlement record — including failed)',
    (to) => {
      expect(() => transitionPhase(makeTransfer('settled'), to, 99)).toThrow(
        /Illegal phase transition: settled/,
      )
    },
  )

  it('settled → failed is also rejected (follow-up tightening — no legitimate rollback demand, blocks failed-demotion of duplicate incoming)', () => {
    expect(() => transitionPhase(makeTransfer('settled'), 'failed', 99)).toThrow(
      /Illegal phase transition: settled/,
    )
  })
})
