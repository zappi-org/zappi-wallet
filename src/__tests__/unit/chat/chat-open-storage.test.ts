import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { bytesToHex } from '@noble/hashes/utils.js'
import { ChatStorageCipherAdapter } from '@/adapters/crypto/chat-storage-cipher'
import { NostrChatTransport } from '@/adapters/nostr/nostr-chat.transport'
import { DexieChatKeyStore } from '@/adapters/storage/dexie/dexie-chat-key-store'
import { DexieChatRepository } from '@/adapters/storage/dexie/dexie-chat.repository'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import { ChatService } from '@/core/services/chat.service'
import { conversationId } from '@/core/domain/chat'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'

const services: ChatService[] = []
beforeEach(resetDatabase)
afterEach(async () => {
  services.splice(0).forEach((service) => service.disconnect())
  vi.restoreAllMocks()
  await resetDatabase()
})

async function setup() {
  const secret = generateSecretKey()
  const account = getPublicKey(secret)
  const peer = getPublicKey(generateSecretKey())
  const address = nip19.npubEncode(peer)
  const gateway = {
    subscribe: vi.fn(() => () => undefined),
  } as unknown as NostrGateway
  const transport = new NostrChatTransport(gateway, bytesToHex(secret), () => [])
  const cipher = new ChatStorageCipherAdapter(account, new DexieChatKeyStore())
  const repo = new DexieChatRepository(account, cipher)
  await cipher.unlock(new Uint8Array(64).fill(42))
  const service = new ChatService(repo, transport)
  services.push(service)
  return { account, peer, address, cipher, repo, service }
}

describe('opening a chat with encrypted storage', () => {
  function rejectUniqueIndexCursors() {
    const openKeyCursor = IDBIndex.prototype.openKeyCursor
    return vi.spyOn(IDBIndex.prototype, 'openKeyCursor').mockImplementation(function (
      this: IDBIndex, query, direction
    ) {
      if (direction === 'nextunique')
        throw new DOMException('Unable to open cursor', 'UnknownError')
      return openKeyCursor.call(this, query, direction)
    })
  }

  it('initializes empty storage when WebKit rejects unique index cursors', async () => {
    const { repo } = await setup()
    rejectUniqueIndexCursors()
    await expect(
      getDatabase().chatMessages.where('conversationId').startsWith('account:').uniqueKeys()
    ).rejects.toMatchObject({ name: 'UnknownError' })
    await expect(repo.initialize()).resolves.toBeUndefined()
    await expect(repo.load()).resolves.toEqual({ conversations: [], messages: [] })
  })

  it('migrates every orphan message without changing another account', async () => {
    const { account, peer, cipher, repo } = await setup()
    const id = conversationId({ account, channel: 'direct' }, peer)
    const otherId = conversationId({ account: 'other-account', channel: 'direct' }, peer)
    const message = (conversation: string, key: string) => ({
      id: key, conversationId: conversation, sender: peer, recipient: account,
      content: `legacy ${key}`, createdAt: 1, outgoing: false, status: 'received' as const,
    })
    const foreign = message(otherId, 'foreign')
    const db = getDatabase()
    await db.chatMessages.bulkPut([message(id, 'first'), message(id, 'second'), foreign])
    rejectUniqueIndexCursors()
    await repo.initialize()
    for (const key of ['first', 'second']) {
      const stored = await db.chatMessages.get([id, key])
      expect(stored?.storageVersion).toBe(1)
      expect(await cipher.decrypt(stored!.content, ['message', id, key, 'content']))
        .toBe(`legacy ${key}`)
    }
    expect(await db.chatMessages.get([otherId, 'foreign'])).toEqual(foreign)
    const migrated = await db.chatMessages.toArray()
    await repo.initialize()
    expect(await db.chatMessages.toArray()).toEqual(migrated)
    expect(await db.chatConversations.count()).toBe(0)
  })

  it('opens a generated npub and reopens its encrypted conversation', async () => {
    const { account, peer, address, repo, service } = await setup()
    await repo.initialize()
    await service.connect()
    const id = await service.open(address)
    expect(id).toBe(conversationId({ account, channel: 'direct' }, peer))
    expect(await service.open(`nostr:${address}`)).toBe(id)
    expect(service.getSnapshot().conversations).toHaveLength(1)
    expect((await getDatabase().chatConversations.get(id))?.storageVersion).toBe(1)
  })

  it('opens a valid npub after encrypting existing development records', async () => {
    const { account, peer, address, repo, service } = await setup()
    const id = conversationId({ account, channel: 'direct' }, peer)
    await getDatabase().chatConversations.put({
      id, account, peer, channel: 'direct', updatedAt: 0,
      unread: 0, pinned: false, muted: false, blocked: false,
      preview: 'old preview', draft: 'old draft',
    })
    await repo.initialize()
    await service.connect()
    expect(await service.open(address)).toBe(id)
    expect(service.getSnapshot().conversations[0].draft).toBe('old draft')
  })

  it('preserves a storage failure instead of turning it into an invalid recipient', async () => {
    const { address, cipher, repo, service } = await setup()
    await repo.initialize()
    await service.connect()
    cipher.lock()
    await expect(service.open(address)).rejects.toThrow(/locked/i)
  })
})
