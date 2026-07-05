/**
 * nostr-relay — SimplePool 래핑
 *
 * nostr-tools relay 통신을 이 파일에서만 import.
 * 바깥에서는 RelayPool 인터페이스만 사용.
 */

import { SimplePool } from 'nostr-tools/pool'
import { normalizeURL } from 'nostr-tools/utils'

/**
 * relay URL 정체성 정규화 — pool이 내부에서 쓰는 것과 **동일한** 함수를 노출한다
 * (설계 §10 B3 — 6단계 리뷰 #4). 컨트롤러 레지스트리(persistent/session/connected)
 * 가 다른 정규화를 쓰면, 수신자 10050의 변형 표기(`wss://r.io/`)가 [N9]
 * persistent∩session 검사를 빠져나가 lease 만료가 공유 소켓을 닫는다.
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
      /** EOSE — cursor 전진의 유일한 신호 (설계 §10 B5) */
      oneose?: () => void
      /**
       * 구독 종료 신호(relay CLOSED·소켓 사망·self close). SessionController의
       * attach 원장 정리에 사용 — ensureRelay가 죽은 소켓을 조용히 되살리는
       * 경우 socket 관찰만으로는 구독 유실을 감지할 수 없다 (설계 §10 B4).
       */
      onclose?: (reason?: string) => void
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
