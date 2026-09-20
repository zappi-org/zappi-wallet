import { TokenCodecAdapter } from '@/adapters/codec/token-codec.adapter'
import { testChatCipher } from './helpers/test-chat-cipher'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { bytesToHex } from '@noble/hashes/utils.js'
import { ChatService } from '@/core/services/chat.service'
import { unreadBadge, unreadChatCount } from '@/core/domain/chat'
import { DexieChatRepository } from '@/adapters/storage/dexie/dexie-chat.repository'
import { NostrChatTransport } from '@/adapters/nostr/nostr-chat.transport'
import {
  wrapChatRumor,
  nprofileEncode,
  signEvent,
} from '@/adapters/nostr/internal/nostr-crypto'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import type {
  NostrGateway,
  GiftWrapParams,
} from '@/core/ports/driven/nostr-gateway.port'
import type { NostrEvent, UnsignedNostrEvent } from '@/core/domain/nostr'

function network() {
  const handlers: ((event: NostrEvent) => void)[] = []
  const directory = new Map<string, NostrEvent>()
  let offline = false
  const make = () => {
    const secret = generateSecretKey()
    const sk = bytesToHex(secret)
    const pubkey = getPublicKey(secret)
    const inbox = signEvent(
      {
        pubkey,
        kind: 10050,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [['relay', 'wss://relay.test']],
      },
      sk
    )
    directory.set(inbox.pubkey, inbox)
    const gateway = {
      queryEvents: vi.fn(async (filters: { authors?: string[] }[]) => {
        const event = directory.get(filters[0].authors?.[0] ?? '')
        return event ? [event] : []
      }),
      sendGiftWrap: vi.fn(async (p: GiftWrapParams) => {
        if (offline) throw new Error('Offline')
        const event = wrapChatRumor(p.rumor!, sk, p.recipientPubkey)
        handlers.forEach((fn) => fn(event))
        return event
      }),
      subscribe: vi.fn((_filters: unknown, fn: (e: NostrEvent) => void) => {
        handlers.push(fn)
        return () => {
          const index = handlers.indexOf(fn)
          if (index >= 0) handlers.splice(index, 1)
        }
      }),
    } as unknown as NostrGateway
    const transport = new NostrChatTransport(gateway, sk, () => [
      'wss://relay.test',
    ])
    const service = new ChatService(
      new DexieChatRepository(transport.account, testChatCipher),
      transport
    )
    return { sk, gateway, transport, service }
  }
  return {
    make,
    emit: (event: NostrEvent) => handlers.forEach((fn) => fn(event)),
    setOffline: (v: boolean) => {
      offline = v
    },
  }
}
let services: ChatService[] = []
beforeEach(async () => {
  await resetDatabase()
})
afterEach(async () => {
  services.forEach((s) => s.disconnect())
  services = []
  await new Promise((r) => setTimeout(r, 25))
  await resetDatabase()
})

async function pair() {
  const net = network()
  const alice = net.make()
  const bob = net.make()
  services.push(alice.service, bob.service)
  await Promise.all([alice.service.connect(), bob.service.connect()])
  const id = await alice.service.open(bob.transport.account)
  return { net, alice, bob, id }
}

async function deliver(
  service: ChatService,
  conversationId: string,
  content: string
) {
  const previous = new Set(
    service.getSnapshot().messages.map((message) => message.id)
  )
  await service.enqueue(conversationId, content)
  await vi.waitFor(() => {
    const message = service
      .getSnapshot()
      .messages.find(
        (candidate) =>
          candidate.conversationId === conversationId &&
          !previous.has(candidate.id)
      )
    expect(message?.status).toBe('sent')
  })
}

