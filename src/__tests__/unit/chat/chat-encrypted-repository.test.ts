import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatStorageCipherAdapter } from '@/adapters/crypto/chat-storage-cipher'
import { DexieChatKeyStore } from '@/adapters/storage/dexie/dexie-chat-key-store'
import { DexieChatRepository } from '@/adapters/storage/dexie/dexie-chat.repository'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import {
  conversationId,
  type ChatMessage,
  type Conversation,
} from '@/core/domain/chat'

const account = 'a'.repeat(64)
const seed = new Uint8Array(64).fill(7)
const conversation: Conversation = {
  id: conversationId({ account, channel: 'direct' }, 'peer'),
  account,
  peer: 'peer',
  channel: 'direct',
  updatedAt: 1000,
  unread: 0,
  pinned: false,
  muted: false,
  blocked: false,
  preview: 'private preview',
  draft: 'private draft',
}
const message = (id = 'one'): Omit<ChatMessage, 'payment'> => ({
  id,
  conversationId: conversation.id,
  content: 'private body',
  sender: 'peer',
  recipient: account,
  createdAt: 2000,
  outgoing: false,
  status: 'received',
})
async function setup() {
  const cipher = new ChatStorageCipherAdapter(account, new DexieChatKeyStore())
  await cipher.unlock(seed)
  const repo = new DexieChatRepository(account, cipher)
  return { cipher, repo }
}
beforeEach(resetDatabase)
afterEach(resetDatabase)

