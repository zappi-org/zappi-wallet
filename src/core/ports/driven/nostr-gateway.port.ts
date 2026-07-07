import type { NostrEvent, NostrFilter, UnsignedNostrEvent } from '@/core/domain/nostr'

export interface RelayStatus {
  url: string
  connected: boolean
}

export interface NostrGateway {
  connect(relays: string[]): Promise<void>
  disconnect(): Promise<void>
  getRelayStatus(): RelayStatus[]

  publish(event: UnsignedNostrEvent): Promise<NostrEvent>
  queryEvents(filters: NostrFilter[]): Promise<NostrEvent[]>

  subscribe(
    filters: NostrFilter[],
    handler: (event: NostrEvent) => void,
  ): () => void

  sendPrivateDirectMessage(params: DirectMessageParams): Promise<void>

  /** Send NIP-17 gift wrap and return the wrapped event */
  sendGiftWrap(params: GiftWrapParams): Promise<NostrEvent>

  /** Query and unwrap NIP-17 gift wrap events */
  fetchGiftWraps(params: FetchGiftWrapsParams): Promise<UnwrappedMessage[]>

  /**
   * Subscribe to gift wraps and deliver unwrapped messages to the handler.
   * If the handler returns a Promise, the cursor full-sync mark is deferred until those
   * handlers settle — so a crash mid-processing is redelivered in the next session window.
   */
  subscribeGiftWraps(
    params: SubscribeGiftWrapsParams,
    handler: (msg: UnwrappedMessage) => void | Promise<void>,
  ): () => void
}

export interface DirectMessageParams {
  recipientPubkey: string
  content: string
  relays: string[]
}

export interface GiftWrapParams {
  recipientPubkey: string
  content: string
  relays: string[]
}

/**
 * Gift wrap cursor spec. The implementation computes `since` and marks EOSE via the
 * cursor store. If no store is injected (kill-switch `ks.cursor`), the spec is ignored
 * and it falls back to full replay.
 */
export interface GiftwrapCursorSpec {
  /** Account-scoped key — giftwrapCursorKey(pubkey). */
  key: string
  /** Defaults to GIFTWRAP_OVERLAP_SEC (NIP-59 2 days + 6h clock skew). */
  overlapSec?: number
  /** Reinstall (isRecoveryMode) or manual full resync — no since applied. */
  fullReplay?: boolean
  /**
   * Basis for the all-EOSE (full-sync) decision — the configured persistent relay set.
   * Using the connected snapshot would silently drop down/unconnected relays from quorum,
   * pushing their sole events outside the window and losing them. If unset, full-sync
   * marking is disabled (under-advancing = safe) and only EOSE history accumulates.
   */
  fullSyncTargets?: string[]
}

export interface FetchGiftWrapsParams {
  recipientPubkey: string
  relays: string[]
  cursor?: GiftwrapCursorSpec
  /** Explicit window in seconds (e.g. deep-resync). Takes precedence over the cursor computation. */
  sinceSecOverride?: number
  /**
   * Upper bound (ms) for the querySync wait. Full/deep windows can't drain within the
   * default 5s, so callers pass a larger value.
   */
  maxWaitMs?: number
}

export interface SubscribeGiftWrapsParams {
  recipientPubkey: string
  since?: number
  cursor?: GiftwrapCursorSpec
}

export interface UnwrappedMessage {
  eventId: string
  content: string
  sender: string
}
