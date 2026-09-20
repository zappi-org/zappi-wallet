/**
 * nostr-relay — wraps SimplePool.
 *
 * nostr-tools relay communication is imported only here; the rest of the app uses
 * only the RelayPool interface.
 */

import { SimplePool } from 'nostr-tools/pool'
import { normalizeURL } from 'nostr-tools/utils'

/**
 * Normalizes relay URL identity — exposes the *same* function the pool uses internally.
 * If the controller registries (persistent/session/connected) used a different
 * normalization, a variant spelling of a recipient's 10050 relay (`wss://r.io/`) would
 * slip past the persistent∩session check and lease expiry would close a shared socket.
 */
export function relayIdentity(url: string): string {
  try {
    return normalizeURL(url)
  } catch {
    return url
  }
}

// ─── Types ───

export interface Relay {
  connected: boolean
  subscribe(
    filters: Array<Record<string, unknown>>,
    opts: {
      onevent: (event: unknown) => void
      /** EOSE — the only signal that advances the cursor. */
      oneose?: () => void
      /**
       * Subscription-close signal (relay CLOSED, socket death, or self close). Used by
       * SessionController to clean up its attach ledger — when ensureRelay silently revives
       * a dead socket, watching the socket alone can't detect the lost subscription.
       */
      onclose?: (reason?: string) => void
      /**
       * nostr-tools fires a synthetic EOSE after this delay if the relay never sends one
       * (abstract-relay baseEoseTimeout=4400ms). The cursor path must override it with a
       * huge value — if a synthetic EOSE advanced the cursor, the "timeout advances
       * nothing" invariant would break and events would be silently lost.
       */
      eoseTimeout?: number
    },
  ): { close: () => void }
}

export interface RelayPool {
  ensureRelay(url: string): Promise<Relay>
  publish(relays: string[], event: unknown): Promise<unknown>[]
  querySync(
    relays: string[],
    filter: Record<string, unknown>,
    opts?: { maxWait?: number },
  ): Promise<unknown[]>
  close(relays: string[]): void
}

// ─── Factory ───

export function createRelayPool(): RelayPool {
  const pool = new SimplePool()

  return {
    ensureRelay: (url) => pool.ensureRelay(url) as Promise<Relay>,
    publish: (relays, event) =>
      pool.publish(relays, event as Parameters<typeof pool.publish>[1]),
    querySync: (relays, filter, opts) =>
      pool.querySync(
        relays,
        filter as Parameters<typeof pool.querySync>[1],
        opts,
      ),
    close: (relays) => pool.close(relays),
  }
}
