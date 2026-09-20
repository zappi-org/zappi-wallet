import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/core/domain/chat'
import { DATABASE } from '@/core/constants'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'

const message: Omit<ChatMessage, 'payment'> = {
  id: 'rumor', conversationId: 'account:direct:peer', sender: 'account', recipient: 'peer',
  content: 'preserve this draft delivery', createdAt: 123, outgoing: true, status: 'sending',
}

afterEach(async () => { await resetDatabase() })

describe('chat schema migration', () => {
  it.each([
    [24, 'id'], [24, '[conversationId+id]'], [25, '[conversationId+id]'],
  ])('preserves wallet and chat records from v%s using %s', async (version, key) => {
    await resetDatabase()
    const previous = new Dexie(DATABASE.NAME)
    previous.version(Number(version)).stores({
      chatMessages: `${key}, conversationId, createdAt`,
      chatConversations: 'id, account, updatedAt',
      chatSeen: 'id',
      encryptedWallet: 'id',
    })
    const wallet = { id: 'wallet', ciphertext: 'opaque-encrypted-data' }
    const conversation = { id: message.conversationId, account: 'account', updatedAt: 123 }
    const replay = { id: `account:${message.id}` }
    await previous.table('chatMessages').put(message)
    await previous.table('chatConversations').put(conversation)
    await previous.table('chatSeen').put(replay)
    await previous.table('encryptedWallet').put(wallet)
    previous.close()

    const db = getDatabase()
    await db.open()
    expect(await db.chatMessages.get([message.conversationId, message.id])).toEqual(message)
    expect(await db.chatConversations.get(conversation.id)).toEqual(conversation)
    expect(await db.chatSeen.get(replay.id)).toEqual(replay)
    expect(await db.encryptedWallet.get(wallet.id)).toEqual(wallet)
    expect(db.backendDB().objectStoreNames.contains('chatMessages')).toBe(false)
    expect(db.chatMessages.schema.primKey.keyPath).toEqual(['conversationId', 'id'])
    db.close()
    await db.open()
    expect(await db.chatMessages.count()).toBe(1)
  })

  it('rolls back without deleting legacy data when copying fails', async () => {
    await resetDatabase()
    const previous = new Dexie(DATABASE.NAME)
    previous.version(24).stores({ chatMessages: 'id', encryptedWallet: 'id' })
    const invalid = { id: 'missing-conversation-key', content: 'must not disappear' }
    await previous.table('chatMessages').put(invalid)
    await previous.table('encryptedWallet').put({ id: 'wallet', ciphertext: 'keep' })
    previous.close()
    const db = getDatabase()
    await expect(db.open()).rejects.toThrow()
    db.close()
    const inspect = new Dexie(DATABASE.NAME)
    await inspect.open()
    expect(inspect.verno).toBe(24)
    expect(await inspect.table('chatMessages').get(invalid.id)).toEqual(invalid)
    expect(await inspect.table('encryptedWallet').get('wallet')).toEqual({ id: 'wallet', ciphertext: 'keep' })
    inspect.close()
  })

  it('creates a fresh database with scoped message keys', async () => {
    const db = getDatabase()
    await db.chatMessages.bulkAdd([
      message,
      { ...message, conversationId: 'other:direct:peer' },
    ])
    expect(await db.chatMessages.count()).toBe(2)
    expect(db.backendDB().objectStoreNames.contains('chatMessages')).toBe(false)
  })
})
