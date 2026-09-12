import { describe, expect, it } from 'vitest'
import { getPublicKey, verifyEvent, type Event } from 'nostr-tools'
import { PushDevToolsAdapter } from '@/adapters/runtime/push-dev-tools.adapter'
import { createPushGatewayMock } from '@/__tests__/helpers/push.mock'

const IDENTITY = new Uint8Array(32).fill(9)

describe('PushDevToolsAdapter', () => {
  it('reports the real npub as the inbox pubkey', () => {
    const tools = new PushDevToolsAdapter({ identitySecretKey: IDENTITY, gateway: createPushGatewayMock() })
    expect(tools.inboxPub()).toBe(getPublicKey(IDENTITY))
  })

  it('register/unregister delegate to the gateway', async () => {
    const gateway = createPushGatewayMock()
    const tools = new PushDevToolsAdapter({ identitySecretKey: IDENTITY, gateway })

    await expect(tools.register(['ws://localhost:4444/relay', 'wss://relay.example'])).resolves.toBe(true)
    expect(gateway.enable).toHaveBeenCalledWith(['ws://localhost:4444/relay', 'wss://relay.example'])

    await tools.unregister()
    expect(gateway.disable).toHaveBeenCalledTimes(1)
  })

  it('publishes a signed kind:1059 event tagged to this inbox', async () => {
    const published: Array<{ relayUrls: string[]; event: Event }> = []
    const tools = new PushDevToolsAdapter({
      identitySecretKey: IDENTITY,
      gateway: createPushGatewayMock(),
      publish: async (relayUrls, event) => {
        published.push({ relayUrls, event })
      },
    })

    await tools.publishSelfGiftWrap(['ws://localhost:4444/relay', 'wss://relay.example'])

    expect(published).toHaveLength(1)
    expect(published[0].relayUrls).toEqual(['ws://localhost:4444/relay', 'wss://relay.example'])
    expect(published[0].event.kind).toBe(1059)
    expect(published[0].event.tags).toEqual([['p', getPublicKey(IDENTITY)]])
    expect(verifyEvent(published[0].event)).toBe(true)
  })
})
