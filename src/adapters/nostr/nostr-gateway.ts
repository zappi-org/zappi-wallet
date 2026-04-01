/**
 * NostrGatewayAdapter — NostrGateway port 구현
 *
 * relay 통신만 담당. 로컬 연산(서명, 암호화 등)은 internal/nostr-crypto.ts에서 가져다 씀.
 * nostr-tools SimplePool을 직접 import하는 유일한 gateway 파일.
 */

import { SimplePool } from 'nostr-tools/pool'
import type {
  NostrGateway,
  RelayStatus,
  DirectMessageParams,
} from '@/core/ports/driven/nostr-gateway.port'
import type { NostrEvent, NostrFilter, UnsignedNostrEvent } from '@/core/domain/nostr'
import { signEvent, wrapEvent } from './internal/nostr-crypto'

export interface NostrGatewayConfig {
  privateKeyHex: string
  defaultTimeout?: number
}

export class NostrGatewayAdapter implements NostrGateway {
  private pool: SimplePool
  private connectedRelays: Set<string> = new Set()
  private config: NostrGatewayConfig
  private readonly defaultTimeout: number

  constructor(config: NostrGatewayConfig) {
    this.pool = new SimplePool()
    this.config = config
    this.defaultTimeout = config.defaultTimeout ?? 5000
  }

  async connect(relays: string[]): Promise<void> {
    for (const url of relays) {
      try {
        await this.pool.ensureRelay(url)
        this.connectedRelays.add(url)
      } catch (error) {
        console.warn(`[NostrGateway] Failed to connect to ${url}:`, error)
      }
    }
  }

  async disconnect(): Promise<void> {
    this.pool.close(Array.from(this.connectedRelays))
    this.connectedRelays.clear()
  }

  getRelayStatus(): RelayStatus[] {
    return Array.from(this.connectedRelays).map(url => ({
      url,
      connected: true,
    }))
  }

  async publish(event: UnsignedNostrEvent): Promise<NostrEvent> {
    const signed = signEvent(event, this.config.privateKeyHex)
    const relays = Array.from(this.connectedRelays)

    if (relays.length === 0) {
      throw new Error('No connected relays')
    }

    const results = await Promise.allSettled(this.pool.publish(relays, signed as Parameters<typeof this.pool.publish>[1]))
    const succeeded = results.filter(r => r.status === 'fulfilled').length

    if (succeeded === 0) {
      throw new Error('Failed to publish to any relay')
    }

    return signed
  }

  async queryEvents(filters: NostrFilter[]): Promise<NostrEvent[]> {
    const relays = Array.from(this.connectedRelays)
    if (relays.length === 0) return []

    const events: NostrEvent[] = []
    for (const filter of filters) {
      const results = await this.pool.querySync(
        relays,
        filter as Parameters<typeof this.pool.querySync>[1],
        { maxWait: this.defaultTimeout },
      )
      events.push(...(results as unknown as NostrEvent[]))
    }

    return events
  }

  subscribe(
    filters: NostrFilter[],
    handler: (event: NostrEvent) => void,
  ): () => void {
    const relays = Array.from(this.connectedRelays)
    const cleanups: (() => void)[] = []

    for (const filter of filters) {
      for (const relayUrl of relays) {
        this.pool.ensureRelay(relayUrl).then(relay => {
          const sub = relay.subscribe(
            [filter as Parameters<typeof relay.subscribe>[0][0]],
            {
              onevent: (event) => handler(event as unknown as NostrEvent),
            },
          )
          cleanups.push(() => sub.close())
        }).catch(error => {
          console.warn(`[NostrGateway] Subscribe failed for ${relayUrl}:`, error)
        })
      }
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }

  async sendPrivateDirectMessage(params: DirectMessageParams): Promise<void> {
    const wrapped = wrapEvent(
      this.config.privateKeyHex,
      params.recipientPubkey,
      params.content,
    )

    await this.connect(params.relays)

    const relays = params.relays
    const results = await Promise.allSettled(
      this.pool.publish(relays, wrapped as Parameters<typeof this.pool.publish>[1]),
    )
    const succeeded = results.filter(r => r.status === 'fulfilled').length

    if (succeeded === 0) {
      throw new Error('Failed to send direct message to any relay')
    }
  }
}
