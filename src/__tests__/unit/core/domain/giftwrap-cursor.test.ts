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

  describe('sinceForCatchUp (2-phase single since)', () => {
    it('is undefined with no record (first-time full replay)', () => {
      expect(sinceForCatchUp(null)).toBeUndefined()
    })

    it('is undefined while lastFullSyncAtMs is 0 (no full EOSE yet)', () => {
      expect(sinceForCatchUp(record({ lastFullSyncAtMs: 0 }))).toBeUndefined()
    })

    it('applies the overlap window to lastFullSyncAtMs', () => {
      const r = record({ lastFullSyncAtMs: day(10) })
      expect(sinceForCatchUp(r)).toBe(toSinceSec(day(10)) - GIFTWRAP_OVERLAP_SEC)
    })

    /**
     * A timeout does not advance `since` — no matter how recent lastAttemptAtMs is,
     * the catch-up window is based on lastFullSyncAtMs.
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

  describe('sinceForRelay (canonical rule — 6-phase consumption)', () => {
    /**
     * D0/D10 counter-example: full sync at D0 → relay C goes down → an event that
     * exists only on C at D1 → C returns at D10. C's `since` must be based on C's own
     * last EOSE (D0); other relays' progress (D10) must never mix in. A max(global
     * cursor, ...) style formula would query from D7.75 and lose the D1 event.
     */
    it('D0/D10 relay-outage timeline: down relay backfills from ITS OWN last EOSE', () => {
      const r = record({
        lastFullSyncAtMs: day(10), // assume the global value advanced for whatever reason
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

  it('createGiftwrapCursorRecord starts at lastFullSyncAtMs=0 (established only via full EOSE — review #5)', () => {
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
