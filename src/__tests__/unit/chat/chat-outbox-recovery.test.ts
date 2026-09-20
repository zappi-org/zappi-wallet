import { describe, expect, it, vi } from 'vitest'
import { ChatService } from '@/core/services/chat.service'
import {
  conversationId,
  type ChatMessage,
  type Conversation,
} from '@/core/domain/chat'
import type { ChatRepository } from '@/core/ports/driven/chat.repository.port'
import type { ChatTransport } from '@/core/ports/driven/chat-transport.port'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function fixture() {
  const conversations = new Map<string, Conversation>()
  const messages = new Map<string, ChatMessage>()
  const deliveries: ReturnType<typeof deferred>[] = []
  let watch = () => {}
  let receiveError: (error: Error) => void = () => {}
  let beforeReceive: (() => Promise<void>) | undefined
  let nextId = 0
  let failLoad = false
  const repo: ChatRepository = {
    load: async () => {
      if (failLoad) {
        failLoad = false
        throw new Error('Load failed')
      }
      return {
        conversations: [...conversations.values()],
        messages: [...messages.values()],
      }
    },
    getConversation: async (id) => conversations.get(id),
    saveConversation: async (conversation) => {
      conversations.set(conversation.id, conversation)
    },
    receive: async (message, conversation) => {
      await beforeReceive?.()
      conversations.set(conversation.id, conversation)
      messages.set(message.id, message)
      watch()
      return true
    },
    saveMessage: async (message) => {
      if (!messages.has(message.id)) return false
      messages.set(message.id, message)
      return true
    },
    updateConversation: async () => {},
    deleteConversation: async () => {},
    watch: (handler) => {
      watch = handler
      return () => {
        watch = () => {}
      }
    },
  }
  const transport: ChatTransport = {
    account: 'owner',
    channel: 'direct',
    resolvePeer: (peer) => peer,
    prepare: (peer, content) => ({
      id: String(++nextId),
      conversationId: conversationId(transport, peer),
      sender: 'owner',
      recipient: peer,
      content,
      createdAt: Date.now(),
      outgoing: true,
      status: 'sending',
    }),
    subscribe: (_handler, onError) => {
      receiveError = onError
      return () => {}
    },
    send: vi.fn(() => {
      const delivery = deferred()
      deliveries.push(delivery)
      return delivery.promise
    }),
  }
  const service = new ChatService(repo, transport)
  return {
    service,
    failNextLoad: () => {
      failLoad = true
    },
    messages,
    deliveries,
    transport,
    notify: () => watch(),
    failReceive: () => receiveError(new Error('Disconnected relay')),
    pauseReceive: (pause: () => Promise<void>) => {
      beforeReceive = pause
    },
  }
}

describe('chat outbox recovery', () => {
  it('rebuilds pending jobs after reconnect without publishing in-flight jobs twice', async () => {
    const f = fixture()
    await f.service.connect()
    const id = await f.service.open('peer')
    for (let i = 0; i < 4; i++) await f.service.enqueue(id, `message ${i}`)
    await vi.waitFor(() => expect(f.deliveries).toHaveLength(3))
    f.failReceive()
    await f.service.connect()
    expect(f.deliveries).toHaveLength(3)
    f.deliveries.slice(0, 3).forEach((delivery) => delivery.resolve())
    await vi.waitFor(() => expect(f.deliveries).toHaveLength(4))
    f.deliveries[3].resolve()
    await vi.waitFor(() =>
      expect([...f.messages.values()].every((m) => m.status === 'sent')).toBe(
        true
      )
    )
    expect(
      vi.mocked(f.transport.send).mock.calls.map(([message]) => message.id)
    ).toEqual(['1', '2', '3', '4'])
    f.service.disconnect()
  })

  it('recovers a message committed after locking and reconnecting', async () => {
    const f = fixture()
    await f.service.connect()
    const id = await f.service.open('peer')
    const gate = deferred()
    const entered = deferred()
    f.pauseReceive(async () => {
      entered.resolve()
      await gate.promise
    })
    const enqueue = f.service.enqueue(id, 'late commit')
    await entered.promise
    f.service.disconnect()
    await f.service.connect()
    gate.resolve()
    await enqueue
    await vi.waitFor(() => expect(f.deliveries).toHaveLength(1))
    f.deliveries[0].resolve()
    await vi.waitFor(() => expect(f.messages.get('1')?.status).toBe('sent'))
    expect(f.transport.send).toHaveBeenCalledTimes(1)
    f.service.disconnect()
  })

  it('does not automatically retry failed sends when the repository changes', async () => {
    const f = fixture()
    await f.service.connect()
    const id = await f.service.open('peer')
    await f.service.enqueue(id, 'offline')
    await vi.waitFor(() => expect(f.deliveries).toHaveLength(1))
    f.deliveries[0].reject(new Error('Offline'))
    await vi.waitFor(() =>
      expect(f.service.getSnapshot().messages[0]?.status).toBe('failed')
    )
    f.notify()
    await new Promise((resolve) => setTimeout(resolve, 10))
    f.failReceive()
    await f.service.connect()
    expect(f.transport.send).toHaveBeenCalledTimes(1)
    expect(f.messages.get('1')?.status).toBe('failed')
    f.service.disconnect()
  })
})

it('does not publish a queued message deleted before its turn', async () => {
  const f = fixture()
  await f.service.connect()
  const id = await f.service.open('peer')
  for (let i = 0; i < 4; i++) await f.service.enqueue(id, `message ${i}`)
  await vi.waitFor(() => expect(f.deliveries).toHaveLength(3))
  f.messages.delete('4')
  f.deliveries.forEach((delivery) => delivery.resolve())
  await vi.waitFor(() =>
    expect(
      [...f.messages.values()].every((message) => message.status === 'sent')
    ).toBe(true)
  )
  expect(f.transport.send).toHaveBeenCalledTimes(3)
  f.service.disconnect()
})

it('accepts a durable enqueue even when its snapshot refresh fails', async () => {
  const f = fixture()
  await f.service.connect()
  const id = await f.service.open('peer')
  f.failNextLoad()
  await expect(f.service.enqueue(id, 'saved once')).resolves.toBeUndefined()
  await vi.waitFor(() => expect(f.deliveries).toHaveLength(1))
  expect(f.service.getSnapshot().error).toBe(true)
  f.deliveries[0].resolve()
  await vi.waitFor(() => expect(f.messages.get('1')?.status).toBe('sent'))
  expect(f.transport.send).toHaveBeenCalledTimes(1)
  f.service.disconnect()
})
