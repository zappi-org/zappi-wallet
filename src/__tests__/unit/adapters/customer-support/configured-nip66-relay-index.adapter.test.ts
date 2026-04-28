import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools/core'
import type { Filter } from 'nostr-tools/filter'
import type { SimplePool } from 'nostr-tools/pool'
import { ConfiguredNip66RelayIndexAdapter } from '@/adapters/customer-support/configured-nip66-relay-index.adapter'

describe('ConfiguredNip66RelayIndexAdapter', () => {
  it('queries only configured discovery relays', async () => {
    const querySync = vi.fn().mockResolvedValue([
      {
        kind: 30166,
        tags: [
          ['d', 'wss://public.example'],
          ['d', 'https://ignored.example'],
        ],
      },
    ] as Event[])
    const pool = { querySync } as unknown as SimplePool
    const adapter = new ConfiguredNip66RelayIndexAdapter(pool, [
      'wss://discovery.example/',
    ])

    const relays = await adapter.fetchPublicRelays({ noAuth: true, noPayment: true, limit: 3 })

    expect(querySync).toHaveBeenCalledWith(
      ['wss://discovery.example/'],
      expect.objectContaining({
        kinds: [30166],
        limit: 3,
      }) as Filter,
      { maxWait: 3000 },
    )
    const filter = querySync.mock.calls[0][1] as Record<string, string[]>
    expect(filter['#R']).toEqual(['!payment', '!auth'])
    expect(relays).toEqual(['wss://public.example'])
  })
})
