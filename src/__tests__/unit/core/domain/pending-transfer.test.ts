/**
 * transitionPhase — 합법 전이 맵 (감사: 무가드 — settled→submitted 역행 허용이 실버그)
 *
 * 계약: settled(자금 전달 완료)에서 비종단으로의 역행만 거부(throw), 그 외
 * 현행 정당 전이는 전부 수용. 새 phase 도입 없음.
 */
import { describe, it, expect } from 'vitest'
import { transitionPhase, isTerminal, type TransferPhase } from '@/core/domain/pending-transfer'
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
const NON_TERMINAL = ALL_PHASES.filter((p) => !isTerminal(p))

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
    '%s → %s 수용 (%s)',
    (from, to) => {
      const result = transitionPhase(makeTransfer(from), to, 99)
      expect(result.phase).toBe(to)
      expect(result.updatedAt).toBe(99)
    },
  )

  it.each(NON_TERMINAL.map((p) => [p]))(
    'settled → %s 역행은 throw (정산 기록의 은폐 금지)',
    (to) => {
      expect(() => transitionPhase(makeTransfer('settled'), to, 99)).toThrow(
        /Illegal phase transition: settled/,
      )
    },
  )

  it('settled → failed 는 현행 수용 유지 (계획 문면: 비종단 역행만 거부)', () => {
    expect(transitionPhase(makeTransfer('settled'), 'failed', 99).phase).toBe('failed')
  })
})
