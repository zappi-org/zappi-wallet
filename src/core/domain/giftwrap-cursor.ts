/**
 * Gift wrap cursor — single source of truth for since-window calculation.
 *
 * There is exactly one rule:
 *   since(relay) = floor((relayEoseAtMs[relay] ?? lastFullSyncAtMs) / 1000) − OVERLAP
 *
 * - Only "the last time that relay handed me everything (EOSE)" is a safe lower bound for that
 *   relay. Never fold other relays' progress (a global cursor) into since — the D0/D10
 *   counterexample (a long-down relay's sole event is lost) is the rationale, pinned by tests.
 * - A timeout advances no since source. lastAttemptAtMs is diagnostic/UI only.
 * - Units: Nostr since is seconds, all storage is ms (*AtMs); conversion lives only in toSinceSec.
 *
 * Consumption scope: both live subscription and catch-up use a single lastFullSyncAtMs-based
 * since (sinceForCatchUp). Per-relay since consumption (sinceForRelay) belongs to the controller,
 * but per-relay EOSE marks are persisted from now so it starts with history.
 */

/** NIP-59 created_at randomization ceiling — 2 days, matching nostr-tools nip59 randomNow(). */
export const NIP59_RANDOMIZATION_SEC = 2 * 24 * 60 * 60

/** Sender clock-skew margin. */
export const CLOCK_SKEW_MARGIN_SEC = 6 * 60 * 60

/**
 * Gift wrap since overlap window. Both its value and meaning differ from ANCHOR_VALIDITY_SECONDS
 * (anchor re-publish interval, 2 days) — do not conflate the two.
 */
export const GIFTWRAP_OVERLAP_SEC = NIP59_RANDOMIZATION_SEC + CLOCK_SKEW_MARGIN_SEC

/** deep-resync age-check interval — checked at unlock (a PWA has no background scheduler). */
export const DEEP_RESYNC_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

export const GIFTWRAP_CURSOR_VERSION = 2 as const

export interface GiftwrapCursorRecord {
  /** PK — giftwrapCursorKey(pubkey) */
  key: string
  v: typeof GIFTWRAP_CURSOR_VERSION
  /** Last catch-up attempt time — diagnostic/UI only, never used in since calculation. */
  lastAttemptAtMs: number
  /** Last time all target relays reached EOSE. 0 = none yet (triggers the initial full replay). */
  lastFullSyncAtMs: number
  /** Per-relay last EOSE — persisted source for per-relay since and backfill. */
  relayEoseAtMs: Record<string, number>
  /** Last deep-resync completion time. Initial value = record creation time. */
  deepResyncAtMs: number
  createdAtMs: number
}

/** Account-scoped key — ids and keys must always be pubkey-scoped. */
export function giftwrapCursorKey(pubkeyHex: string): string {
  return `giftwrap:${pubkeyHex.slice(0, 8)}`
}

/** ms → Nostr since (seconds). All conversion is funneled through this one function. */
export function toSinceSec(ms: number): number {
  return Math.floor(ms / 1000)
}

function windowStartSec(baseMs: number, overlapSec: number): number {
  return Math.max(0, toSinceSec(baseMs) - overlapSec)
}

/**
 * Single since — shared by live subscription and catch-up (querySync). Uses only
 * lastFullSyncAtMs, a source that advances only on all-relay EOSE, so if one relay is down the
 * window merely grows without dropping events.
 */
export function sinceForCatchUp(
  record: GiftwrapCursorRecord | null,
  overlapSec: number = GIFTWRAP_OVERLAP_SEC,
): number | undefined {
  if (!record || record.lastFullSyncAtMs <= 0) return undefined
  return windowStartSec(record.lastFullSyncAtMs, overlapSec)
}

/**
 * Per-relay since — the canonical form of the rule. Falls back to lastFullSyncAtMs when the
 * relay has no EOSE record of its own.
 */
export function sinceForRelay(
  record: GiftwrapCursorRecord | null,
  relayUrl: string,
  overlapSec: number = GIFTWRAP_OVERLAP_SEC,
): number | undefined {
  if (!record) return undefined
  const baseMs = record.relayEoseAtMs[relayUrl] ?? record.lastFullSyncAtMs
  if (!baseMs || baseMs <= 0) return undefined
  return windowStartSec(baseMs, overlapSec)
}

/** deep-resync window — bounded from the last deep-resync. */
export function sinceForDeepResync(
  record: GiftwrapCursorRecord | null,
  overlapSec: number = GIFTWRAP_OVERLAP_SEC,
): number | undefined {
  if (!record || record.deepResyncAtMs <= 0) return undefined
  return windowStartSec(record.deepResyncAtMs, overlapSec)
}

/** Age check at unlock. No record = the initial full replay covers everything, so it's unneeded. */
export function shouldDeepResync(
  record: GiftwrapCursorRecord | null,
  nowMs: number,
  intervalMs: number = DEEP_RESYNC_INTERVAL_MS,
): boolean {
  if (!record) return false
  return nowMs - record.deepResyncAtMs > intervalMs
}

/**
 * New records always have lastFullSyncAtMs=0 — the seed parameter is intentionally absent, to
 * categorically prevent promoting a value that lacks the all-EOSE invariant into a since lower
 * bound.
 */
export function createGiftwrapCursorRecord(key: string, nowMs: number): GiftwrapCursorRecord {
  return {
    key,
    v: GIFTWRAP_CURSOR_VERSION,
    lastAttemptAtMs: 0,
    lastFullSyncAtMs: 0,
    relayEoseAtMs: {},
    deepResyncAtMs: nowMs,
    createdAtMs: nowMs,
  }
}
