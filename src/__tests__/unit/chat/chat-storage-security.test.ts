import { testChatCipher } from './helpers/test-chat-cipher'
import { ChatService } from '@/core/services/chat.service'
import type { ChatTransport } from '@/core/ports/driven/chat-transport.port'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { DexieChatRepository } from '@/adapters/storage/dexie/dexie-chat.repository'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import {
  conversationId,
  conversationCapabilities,
  type Conversation,
  type ChatMessage,
} from '@/core/domain/chat'

const account = 'a'.repeat(64)
const peer = 'b'.repeat(64)
const conversation = (contextId?: string): Conversation => ({
  id: conversationId(
    { account, channel: contextId ? 'trade' : 'direct', contextId },
    peer
  ),
  account,
  peer,
  channel: contextId ? 'trade' : 'direct',
  contextId,
  updatedAt: 0,
  unread: 0,
  pinned: false,
  muted: false,
  blocked: false,
  preview: '',
  draft: '',
})
const message = (
  c: Conversation,
  id: string,
  content = 'hello'
): ChatMessage => ({
  id,
  conversationId: c.id,
  sender: peer,
  recipient: account,
  content,
  createdAt: Date.now() - 10000,
  outgoing: false,
  status: 'received',
})
beforeEach(resetDatabase)
afterEach(resetDatabase)

describe('chat storage security boundaries', () => {
  it('rejects writes and deletes for another account', async () => {
    const owner = new DexieChatRepository(account, testChatCipher)
    const other = new DexieChatRepository('c'.repeat(64), testChatCipher)
    const c = conversation()
    await owner.saveConversation(c)
    await expect(other.receive(message(c, '1'), c)).rejects.toThrow(
      'scope mismatch'
    )
    await expect(
      other.updateConversation(c.id, { draft: 'attack' })
    ).rejects.toThrow('scope mismatch')
    await expect(other.deleteConversation(c.id, Date.now())).rejects.toThrow(
      'scope mismatch'
    )
    expect((await owner.load()).conversations).toHaveLength(1)
  })
  it('rejects scope replacement through metadata updates', async () => {
    const repo = new DexieChatRepository(account, testChatCipher)
    const c = conversation()
    await repo.saveConversation(c)
    await expect(
      repo.updateConversation(c.id, { peer: 'another' })
    ).rejects.toThrow('Invalid conversation update')
    expect((await repo.getConversation(c.id))?.peer).toBe(peer)
  })
  it('scopes identical protocol message ids to separate orders', async () => {
    const repo = new DexieChatRepository(account, testChatCipher)
    const one = conversation('order-1'),
      two = conversation('order-2')
    expect(await repo.receive(message(one, 'same-id'), one)).toBe(true)
    expect(await repo.receive(message(two, 'same-id'), two)).toBe(true)
    expect(await repo.receive(message(one, 'same-id'), one)).toBe(false)
    expect((await repo.load()).messages).toHaveLength(2)
  })
  it('does not conflate delimiters in a channel with an order context', () => {
    expect(conversationId({ account, channel: 'trade:one' }, peer)).not.toBe(
      conversationId({ account, channel: 'trade', contextId: 'one' }, peer)
    )
    expect(conversationCapabilities(conversation('order-1'))).toEqual({
      contacts: false,
      payments: false,
      deletion: false,
      blocking: false,
    })
  })
  it('retains v24 replay tombstones for direct messages', async () => {
    const repo = new DexieChatRepository(account, testChatCipher)
    const c = conversation()
    await getDatabase().chatSeen.put({ id: `${account}:old` })
    expect(await repo.receive(message(c, 'old'), c)).toBe(false)
    expect((await repo.load()).messages).toHaveLength(0)
  })
  it('does not apply legacy direct replay records to an explicit empty context', async () => {
    const repo = new DexieChatRepository(account, testChatCipher)
    const c = conversation('')
    await getDatabase().chatSeen.put({ id: `${account}:old` })
    expect(await repo.receive(message(c, 'old'), c)).toBe(true)
    expect((await repo.load()).messages).toHaveLength(1)
  })
  it('bounds message bytes atomically and frees capacity on deletion', async () => {
    const repo = new DexieChatRepository(account, testChatCipher, {
      messages: 5,
      bytes: 10,
      conversations: 5,
      seen: 20,
    })
    const c = conversation()
    await repo.receive(message(c, '1', '123456'), c)
    await expect(repo.receive(message(c, '2', '123456'), c)).rejects.toThrow(
      'storage limit'
    )
    expect((await repo.load()).messages).toHaveLength(1)
    const usage = await getDatabase().chatUsage.get(account)
    expect(usage).toMatchObject({ messages: 1, bytes: 6, seen: 1 })
    await repo.deleteConversation(c.id, Date.now())
    expect(await getDatabase().chatUsage.get(account)).toMatchObject({
      messages: 0,
      bytes: 0,
      conversations: 0,
    })
    await repo.saveConversation(c)
    const fresh = { ...message(c, '3', 'new'), createdAt: Date.now() + 1000 }
    expect(await repo.receive(fresh, c)).toBe(true)
  })
  it('does not revive cleared history after a new message reopens the conversation', async () => {
    const repo = new DexieChatRepository(account, testChatCipher)
    const c = conversation()
    await repo.receive(message(c, 'old'), c)
    await repo.deleteConversation(c.id, Date.now())
    await repo.receive(
      { ...message(c, 'new'), createdAt: Date.now() + 1000 },
      c
    )
    // This old event was not locally known when the conversation was cleared.
    expect(await repo.receive(message(c, 'old-never-seen'), c)).toBe(false)
    expect((await repo.load()).messages.map((m) => m.id)).toEqual(['new'])
  })
  it('serializes concurrent quota checks', async () => {
    const repo = new DexieChatRepository(account, testChatCipher, {
      messages: 1,
      bytes: 100,
      conversations: 5,
      seen: 20,
    })
    const c = conversation()
    const results = await Promise.allSettled([
      repo.receive(message(c, '1'), c),
      repo.receive(message(c, '2'), c),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await repo.load()).messages).toHaveLength(1)
  })
})

it('rejects cross-account and duplicate transport registrations', () => {
  const repo = new DexieChatRepository(account, testChatCipher)
  const primary = { account, channel: 'direct' } as ChatTransport
  expect(
    () =>
      new ChatService(repo, primary, [
        { ...primary, account: 'other', channel: 'trade' },
      ])
  ).toThrow('account mismatch')
  expect(() => new ChatService(repo, primary, [primary])).toThrow(
    'Duplicate chat channel'
  )
})
