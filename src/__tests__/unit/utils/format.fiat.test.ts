/**
 * fiatToSats / satsToFiat — 금액 변환 경계값 안전망 (감사 잔여 Phase 0)
 *
 * 이후 리팩토링에서 변환 방향(round)·부호·비정상 입력 처리가 소리 없이
 * 바뀌는 회귀를 감지한다. 여기 핀은 "현재 계약"의 문서화이며,
 * NaN/Infinity 통과는 호출부(AmountInput, use-fiat-toggle)가 입력을
 * 가드한다는 전제를 명시한 것 — 바꾸려면 의식적 결정이어야 한다.
 */
import { describe, it, expect } from 'vitest'
import { fiatToSats, satsToFiat } from '@/utils/format'

const RATE = 100_000 // 1 BTC = 100,000 (임의 법정화폐) → 1 sat = 0.001

describe('fiatToSats', () => {
  it.each([
    // [fiat, rate, expected sats, 의미]
    [0, RATE, 0, '0은 0'],
    [0.001, RATE, 1, '정확히 1 sat'],
    [100_000, RATE, 100_000_000, '1 BTC 상당 → 1e8 sats'],
    [0.0004, RATE, 0, '0.4 sat → 내림 (1 sat 미만 소액 소멸)'],
    [0.0005, RATE, 1, '0.5 sat → 올림 (Math.round 반올림 방향: half-up)'],
    [0.0014, RATE, 1, '1.4 sat → 1'],
    [0.0025, RATE, 3, '2.5 sat → 3 (half-up)'],
    // 십진 half 가 항상 올림되는 것은 아니다 — 0.0015/1e5*1e8 은 이진 부동소수로
    // 1.4999...로 도달해 1 이 된다. ±1 sat 오차는 표시/입력 변환 허용 범위라는 계약.
    [0.0015, RATE, 1, '1.5 sat 이지만 float 표현상 1.4999... → 1'],
    [-0.001, RATE, -1, '부호 통과 (음수 가드는 호출부 책임)'],
  ])('fiatToSats(%s, %s) = %s — %s', (fiat, rate, expected) => {
    expect(fiatToSats(fiat, rate)).toBe(expected)
  })

  it('반환값은 항상 정수 (sat 이하 단위 없음)', () => {
    expect(Number.isInteger(fiatToSats(12.3456789, 97_531))).toBe(true)
  })

  it('round-trip: satsToFiat → fiatToSats 는 원래 sat 값을 복원한다', () => {
    for (const sats of [1, 21, 12_345, 99_999_999]) {
      expect(fiatToSats(satsToFiat(sats, 97_531), 97_531)).toBe(sats)
    }
  })

  it('[현재 계약] 비정상 입력은 그대로 전파된다 — 호출부 가드 전제', () => {
    expect(fiatToSats(NaN, RATE)).toBeNaN()
    expect(fiatToSats(1, NaN)).toBeNaN()
    expect(fiatToSats(1, 0)).toBe(Infinity)
  })
})

describe('satsToFiat', () => {
  it('1 sat → rate/1e8', () => {
    expect(satsToFiat(1, RATE)).toBeCloseTo(0.001, 10)
  })

  it('0 sat → 0', () => {
    expect(satsToFiat(0, RATE)).toBe(0)
  })

  it('1e8 sats(1 BTC) → rate 그대로', () => {
    expect(satsToFiat(100_000_000, RATE)).toBeCloseTo(RATE, 6)
  })

  it('[현재 계약] 반올림하지 않는다 — 표시 반올림은 formatFiatAmount 책임', () => {
    // 21 sats @ 100k = 0.021 — 소수 그대로 반환되어야 표시 계층이 통화별 자릿수를 결정할 수 있다
    expect(satsToFiat(21, RATE)).toBeCloseTo(0.021, 10)
  })
})