describe('private chat with real encryption and durable storage', () => {
  it('preserves real CREQB payload and authenticated request expiry through encrypted delivery and storage', async () => {
    const { alice, bob, id } = await pair()
    const codec = new TokenCodecAdapter()
    const request = codec.createNostrPaymentRequest({ amount: 2100, unit: 'sat', mints: ['https://mint.test'], pubkey: nprofileEncode(alice.transport.account, ['wss://relay.test']) })
    const expiresAt = Date.now() + 60000
    await alice.service.enqueue(id, request.request, { kind: 'request', requestId: request.id, amount: 2100, expiresAt })
    await vi.waitFor(() => expect(bob.service.getSnapshot().messages).toHaveLength(1))
    const received = bob.service.getSnapshot().messages[0]
    expect(received.content).toBe(request.request)
    expect(received.content.startsWith('CREQB')).toBe(true)
    expect(codec.decodePaymentRequest(received.content).amount).toBe(2100)
    expect(received.expiresAt).toBe(Math.floor(expiresAt / 1000) * 1000)
    expect(received.payment).toBeUndefined()
    expect(alice.service.getSnapshot().messages[0].expiresAt).toBe(received.expiresAt)
  })

  it('binds request expiry to the authenticated message id', async () => {
    const { alice, bob } = await pair()
    const request = alice.transport.prepare(bob.transport.account, 'CREQBpayload', { expiresAt: Date.now() + 60000 })
    await expect(alice.transport.send({ ...request, expiresAt: request.expiresAt! + 1000 })).rejects.toThrow('integrity')
    expect(alice.gateway.sendGiftWrap).not.toHaveBeenCalled()
  })

  it('does not publish a request that expired while queued', async () => {
    const { alice, bob } = await pair()
    const request = alice.transport.prepare(bob.transport.account, 'CREQBpayload', { expiresAt: Date.now() + 60000 })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(request.expiresAt! + 1)
    try {
      await expect(alice.transport.send(request)).rejects.toThrow('expired')
      expect(alice.gateway.sendGiftWrap).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })

  it.each([
    [['zappi-request-expiration', 'garbage']],
    [['zappi-request-expiration', '10', 'extra']],
    [['zappi-request-expiration']],
    [['zappi-request-expiration', '-1']],
    [['zappi-request-expiration', '1.5']],
    [['zappi-request-expiration', '9007199254740991']],
    [['zappi-request-expiration', '10'], ['zappi-request-expiration', '20']],
  ])('rejects malformed or duplicate authenticated request expiry %j', async (...tags) => {
    const { alice, bob, net } = await pair()
    const rumor: UnsignedNostrEvent = {
      pubkey: alice.transport.account, kind: 14, created_at: Math.floor(Date.now() / 1000), content: 'CREQBpayload',
      tags: [['p', bob.transport.account], ...tags],
    }
    net.emit(wrapChatRumor(rumor, alice.sk, bob.transport.account))
    await new Promise(resolve => setTimeout(resolve, 35))
    expect(bob.service.getSnapshot().messages).toHaveLength(0)
  })

  it('retains already-expired received requests for disabled history cards', async () => {
    const { alice, bob, net } = await pair()
    const rumor: UnsignedNostrEvent = {
      pubkey: alice.transport.account, kind: 14, created_at: Math.floor(Date.now() / 1000), content: 'CREQBpayload',
      tags: [['p', bob.transport.account], ['zappi-request-expiration', '10']],
    }
    net.emit(wrapChatRumor(rumor, alice.sk, bob.transport.account))
    await vi.waitFor(() => expect(bob.service.getSnapshot().messages).toHaveLength(1))
    expect(bob.service.getSnapshot().messages[0].expiresAt).toBe(10000)
  })

  it('delivers to the authenticated recipient and isolates account copies', async () => {
    const { alice, bob, id } = await pair()
    await deliver(alice.service, id, '안녕하세요 👋')
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    expect(bob.service.getSnapshot().messages[0]).toMatchObject({
      content: '안녕하세요 👋',
      sender: alice.transport.account,
      outgoing: false,
    })
    expect(alice.service.getSnapshot().messages[0]).toMatchObject({
      outgoing: true,
      status: 'sent',
    })
    expect(unreadChatCount(bob.service.getSnapshot().conversations)).toBe(1)
    expect(unreadChatCount(alice.service.getSnapshot().conversations)).toBe(0)
    expect(await getDatabase().chatMessages.count()).toBe(2)
  })
  it('deduplicates rewrapped messages and concurrent relay deliveries', async () => {
    const { net, alice, bob, id } = await pair()
    await deliver(alice.service, id, 'one')
    const args = vi.mocked(alice.gateway.sendGiftWrap).mock.calls[0][0]
    const wrap = wrapChatRumor(args.rumor!, alice.sk, bob.transport.account)
    net.emit(wrap)
    net.emit(wrap)
    net.emit(wrapChatRumor(args.rumor!, alice.sk, bob.transport.account))
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    expect(unreadChatCount(bob.service.getSnapshot().conversations)).toBe(1)
  })
  it('persists failed messages and retries the same rumor id', async () => {
    const { net, alice, bob, id } = await pair()
    net.setOffline(true)
    await alice.service.enqueue(id, 'retry me')
    await vi.waitFor(() =>
      expect(alice.service.getSnapshot().messages[0]?.status).toBe('failed')
    )
    const message = alice.service.getSnapshot().messages[0]
    expect(message.status).toBe('failed')
    net.setOffline(false)
    await alice.service.retry(message.id)
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    expect(alice.service.getSnapshot().messages[0]).toMatchObject({
      id: message.id,
      status: 'sent',
    })
  })
  it('keeps deleted messages deleted across replay, while accepting genuinely new messages', async () => {
    const { net, alice, bob, id } = await pair()
    await deliver(alice.service, id, 'delete me')
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    const bobId = bob.service.getSnapshot().conversations[0].id
    await bob.service.delete(bobId)
    const args = vi.mocked(alice.gateway.sendGiftWrap).mock.calls[0][0]
    net.emit(wrapChatRumor(args.rumor!, alice.sk, bob.transport.account))
    await new Promise((r) => setTimeout(r, 30))
    expect(bob.service.getSnapshot().messages).toHaveLength(0)
    const now = Math.floor(Date.now() / 1000) + 2
    const fresh: UnsignedNostrEvent = {
      ...args.rumor!,
      created_at: now,
      content: 'new',
    }
    net.emit(wrapChatRumor(fresh, alice.sk, bob.transport.account))
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    expect(bob.service.getSnapshot().messages[0].content).toBe('new')
  })
  it('rejects future timestamps and messages addressed to a different person', async () => {
    const { net, alice, bob } = await pair()
    const base: UnsignedNostrEvent = {
      pubkey: alice.transport.account,
      kind: 14,
      tags: [['p', bob.transport.account]],
      created_at: Math.floor(Date.now() / 1000),
      content: 'bad',
    }
    net.emit(
      wrapChatRumor(
        { ...base, created_at: base.created_at + 10000 },
        alice.sk,
        bob.transport.account
      )
    )
    net.emit(
      wrapChatRumor(
        { ...base, tags: [['p', getPublicKey(generateSecretKey())]] },
        alice.sk,
        bob.transport.account
      )
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(bob.service.getSnapshot().messages).toHaveLength(0)
  })
  it('keeps normal JSON text, but excludes wallet token envelopes', async () => {
    const { alice, bob, id } = await pair()
    await deliver(alice.service, id, '{"hello":"world"}')
    await deliver(
      alice.service,
      id,
      '{"type":"cashu_token","token":"cashuBtoken"}'
    )
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    expect(bob.service.getSnapshot().messages[0].content).toBe(
      '{"hello":"world"}'
    )
  })
  it('persists read, pinned, muted and draft state and blocks incoming messages', async () => {
    const { alice, bob, id } = await pair()
    await deliver(alice.service, id, 'first')
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    const bobId = bob.service.getSnapshot().conversations[0].id
    await bob.service.markRead(bobId)
    await bob.service.update(bobId, {
      pinned: true,
      muted: true,
      draft: 'later',
      blocked: true,
    })
    await deliver(alice.service, id, 'blocked')
    await new Promise((r) => setTimeout(r, 30))
    const data = await new DexieChatRepository(
      bob.transport.account,
      testChatCipher
    ).load()
    expect(data.messages).toHaveLength(1)
    expect(data.conversations[0]).toMatchObject({
      unread: 0,
      pinned: true,
      muted: true,
      draft: 'later',
      blocked: true,
    })
  })
  it('restores messages after service restart', async () => {
    const { alice, bob, id } = await pair()
    await deliver(alice.service, id, 'persist')
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    bob.service.disconnect()
    await bob.service.connect()
    expect(bob.service.getSnapshot().messages[0].content).toBe('persist')
  })
  it('keeps trade contexts separate while sharing one inbox', async () => {
    const net = network()
    const alice = net.make()
    const peer = 'b'.repeat(64)
    const trade = (contextId: string) => ({
      account: alice.transport.account,
      channel: 'trade',
      contextId,
      resolvePeer: (address: string) => address,
      prepare: (recipient: string, content: string) => ({
        id: crypto.randomUUID(),
        conversationId: `${alice.transport.account}:trade:${contextId}:${recipient}`,
        sender: alice.transport.account,
        recipient,
        content,
        createdAt: Date.now(),
        outgoing: true,
        status: 'sending' as const,
      }),
      send: vi.fn().mockResolvedValue(undefined),
      subscribe: () => () => undefined,
    })
    const first = trade('order-1')
    const second = trade('order-2')
    const chat = new ChatService(
      new DexieChatRepository(alice.transport.account, testChatCipher),
      alice.transport,
      [first, second]
    )
    services.push(chat)
    await chat.connect()
    await chat.open(peer)
    const one = await chat.open(peer, {
      channel: 'trade',
      contextId: 'order-1',
    })
    const two = await chat.open(peer, {
      channel: 'trade',
      contextId: 'order-2',
    })
    await deliver(chat, one, 'first trade')
    await deliver(chat, two, 'second trade')
    expect(chat.getSnapshot().conversations).toHaveLength(3)
    expect(first.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'first trade' })
    )
    expect(second.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'second trade' })
    )
  })
  it('does not restore plaintext into memory after locking during a send', async () => {
    const { alice, id } = await pair()
    let finish!: () => void
    vi.spyOn(alice.transport, 'send').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    await alice.service.enqueue(id, 'lock during delivery')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    alice.service.disconnect()
    finish()
    await vi.waitFor(async () =>
      expect((await getDatabase().chatMessages.toArray())[0]?.status).toBe(
        'sent'
      )
    )
    expect(alice.service.getSnapshot().messages).toHaveLength(0)
  })
  it('preserves nprofile relay hints across a transport restart', async () => {
    const { alice, bob } = await pair()
    const address = nprofileEncode(bob.transport.account, [
      'wss://private-relay.test',
    ])
    const id = await alice.service.open(address)
    alice.service.disconnect()
    const transport = new NostrChatTransport(alice.gateway, alice.sk, () => [
      'wss://fallback.test',
    ])
    const service = new ChatService(
      new DexieChatRepository(alice.transport.account, testChatCipher),
      transport
    )
    services.push(service)
    await service.connect()
    vi.mocked(alice.gateway.queryEvents).mockRejectedValue(
      new Error('Directory unavailable')
    )
    await deliver(service, id, 'via saved hint')
    expect(alice.gateway.sendGiftWrap).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientPubkey: bob.transport.account,
        relays: ['wss://private-relay.test'],
      })
    )
  })
  it('keeps same-second new messages after deletion without restoring old ones', async () => {
    const { alice, bob, id } = await pair()
    await deliver(alice.service, id, 'old')
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    const bobId = bob.service.getSnapshot().conversations[0].id
    await bob.service.delete(bobId)
    await deliver(alice.service, id, 'new')
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    expect(bob.service.getSnapshot().messages[0].content).toBe('new')
  })
  it('leaves existing support-ticket messages to the support inbox', async () => {
    const { net, alice, bob } = await pair()
    const rumor: UnsignedNostrEvent = {
      pubkey: alice.transport.account,
      kind: 14,
      content: 'Support reply',
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', bob.transport.account],
        ['ticket_id', '123'],
        ['e', 'thread-root'],
      ],
    }
    net.emit(wrapChatRumor(rumor, alice.sk, bob.transport.account))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(bob.service.getSnapshot().messages).toHaveLength(0)
  })
  it('mutes arrivals without discarding unread messages', async () => {
    const { alice, bob, id } = await pair()
    const bobId = await bob.service.open(alice.transport.account)
    await bob.service.update(bobId, { muted: true })
    const arrival = vi.fn()
    bob.service.onMessage(arrival)
    await deliver(alice.service, id, 'quiet message')
    await vi.waitFor(() =>
      expect(bob.service.getSnapshot().messages).toHaveLength(1)
    )
    expect(unreadChatCount(bob.service.getSnapshot().conversations)).toBe(1)
    expect(arrival).not.toHaveBeenCalled()
  })
  it('advertises a 99+ badge without changing the real unread count', () => {
    expect(unreadBadge(99)).toBe('99')
    expect(unreadBadge(100)).toBe('99+')
    expect(unreadBadge(10000)).toBe('99+')
  })
})
