import type { GiftwrapCursorRecord } from '@/core/domain/giftwrap-cursor'

/**
 * Gift wrap cursor store port.
 *
 * Implementation requirements:
 * - load() creates and persists a **new record with lastFullSyncAtMs=0** when none
 *   exists, then returns it. Do **not** seed from the legacy syncAnchor — that
 *   timestamp advanced even on partial/empty fetches, so it doesn't qualify as a
 *   since lower bound; seeding it would permanently exclude events missed by the
 *   partial sync right before the upgrade. lastFullSyncAtMs is established and
 *   advanced only by a true full EOSE (markFullSync). The legacy row is preserved (as an anchor marker).
 * - mark* methods upsert (create the record if missing).
 */
export interface GiftwrapCursorStore {
  load(key: string): Promise<GiftwrapCursorRecord | null>
  /** Records a catch-up/subscription attempt — updates diagnostic-only fields. Not a since source. */
  markAttempt(key: string, atMs: number): Promise<void>
  markRelayEose(key: string, relayUrl: string, atMs: number): Promise<void>
  /** Called only on EOSE from all target relays — the sole advancement of the single since. */
  markFullSync(key: string, atMs: number): Promise<void>
  markDeepResync(key: string, atMs: number): Promise<void>
}
