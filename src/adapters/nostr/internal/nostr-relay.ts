/**
 * nostr-relay — SimplePool 래핑
 *
 * nostr-tools relay 통신을 이 파일에서만 import.
 * 바깥에서는 RelayPool 인터페이스만 사용.
 */

import { SimplePool } from 'nostr-tools/pool'

// ─── Types ───

export interface Relay {
  connected: boolean
  subscribe(
    filters: Array<Record<string, unknown>>,
    opts: { onevent: (event: unknown) => void },
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
