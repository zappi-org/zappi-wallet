import { afterEach, describe, expect, it, vi } from 'vitest'
import { NostrChatTransport } from '@/adapters/nostr/nostr-chat.transport'
import { derivePublicKey, nprofileEncode, signEvent } from '@/adapters/nostr/internal/nostr-crypto'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'

const alice = '01'.repeat(32)
const bob = '02'.repeat(32)
const peer = derivePublicKey(bob)
function inbox(relays = ['wss://bob.test'], key = bob, createdAt = 100) {
  return signEvent({ pubkey: derivePublicKey(key), kind: 10050, created_at: createdAt, content: '', tags: relays.map((url) => ['relay', url]) }, key)
}
function fixture() {
  const gateway = {
    queryEvents: vi.fn().mockResolvedValue([inbox()]),
    sendGiftWrap: vi.fn().mockResolvedValue({}),
  }
  const transport = new NostrChatTransport(gateway as unknown as NostrGateway, alice, () => ['wss://alice.test'])
  return { gateway, transport, message: transport.prepare(peer, 'hello') }
}
afterEach(() => vi.useRealTimers())

describe('recipient relay resolution', () => {
  it('never substitutes the sender relay for a missing inbox', async () => {
    const f = fixture()
    f.gateway.queryEvents.mockResolvedValue([])
    await expect(f.transport.send(f.message)).rejects.toThrow('Recipient chat relays unavailable')
    expect(f.gateway.sendGiftWrap).not.toHaveBeenCalled()
  })

  it('rejects forged directories and directories belonging to another account', async () => {
    const f = fixture()
    f.gateway.queryEvents.mockResolvedValue([{ ...JSON.parse(JSON.stringify(inbox())), sig: '00'.repeat(64) }, inbox(['wss://attacker.test'], alice)])
    await expect(f.transport.send(f.message)).rejects.toThrow('Recipient chat relays unavailable')
    expect(f.gateway.sendGiftWrap).not.toHaveBeenCalled()
  })

  it('uses the verified recipient cache when a later query fails', async () => {
    const f = fixture()
    await f.transport.send(f.message)
    f.gateway.sendGiftWrap.mockClear()
    f.gateway.queryEvents.mockRejectedValue(new Error('offline directory'))
    await f.transport.send(f.transport.prepare(peer, 'next'))
    expect(f.gateway.sendGiftWrap.mock.calls[0][0]).toMatchObject({ recipientPubkey: peer, relays: ['wss://bob.test'] })
  })

  it('honors a newer signed inbox removal instead of a stale cache', async () => {
    const f = fixture()
    await f.transport.send(f.message)
    f.gateway.queryEvents.mockResolvedValue([inbox([], bob, 101)])
    f.gateway.sendGiftWrap.mockClear()
    await expect(f.transport.send(f.message)).rejects.toThrow('Recipient chat relays unavailable')
    expect(f.gateway.sendGiftWrap).not.toHaveBeenCalled()
  })

  it('does not override a signed inbox removal with stale nprofile hints', async () => {
    const f = fixture()
    f.transport.resolvePeer(nprofileEncode(peer, ['wss://old.test']))
    await f.transport.send(f.message)
    f.gateway.queryEvents.mockResolvedValue([inbox([], bob, 101)])
    f.gateway.sendGiftWrap.mockClear()
    await expect(f.transport.send(f.message)).rejects.toThrow('Recipient chat relays unavailable')
    expect(f.gateway.sendGiftWrap).not.toHaveBeenCalled()
  })

  it('uses explicit nprofile hints when the directory times out', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.transport.resolvePeer(nprofileEncode(peer, ['wss://hint.test']))
    f.gateway.queryEvents.mockImplementation(() => new Promise(() => {}))
    const send = f.transport.send(f.message)
    await vi.advanceTimersByTimeAsync(3000)
    await send
    expect(f.gateway.sendGiftWrap.mock.calls[0][0]).toMatchObject({ recipientPubkey: peer, relays: ['wss://hint.test'] })
  })

  it('succeeds on the first recipient ACK without waiting for a dead relay or sender backup', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.gateway.queryEvents.mockResolvedValue([inbox(['wss://dead.test', 'wss://bob.test'])])
    f.gateway.sendGiftWrap.mockImplementation((params: { relays: string[] }) => params.relays[0] === 'wss://bob.test' ? Promise.resolve({}) : new Promise(() => {}))
    await f.transport.send(f.message)
    expect(f.gateway.sendGiftWrap).toHaveBeenCalledTimes(3)
  })

  it('fails boundedly when all recipient publishes hang', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.gateway.sendGiftWrap.mockImplementation(() => new Promise(() => {}))
    const send = expect(f.transport.send(f.message)).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(12000)
    await send
  })
})
