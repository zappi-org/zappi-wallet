import { describe, expect, it, vi } from 'vitest'
import { NostrChatTransport } from '@/adapters/nostr/nostr-chat.transport'
import {
  derivePublicKey,
  signEvent,
  wrapChatRumor,
} from '@/adapters/nostr/internal/nostr-crypto'
import { conversationId } from '@/core/domain/chat'
import type { ChatMessage } from '@/core/domain/chat'
import type { NostrEvent, NostrFilter } from '@/core/domain/nostr'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'

const secret = '01'.repeat(32)
const owner = derivePublicKey(secret)
const peerSecret = '03'.repeat(32)
const peer = derivePublicKey(peerSecret)
function fixture() {
  let incoming: (event: NostrEvent) => void = () => {}
  const stop = vi.fn()
  const gateway = {
    queryEvents: vi.fn().mockResolvedValue([
      signEvent(
        {
          pubkey: peer,
          kind: 10050,
          created_at: 100,
          content: '',
          tags: [['relay', 'wss://peer.test']],
        },
        peerSecret
      ),
    ]),
    sendGiftWrap: vi.fn().mockResolvedValue({}),
    subscribe: vi.fn(
      (_filters: NostrFilter[], callback: (event: NostrEvent) => void) => {
        incoming = callback
        return stop
      }
    ),
  }
  const transport = new NostrChatTransport(
    gateway as unknown as NostrGateway,
    secret,
    () => ['wss://chat.test']
  )
  return {
    transport,
    gateway,
    stop,
    emit: (event: NostrEvent) => incoming(event),
  }
}

describe('shared wallet/chat identity lifecycle', () => {
  it('uses the wallet identity for chat and keeps local IDs out of wire payloads', async () => {
    const { transport, gateway } = fixture()
    const message = transport.prepare(peer, 'private hello')
    expect(message.sender).toBe(derivePublicKey(secret))
    expect(message.conversationId).toBe(
      conversationId({ account: owner, channel: 'direct' }, peer)
    )
    await transport.send(message)
    expect(
      gateway.sendGiftWrap.mock.calls.map((call) => call[0].recipientPubkey)
    ).toEqual([peer, transport.identity])
    for (const [params] of gateway.sendGiftWrap.mock.calls) {
      expect(params.rumor.pubkey).toBe(owner)
      expect(params.rumor).not.toHaveProperty('conversationId')
    }
  })
  it('receives on the shared key while keeping local conversation history', async () => {
    const { transport, gateway, emit, stop } = fixture()
    const messages: ChatMessage[] = []
    transport.subscribe(async (message) => {
      messages.push(message)
    })
    expect(gateway.subscribe.mock.calls[0][0]).toEqual([
      { kinds: [1059], '#p': [transport.identity] },
    ])
    emit(
      wrapChatRumor(
        {
          pubkey: peer,
          kind: 14,
          content: 'hello',
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', transport.identity]],
        },
        peerSecret,
        transport.identity
      )
    )
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(messages[0]).toMatchObject({
      outgoing: false,
      sender: peer,
      recipient: transport.identity,
      conversationId: conversationId(transport, peer),
    })
    transport.destroy()
    expect(stop).toHaveBeenCalledOnce()
    expect(() => transport.prepare(peer, 'locked')).toThrow('locked')
  })
  it('rejects a development message from the removed identity before network access', async () => {
    const { transport, gateway } = fixture()
    const message = {
      ...transport.prepare(peer, 'old draft'),
      sender: derivePublicKey('02'.repeat(32)),
    }
    await expect(transport.send(message)).rejects.toThrow('identity mismatch')
    expect(gateway.queryEvents).not.toHaveBeenCalled()
    expect(gateway.sendGiftWrap).not.toHaveBeenCalled()
  })
  it('rejects corrupted rumor metadata before network access', async () => {
    const { transport, gateway } = fixture()
    const message = transport.prepare(peer, 'unchanged content')
    message.createdAt += 1000
    await expect(transport.send(message)).rejects.toThrow('integrity mismatch')
    expect(gateway.queryEvents).not.toHaveBeenCalled()
    expect(gateway.sendGiftWrap).not.toHaveBeenCalled()
  })
  it('does not publish after destruction during directory lookup', async () => {
    const { transport, gateway } = fixture()
    let resolve!: (events: NostrEvent[]) => void
    gateway.queryEvents.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const pending = transport.send(transport.prepare(peer, 'hello'))
    transport.destroy()
    resolve([])
    await expect(pending).rejects.toThrow('locked')
    expect(gateway.sendGiftWrap).not.toHaveBeenCalled()
  })
  it('does not publish a sender backup after destruction during recipient delivery', async () => {
    const { transport, gateway } = fixture()
    let resolve!: (event: unknown) => void
    gateway.sendGiftWrap.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const pending = transport.send(transport.prepare(peer, 'hello'))
    await vi.waitFor(() => expect(gateway.sendGiftWrap).toHaveBeenCalledOnce())
    transport.destroy()
    resolve({})
    await pending
    expect(gateway.sendGiftWrap).toHaveBeenCalledOnce()
  })
})
