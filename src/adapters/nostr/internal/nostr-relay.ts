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
    opts: {
      onevent: (event: unknown) => void
      /** EOSE — cursor 전진의 유일한 신호 (설계 §10 B5) */
      oneose?: () => void
      /**
       * nostr-tools는 relay가 EOSE를 안 보내면 이 시간 뒤 **합성 EOSE**를 발화한다
       * (abstract-relay baseEoseTimeout=4400ms). cursor 경로는 반드시 거대 값으로
       * 덮어야 한다 — 합성 EOSE로 cursor가 전진하면 [N1] "timeout은 아무것도
       * 전진시키지 않는다" 불변식이 깨져 무음 유실이 생긴다 (2단계 리뷰 #1).
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