describe('encrypted chat repository', () => {
  it('keeps content, previews and drafts out of persisted rows and decrypts after restart', async () => {
    const { repo, cipher } = await setup()
    await repo.saveConversation(conversation)
    await repo.receive(message(), conversation)
    await repo.updateConversation(conversation.id, {
      draft: 'new secret draft',
    })
    const db = getDatabase()
    const raw = JSON.stringify([
      await db.chatMessages.toArray(),
      await db.chatConversations.toArray(),
      await db.chatStorageKeys.toArray(),
    ])
    for (const secret of [
      'private body',
      'private preview',
      'private draft',
      'new secret draft',
    ])
      expect(raw).not.toContain(secret)
    cipher.lock()
    await expect(repo.load()).rejects.toThrow('locked')
    const resumed = await setup()
    expect((await resumed.repo.load()).messages[0].content).toBe('private body')
    expect((await resumed.repo.getConversation(conversation.id))?.draft).toBe(
      'new secret draft'
    )
    const row = await db.chatMessages.get([conversation.id, 'one'])
    expect(row?.contentBytes).toBe(
      new TextEncoder().encode('private body').length
    )
  })

  it('migrates existing plaintext without losing history, metadata or deletion tombstones', async () => {
    const db = getDatabase()
    await db.chatConversations.put({ ...conversation, clearedBefore: 500 })
    await db.chatMessages.put(message())
    const { repo } = await setup()
    await expect(repo.load()).rejects.toThrow('version')
    await repo.initialize()
    await repo.initialize()
    expect((await repo.load()).messages).toEqual([message()])
    expect((await repo.getConversation(conversation.id))?.clearedBefore).toBe(
      500
    )
    expect(
      (await db.chatConversations.get(conversation.id))?.storageVersion
    ).toBe(1)
    expect(JSON.stringify(await db.chatConversations.toArray())).not.toContain(
      'private draft'
    )
  })

  it('rolls back a failed migration batch and resumes without replacing the vault key', async () => {
    const db = getDatabase()
    await db.chatConversations.put(conversation)
    await db.chatMessages.bulkPut([message('one'), message('two')])
    const { repo, cipher } = await setup()
    const key = await db.chatStorageKeys.get(account)
    const encrypt = cipher.encrypt.bind(cipher)
    let calls = 0
    vi.spyOn(cipher, 'encrypt').mockImplementation(async (value, context) => {
      if (++calls === 2) throw new Error('interrupted')
      return encrypt(value, context)
    })
    await expect(repo.initialize()).rejects.toThrow('interrupted')
    expect(
      (await db.chatMessages.toArray()).every(
        (row) => row.storageVersion === undefined
      )
    ).toBe(true)
    expect((await db.chatConversations.get(conversation.id))?.draft).toBe(
      'private draft'
    )
    const resumed = await setup()
    await resumed.repo.initialize()
    expect((await resumed.repo.load()).messages).toHaveLength(2)
    expect(await db.chatStorageKeys.get(account)).toEqual(key)
  })

  it('resumes after a committed batch and leaves other accounts untouched', async () => {
    const db = getDatabase()
    await db.chatConversations.put(conversation)
    await db.chatMessages.bulkPut(
      Array.from({ length: 102 }, (_, i) => message(String(i).padStart(3, '0')))
    )
    const foreign = {
      ...conversation,
      id: 'other:direct:peer',
      account: 'other',
    }
    await db.chatConversations.put(foreign)
    const { repo, cipher } = await setup()
    const encrypt = cipher.encrypt.bind(cipher)
    let calls = 0
    vi.spyOn(cipher, 'encrypt').mockImplementation(async (value, context) => {
      if (++calls === 101) throw new Error('interrupted')
      return encrypt(value, context)
    })
    await expect(repo.initialize()).rejects.toThrow('interrupted')
    expect(
      (await db.chatMessages.toArray()).filter(
        (row) => row.storageVersion === 1
      )
    ).toHaveLength(100)
    const resumed = await setup()
    await resumed.repo.initialize()
    expect((await resumed.repo.load()).messages).toHaveLength(102)
    expect(await db.chatConversations.get(foreign.id)).toEqual(foreign)
  })

  it('authenticates record placement and refuses missing keys and unknown versions', async () => {
    const { repo } = await setup()
    await repo.receive(message('one'), conversation)
    await repo.receive(message('two'), conversation)
    const db = getDatabase()
    const first = (await db.chatMessages.get([conversation.id, 'one']))!
    const second = (await db.chatMessages.get([conversation.id, 'two']))!
    await db.chatMessages.update([conversation.id, 'two'], {
      content: first.content,
    })
    await expect(repo.load()).rejects.toThrow()
    await db.chatMessages.put(second)
    await db.chatStorageKeys.delete(account)
    await expect(setup()).rejects.toThrow('key missing')
    await db.chatMessages.update([conversation.id, 'one'], {
      storageVersion: 2 as 1,
    })
    await expect(repo.initialize()).rejects.toThrow('version')
  })

  it('aborts a receive if lock and re-unlock happen while it is encrypting', async () => {
    const keyStore = new DexieChatKeyStore()
    const cipher = new ChatStorageCipherAdapter(account, keyStore)
    await cipher.unlock(seed)
    const record = (await getDatabase().chatStorageKeys.get(account))!
    vi.spyOn(keyStore, 'getOrCreate').mockResolvedValue(record)
    const repo = new DexieChatRepository(account, cipher)
    await repo.saveConversation(conversation)
    const encrypt = cipher.encrypt.bind(cipher)
    let first = true
    vi.spyOn(cipher, 'encrypt').mockImplementation(async (value, context) => {
      const ciphertext = await encrypt(value, context)
      if (first) {
        first = false
        cipher.lock()
        await cipher.unlock(seed)
      }
      return ciphertext
    })
    await expect(repo.receive(message(), conversation)).rejects.toThrow(
      'session changed'
    )
    expect(await getDatabase().chatMessages.count()).toBe(0)
    expect(await getDatabase().chatSeen.count()).toBe(0)
  })

  it('reuses authenticated plaintext on metadata updates and clears it across lock sessions', async () => {
    const { repo, cipher } = await setup()
    await repo.receive(message(), conversation)
    const decrypt = vi.spyOn(cipher, 'decrypt')
    await repo.load()
    decrypt.mockClear()
    await repo.updateConversation(conversation.id, { unread: 0 })
    await repo.load()
    expect(decrypt).not.toHaveBeenCalled()
    repo.clearCache()
    cipher.lock()
    await cipher.unlock(seed)
    await repo.load()
    expect(decrypt).toHaveBeenCalledTimes(3)
  })
  it('encrypts local payment links and authenticates them independently of message text', async () => {
    const { repo } = await setup()
    const payment = {
      kind: 'send' as const,
      transactionId: 'private-tx-identifier',
      amount: 123,
    }
    await repo.receive({ ...message('one'), payment }, conversation)
    await repo.receive(
      {
        ...message('two'),
        payment: {
          kind: 'request',
          requestId: 'private-request-id',
          amount: 20,
          expiresAt: 123456,
        },
      },
      conversation
    )
    const db = getDatabase()
    const first = (await db.chatMessages.get([conversation.id, 'one']))!
    expect(JSON.stringify(await db.chatMessages.toArray())).not.toContain(
      'private-tx-identifier'
    )
    expect(JSON.stringify(await db.chatMessages.toArray())).not.toContain(
      'private-request-id'
    )
    expect((await repo.load()).messages[0].payment).toEqual(payment)
    const resumed = await setup()
    expect((await resumed.repo.load()).messages[1].payment?.kind).toBe(
      'request'
    )
    await db.chatMessages.update([conversation.id, 'two'], {
      payment: first.payment,
    })
    await expect(repo.load()).rejects.toThrow()
  })
  it('also encrypts orphaned legacy message bodies without inventing a conversation', async () => {
    const db = getDatabase()
    await db.chatMessages.put(message())
    const { repo } = await setup()
    await repo.initialize()
    const row = await db.chatMessages.get([conversation.id, 'one'])
    expect(row?.storageVersion).toBe(1)
    expect(row?.content).not.toContain('private body')
    expect(await db.chatConversations.count()).toBe(0)
  })
})
