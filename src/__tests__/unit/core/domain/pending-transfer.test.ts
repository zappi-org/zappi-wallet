/**
 * transitionPhase — 합법 전이 맵 (감사: 무가드 — settled→submitted 역행 허용이 실버그)
 *
 * 계약: settled(자금 전달 완료)에서 비종단으로의 역행만 거부(throw), 그 외
 * 현행 정당 전이는 전부 수용. 새 phase 도입 없음.
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
    '%s → %s 수용 (%s)',
    (from, to) => {
      const result = transitionPhase(makeTransfer(from), to, 99)
      expect(result.phase).toBe(to)
      expect(result.updatedAt).toBe(99)
    },
  )

  it.each(REJECTED_FROM_SETTLED.map((p) => [p]))(
    'settled → %s 는 throw (정산 기록의 은폐 금지 — failed 포함)',
    (to) => {
      expect(() => transitionPhase(makeTransfer('settled'), to, 99)).toThrow(
        /Illegal phase transition: settled/,
      )
    },
  )

  it('settled → failed 도 거부 (후속 조이기 — 합법 롤백 수요 없음, 중복 incoming 의 failed 강등 차단)', () => {
    expect(() => transitionPhase(makeTransfer('settled'), 'failed', 99)).toThrow(
      /Illegal phase transition: settled/,
    )
  })
})
