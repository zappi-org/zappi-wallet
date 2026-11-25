import { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools/core'
import type { Filter } from 'nostr-tools/filter'

export interface PayoutRelayEvent {
  id: string
  pubkey: string
  kind: number
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface PayoutRelayClient {
  query(
    relays: string[],
    filter: Record<string, unknown>,
    maxWaitMs: number,
  ): Promise<PayoutRelayEvent[]>
  publish(relays: string[], event: PayoutRelayEvent): Promise<void>
  subscribe(
    relays: string[],
    filter: Record<string, unknown>,
    onEvent: (event: PayoutRelayEvent) => void,
  ): () => void
  close(): void
}

export const DEFAULT_PAYOUT_RELAYS = [
  'wss://relay.getalby.com/v1',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://brb.io',
  'wss://relay.primal.net',
  'wss://ftp.halifax.rwth-aachen.de/nostr',
  'wss://eu.purplerelay.com',
  'wss://nostr.einundzwanzig.space',
  'wss://nostr.mom',
]

function toPayoutRelayEvent(event: Event): PayoutRelayEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    created_at: event.created_at,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  }
}

export function createSimplePoolRelayClient(): PayoutRelayClient {
  const pool = new SimplePool()

  return {
    async query(relays, filter, maxWaitMs) {
      const events = await pool.querySync(relays, filter as Filter, { maxWait: maxWaitMs })
      return events.map(toPayoutRelayEvent)
    },

    async publish(relays, event) {
      const results = await Promise.allSettled(pool.publish(relays, event as Event))
      if (!results.some((result) => result.status === 'fulfilled')) {
        throw new Error('no relay accepted the payout event')
      }
    },

    subscribe(relays, filter, onEvent) {
      const subscription = pool.subscribeMany(relays, filter as Filter, {
        onevent: (event) => onEvent(toPayoutRelayEvent(event)),
      })
      return () => subscription.close()
    },

    close() {
      pool.destroy()
    },
  }
}
