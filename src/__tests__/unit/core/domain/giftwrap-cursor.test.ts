import { describe, it, expect } from 'vitest'
import {
  GIFTWRAP_OVERLAP_SEC,
  NIP59_RANDOMIZATION_SEC,
  CLOCK_SKEW_MARGIN_SEC,
  createGiftwrapCursorRecord,
  giftwrapCursorKey,
  shouldDeepResync,
  sinceForCatchUp,
  sinceForDeepResync,
  sinceForRelay,
  toSinceSec,
  DEEP_RESYNC_INTERVAL_MS,
  type GiftwrapCursorRecord,
} from '@/core/domain/giftwrap-cursor'

const DAY_MS = 24 * 60 * 60 * 1000
const D0 = 1_750_000_000_000
const day = (n: number) => D0 + n * DAY_MS

function record(overrides: Partial<GiftwrapCursorRecord> = {}): GiftwrapCursorRecord {
  return { ...createGiftwrapCursorRecord('giftwrap:abcd1234', D0), ...overrides }
}

describe('giftwrap-cursor domain', () => {
  it('overlap = NIP-59 randomization bound + clock-skew margin (constants stay distinct)', () => {
    expect(NIP59_RANDOMIZATION_SEC).toBe(172_800)
    expect(CLOCK_SKEW_MARGIN_SEC).toBe(21_600)
    expect(GIFTWRAP_OVERLAP_SEC).toBe(194_400)
  })

  it('giftwrapCursorKey is pubkey-scoped', () => {
    expect(giftwrapCursorKey('a'.repeat(64))).toBe('giftwrap:aaaaaaaa')
  })

  it('toSinceSec floors ms to seconds', () => {
    expect(toSinceSec(1_750_000_000_999)).toBe(1_750_000_000)
  })

  describe('sinceForCatchUp (2단계 단일 since)', () => {
    it('is undefined with no record (최초 1회 전체 replay)', () => {
      expect(sinceForCatchUp(null)).toBeUndefined()
    })

    it('is undefined while lastFullSyncAtMs is 0 (아직 전체 EOSE 없음)', () => {
      expect(sinceForCatchUp(record({ lastFullSyncAtMs: 0 }))).toBeUndefined()
    })

    it('applies the overlap window to lastFullSyncAtMs', () => {
      const r = record({ lastFullSyncAtMs: day(10) })
      expect(sinceForCatchUp(r)).toBe(toSinceSec(day(10)) - GIFTWRAP_OVERLAP_SEC)
    })

    /**
     * [N1] timeout은 since를 전진시키지 않는다 — lastAttemptAtMs가 아무리 최신이어도
     * catch-up 창은 lastFullSyncAtMs 기준이다.
     */
    it('ignores lastAttemptAtMs entirely', () => {
      const r = record({ lastFullSyncAtMs: day(1), lastAttemptAtMs: day(10) })
      expect(sinceForCatchUp(r)).toBe(toSinceSec(day(1)) - GIFTWRAP_OVERLAP_SEC)
    })

    it('clamps to 0 for very old sync times', () => {
      const r = record({ lastFullSyncAtMs: 1_000 })
      expect(sinceForCatchUp(r)).toBe(0)
    })
  })

  describe('sinceForRelay (규칙의 정본 — 6단계 소비)', () => {
    /**
     * [N1] D0/D10 반례 고정: D0 전체동기 → relay C 다운 → D1에 C에만 존재하는
     * 이벤트 → D10 복귀. C의 since는 C 자신의 마지막 EOSE(D0) 기준이어야 하며,
     * 다른 relay들의 진행(D10)은 절대 섞이지 않는다. max(전역커서, ...)류 공식은
     * D7.75부터 조회해 D1 이벤트를 유실한다.
     */
    it('D0/D10 relay-outage timeline: down relay backfills from ITS OWN last EOSE', () => {
      const r = record({
        lastFullSyncAtMs: day(10), // 가정: 어떤 이유로든 전역 값이 전진했다 해도
        relayEoseAtMs: { 'wss://a': day(10), 'wss://b': day(10), 'wss://c': day(0) },
      })

      expect(sinceForRelay(r, 'wss://c')).toBe(toSinceSec(day(0)) - GIFTWRAP_OVERLAP_SEC)
      expect(sinceForRelay(r, 'wss://a')).toBe(toSinceSec(day(10)) - GIFTWRAP_OVERLAP_SEC)
    })

    it('falls back to lastFullSyncAtMs for a relay with no EOSE history', () => {
      const r = record({ lastFullSyncAtMs: day(3), relayEoseAtMs: {} })
      expect(sinceForRelay(r, 'wss://new')).toBe(toSinceSec(day(3)) - GIFTWRAP_OVERLAP_SEC)
    })

    it('is undefined with no record or no usable base', () => {
      expect(sinceForRelay(null, 'wss://a')).toBeUndefined()
      expect(sinceForRelay(record({ lastFullSyncAtMs: 0 }), 'wss://a')).toBeUndefined()
    })
  })

  describe('deep-resync', () => {
    it('window is bounded by deepResyncAtMs, not account age', () => {
      const r = record({ deepResyncAtMs: day(5) })
      expect(sinceForDeepResync(r)).toBe(toSinceSec(day(5)) - GIFTWRAP_OVERLAP_SEC)
    })

    it('shouldDeepResync: false without a record, true past the interval', () => {
      expect(shouldDeepResync(null, day(100))).toBe(false)

      const r = record({ deepResyncAtMs: day(0) })
      expect(shouldDeepResync(r, day(0) + DEEP_RESYNC_INTERVAL_MS)).toBe(false)
      expect(shouldDeepResync(r, day(0) + DEEP_RESYNC_INTERVAL_MS + 1)).toBe(true)
    })
  })

  it('createGiftwrapCursorRecord starts at lastFullSyncAtMs=0 (확립은 全EOSE로만 — 리뷰 #5)', () => {
    const r = createGiftwrapCursorRecord('k', day(2))
    expect(r).toMatchObject({
      key: 'k',
      v: 2,
      lastAttemptAtMs: 0,
      lastFullSyncAtMs: 0,
      deepResyncAtMs: day(2),
      createdAtMs: day(2),
      relayEoseAtMs: {},
    })
  })
})
