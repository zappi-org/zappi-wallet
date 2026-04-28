import type { Event } from 'nostr-tools/core'
import type { Filter } from 'nostr-tools/filter'
import type { SimplePool } from 'nostr-tools/pool'
import type { RelayIndexFilter, RelayIndexPort } from 'nostr-cs'

export class ConfiguredNip66RelayIndexAdapter implements RelayIndexPort {
  constructor(
    private readonly pool: SimplePool,
    private readonly discoveryRelays: string[],
  ) {}

  async fetchPublicRelays(filter: RelayIndexFilter = {}): Promise<string[]> {
    if (this.discoveryRelays.length === 0) return []

    const reqFilter: Filter = {
      kinds: [30166],
      limit: filter.limit ?? 10,
    }
    const markers: string[] = []
    if (filter.noPayment) markers.push('!payment')
    if (filter.noAuth) markers.push('!auth')
    if (markers.length > 0) {
      ;(reqFilter as unknown as Record<string, string[]>)['#R'] = markers
    }

    const events = await this.pool.querySync(this.discoveryRelays, reqFilter, {
      maxWait: 3000,
    })

    return uniqueRelayUrls(events as Event[])
  }
}

function uniqueRelayUrls(events: Event[]): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  for (const event of events) {
    const relay = event.tags.find((tag) => tag[0] === 'd')?.[1]
    if (!relay || seen.has(relay) || !relay.startsWith('wss://')) continue
    seen.add(relay)
    urls.push(relay)
  }

  return urls
}
