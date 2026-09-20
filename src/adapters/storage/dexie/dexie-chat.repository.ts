import Dexie, { liveQuery } from 'dexie'
import type { ChatStorageCipher } from '@/core/ports/driven/chat-storage-cipher.port'
import {
  chatMessageKey,
  conversationId,
  MAX_CHAT_MESSAGE_BYTES,
  type ChatMessage,
  type Conversation,
} from '@/core/domain/chat'
import { ChatCapacityError } from '@/core/errors/chat'
import type { ChatRepository } from '@/core/ports/driven/chat.repository.port'
import { getDatabase, type ChatMessageRecord } from './schema'
import { parseChatPaymentLink } from '@/core/domain/chat-payment'

export interface ChatStorageLimits {
  messages: number
  bytes: number
  conversations: number
  seen: number
}
const DEFAULT_LIMITS: ChatStorageLimits = {
  messages: 10_000,
  bytes: 16 * 1024 * 1024,
  conversations: 1000,
  seen: 100_000,
}
const bytes = (content: string) => new TextEncoder().encode(content).length

export class DexieChatRepository implements ChatRepository {
  private decrypted = new Map<
    string,
    { ciphertext: string; plaintext: string }
  >()
  private cacheGuard: (() => void) | undefined

  clearCache(): void {
    this.decrypted.clear()
    this.cacheGuard = undefined
  }
  private async decrypt(value: string, context: readonly string[]) {
    try {
      this.cacheGuard?.()
    } catch {
      this.clearCache()
    }
    this.cacheGuard ??= this.cipher.captureGuard()
    const guard = this.cipher.captureGuard()
    const key = JSON.stringify(context)
    const cached = this.decrypted.get(key)
    if (cached?.ciphertext === value) return cached.plaintext
    const plaintext = await this.cipher.decrypt(value, context)
    guard()
    this.decrypted.delete(key)
    this.decrypted.set(key, { ciphertext: value, plaintext })
    if (this.decrypted.size > 22_000)
      this.decrypted.delete(this.decrypted.keys().next().value!)
    return plaintext
  }
  constructor(
    private account: string,
    private cipher: ChatStorageCipher,
    private limits: ChatStorageLimits = DEFAULT_LIMITS
  ) {}
  private version(record: { storageVersion?: number }, legacy = false) {
    if (
      record.storageVersion !== 1 &&
      !(legacy && record.storageVersion === undefined)
    )
      throw new Error('Unsupported chat storage version')
  }
  private async encodeMessage(
    message: ChatMessage
  ): Promise<ChatMessageRecord> {
    if (
      typeof message.content !== 'string' ||
      bytes(message.content) > MAX_CHAT_MESSAGE_BYTES
    )
      throw new Error('Invalid chat message content')
    const { payment: link, ...plain } = message
    const paymentLink =
      link === undefined ? undefined : parseChatPaymentLink(link)
    if (paymentLink === null) throw new Error('Invalid chat payment link')
    const [content, payment] = await Promise.all([
      this.cipher.encrypt(message.content, [
        'message',
        message.conversationId,
        message.id,
        'content',
      ]),
      paymentLink === undefined
        ? undefined
        : this.cipher.encrypt(
            JSON.stringify({ version: 1, payment: paymentLink }),
            ['message', message.conversationId, message.id, 'payment']
          ),
    ])
    this.cipher.assertUnlocked()
    return {
      ...plain,
      content,
      ...(payment === undefined ? {} : { payment }),
      contentBytes: bytes(message.content),
      storageVersion: 1,
    }
  }
  private async decodeMessage(record: ChatMessageRecord): Promise<ChatMessage> {
    this.version(record)
    const { payment: encryptedPayment, ...plain } = record
    delete plain.storageVersion
    delete plain.contentBytes
    const content = await this.decrypt(record.content, [
      'message',
      record.conversationId,
      record.id,
      'content',
    ])
    const message: ChatMessage = { ...plain, content }
    if (encryptedPayment !== undefined) {
      const value: unknown = JSON.parse(
        await this.decrypt(encryptedPayment, [
          'message',
          record.conversationId,
          record.id,
          'payment',
        ])
      )
      if (
        !value ||
        typeof value !== 'object' ||
        !('version' in value) ||
        value.version !== 1 ||
        !('payment' in value)
      )
        throw new Error('Invalid chat payment link')
      const link = parseChatPaymentLink(value.payment)
      if (!link) throw new Error('Invalid chat payment link')
      message.payment = link
    }
    this.cipher.assertUnlocked()
    return message
  }
  private async encodeConversation(conversation: Conversation) {
    if (
      typeof conversation.preview !== 'string' ||
      typeof conversation.draft !== 'string' ||
      bytes(conversation.preview) > MAX_CHAT_MESSAGE_BYTES ||
      bytes(conversation.draft) > MAX_CHAT_MESSAGE_BYTES
    )
      throw new Error('Invalid chat conversation content')
    const [preview, draft] = await Promise.all([
      this.cipher.encrypt(conversation.preview, [
        'conversation',
        conversation.id,
        'preview',
      ]),
      this.cipher.encrypt(conversation.draft, [
        'conversation',
        conversation.id,
        'draft',
      ]),
    ])
    this.cipher.assertUnlocked()
    return { ...conversation, preview, draft, storageVersion: 1 as const }
  }
  private async decodeConversation(
    record: Conversation & { storageVersion?: number }
  ) {
    this.assertScope(record)
    this.version(record)
    const conversation = { ...record }
    delete conversation.storageVersion
    const [preview, draft] = await Promise.all([
      this.decrypt(record.preview, ['conversation', record.id, 'preview']),
      this.decrypt(record.draft, ['conversation', record.id, 'draft']),
    ])
    this.cipher.assertUnlocked()
    return { ...conversation, preview, draft }
  }
  private contentSize(record: ChatMessageRecord) {
    this.version(record)
    if (
      !Number.isSafeInteger(record.contentBytes) ||
      record.contentBytes! < 0 ||
      record.contentBytes! > MAX_CHAT_MESSAGE_BYTES
    )
      throw new Error('Invalid chat content size')
    return record.contentBytes!
  }
  async initialize() {
    const guard = this.cipher.captureGuard()
    const db = getDatabase()
    const [conversationIds, messageIds] = await Promise.all([
      db.chatConversations.where('account').equals(this.account).primaryKeys(),
      db.chatMessages
        .where('conversationId')
        .startsWith(`${encodeURIComponent(this.account)}:`)
        .primaryKeys(),
    ])
    // WebKit can reject unique index cursors, even on an empty table.
    const ids = new Set([
      ...conversationIds,
      ...messageIds.map(([conversationId]) => conversationId),
    ])
    for (const id of ids) {
      let remaining = true
      while (remaining) {
        guard()
        remaining = await db.transaction(
          'rw',
          db.chatConversations,
          db.chatMessages,
          async () => {
            guard()
            const conversation = await db.chatConversations.get(id)
            if (conversation) {
              this.assertScope(conversation)
              this.version(conversation, true)
            }
            const pending = await db.chatMessages
              .where('conversationId')
              .equals(id)
              .filter((message) => message.storageVersion !== 1)
              .limit(101)
              .toArray()
            pending.forEach((message) => this.version(message, true))
            // Bounded atomic batches keep interrupted migrations resumable.
            for (const message of pending.slice(0, 100)) {
              if (message.payment !== undefined)
                throw new Error('Invalid legacy chat payment link')
              const legacy: Omit<ChatMessage, 'payment'> = message
              const encoded = await Dexie.waitFor(this.encodeMessage(legacy))
              guard()
              await db.chatMessages.put(encoded)
            }
            if (
              pending.length <= 100 &&
              conversation &&
              conversation.storageVersion === undefined
            ) {
              const encoded = await Dexie.waitFor(
                this.encodeConversation(conversation)
              )
              guard()
              await db.chatConversations.put(encoded)
            }
            guard()
            return pending.length > 100
          }
        )
      }
    }
    guard()
  }
  private assertScope(conversation: Conversation) {
    if (
      conversation.account !== this.account ||
      conversation.id !== conversationId(conversation, conversation.peer)
    )
      throw new Error('Chat account or scope mismatch')
  }
  private async usage() {
    const db = getDatabase()
    const existing = await db.chatUsage.get(this.account)
    if (existing) return existing
    const conversations = await db.chatConversations
      .where('account')
      .equals(this.account)
      .toArray()
    const messages = await db.chatMessages
      .where('conversationId')
      .anyOf(conversations.map((c) => c.id))
      .toArray()
    return {
      account: this.account,
      messages: messages.length,
      bytes: messages.reduce((n, m) => n + this.contentSize(m), 0),
      conversations: conversations.filter((c) => !c.deletedAt).length,
      seen: await db.chatSeen
        .where('id')
        .startsWith(`${encodeURIComponent(this.account)}:`)
        .count(),
    }
  }
  private check(usage: ChatStorageLimits) {
    if (
      usage.messages > this.limits.messages ||
      usage.bytes > this.limits.bytes ||
      usage.conversations > this.limits.conversations ||
      usage.seen > this.limits.seen
    )
      throw new ChatCapacityError('storage')
  }
  private async records() {
    const guard = this.cipher.captureGuard()
    guard()
    const db = getDatabase()
    return db.transaction(
      'r',
      db.chatConversations,
      db.chatMessages,
      async () => {
        const conversations = await db.chatConversations
          .where('account')
          .equals(this.account)
          .toArray()
        const messages = await db.chatMessages
          .where('conversationId')
          .anyOf(conversations.filter((c) => !c.deletedAt).map((c) => c.id))
          .toArray()
        guard()
        return { conversations, messages }
      }
    )
  }
  async load() {
    const guard = this.cipher.captureGuard()
    const records = await this.records()
    guard()
    const conversations = await Promise.all(
      records.conversations.map((c) => this.decodeConversation(c))
    )
    const messages = await Promise.all(
      records.messages.map((m) => this.decodeMessage(m))
    )
    guard()
    const active = new Set([
      ...conversations.flatMap((c) =>
        ['preview', 'draft'].map((field) =>
          JSON.stringify(['conversation', c.id, field])
        )
      ),
      ...messages.flatMap((m) =>
        (m.payment ? ['content', 'payment'] : ['content']).map((field) =>
          JSON.stringify(['message', m.conversationId, m.id, field])
        )
      ),
    ])
    for (const key of this.decrypted.keys())
      if (!active.has(key)) this.decrypted.delete(key)
    return {
      conversations,
      messages: messages.sort(
        (a, b) =>
          Math.floor(a.createdAt / 1000) - Math.floor(b.createdAt / 1000) ||
          (a.receivedAt ?? a.createdAt) - (b.receivedAt ?? b.createdAt) ||
          a.id.localeCompare(b.id)
      ),
    }
  }
  async getConversation(id: string) {
    const guard = this.cipher.captureGuard()
    guard()
    const conversation = await getDatabase().chatConversations.get(id)
    guard()
    const decoded = conversation
      ? await Dexie.waitFor(this.decodeConversation(conversation))
      : undefined
    guard()
    return decoded
  }
  async receive(message: ChatMessage, conversation: Conversation) {
    const guard = this.cipher.captureGuard()
    guard()
    this.assertScope(conversation)
    if (
      message.conversationId !== conversation.id ||
      bytes(message.content) > MAX_CHAT_MESSAGE_BYTES
    )
      throw new Error('Invalid chat message')
    const db = getDatabase()
    return db.transaction(
      'rw',
      [db.chatMessages, db.chatConversations, db.chatSeen, db.chatUsage],
      async () => {
        const key = chatMessageKey(message)
        if (
          (await db.chatSeen.get(key)) ||
          (await db.chatMessages.get([message.conversationId, message.id]))
        )
          return false
        // Preserve deletion protection for v24 direct-message replay records.
        if (
          conversation.channel === 'direct' &&
          conversation.contextId === undefined &&
          (await db.chatSeen.get(`${this.account}:${message.id}`))
        )
          return false
        const c = (await this.getConversation(conversation.id)) ?? conversation
        this.assertScope(c)
        const cleared = c.clearedBefore ?? c.deletedAt
        if (
          c.blocked ||
          (cleared && message.createdAt < Math.floor(cleared / 1000) * 1000)
        )
          return false
        const usage = await this.usage()
        const exists = await db.chatConversations.get(c.id)
        usage.messages++
        usage.bytes += bytes(message.content)
        usage.seen++
        if (!exists || exists.deletedAt) usage.conversations++
        this.check(usage)
        guard()
        await db.chatSeen.put({
          id: key,
          conversationId: c.id,
          createdAt: message.createdAt,
        })
        const encodedMessage = await Dexie.waitFor(
          this.encodeMessage({ ...message, receivedAt: Date.now() })
        )
        guard()
        await db.chatMessages.put(encodedMessage)
        const encodedConversation = await Dexie.waitFor(
          this.encodeConversation({
            ...c,
            clearedBefore: cleared,
            deletedAt: undefined,
            draft: message.status === 'sending' ? '' : c.draft,
            updatedAt: Math.max(c.updatedAt, message.createdAt),
            preview:
              Math.floor(message.createdAt / 1000) >=
              Math.floor(c.updatedAt / 1000)
                ? message.content
                : c.preview,
            unread: c.unread + (message.outgoing ? 0 : 1),
          })
        )
        guard()
        await db.chatConversations.put(encodedConversation)
        guard()
        await db.chatUsage.put(usage)
        guard()
        return true
      }
    )
  }
  async saveMessage(message: ChatMessage) {
    const guard = this.cipher.captureGuard()
    const db = getDatabase()
    return db.transaction(
      'rw',
      db.chatConversations,
      db.chatMessages,
      async () => {
        if (!(await this.getConversation(message.conversationId))) return false
        guard()
        const changed = await db.chatMessages.update(
          [message.conversationId, message.id],
          { status: message.status }
        )
        guard()
        return changed > 0
      }
    )
  }
  async saveConversation(conversation: Conversation) {
    const guard = this.cipher.captureGuard()
    this.assertScope(conversation)
    const db = getDatabase()
    await db.transaction(
      'rw',
      [db.chatConversations, db.chatMessages, db.chatSeen, db.chatUsage],
      async () => {
        const existing = await db.chatConversations.get(conversation.id)
        if (existing) {
          this.assertScope(existing)
          this.version(existing)
        }
        if (!existing || existing.deletedAt) {
          const usage = await this.usage()
          usage.conversations++
          this.check(usage)
          guard()
          await db.chatUsage.put(usage)
          guard()
        }
        if (existing) {
          guard()
          await db.chatConversations.update(conversation.id, {
            deletedAt: undefined,
            clearedBefore: existing.clearedBefore ?? existing.deletedAt,
            address: conversation.address,
          })
        } else {
          const encoded = await Dexie.waitFor(
            this.encodeConversation(conversation)
          )
          guard()
          await db.chatConversations.add(encoded)
        }
        guard()
      }
    )
  }
  async updateConversation(id: string, patch: Partial<Conversation>) {
    const guard = this.cipher.captureGuard()
    const allowed = new Set(['unread', 'pinned', 'muted', 'blocked', 'draft'])
    if (
      Object.keys(patch).some((key) => !allowed.has(key)) ||
      (patch.draft && bytes(patch.draft) > MAX_CHAT_MESSAGE_BYTES)
    )
      throw new Error('Invalid conversation update')
    const db = getDatabase()
    await db.transaction('rw', db.chatConversations, async () => {
      guard()
      const current = await this.getConversation(id)
      if (
        !current ||
        Object.entries(patch).every(
          ([key, value]) => current[key as keyof Conversation] === value
        )
      )
        return
      const storedPatch = { ...patch }
      if (patch.draft !== undefined)
        storedPatch.draft = await Dexie.waitFor(
          this.cipher.encrypt(patch.draft, ['conversation', id, 'draft'])
        )
      guard()
      await db.chatConversations.update(id, storedPatch)
      guard()
    })
  }
  async deleteConversation(id: string, at: number) {
    const guard = this.cipher.captureGuard()
    const db = getDatabase()
    await db.transaction(
      'rw',
      [db.chatMessages, db.chatConversations, db.chatSeen, db.chatUsage],
      async () => {
        const c = await this.getConversation(id)
        if (!c || c.deletedAt) return
        const usage = await this.usage()
        const messages = await db.chatMessages
          .where('conversationId')
          .equals(id)
          .toArray()
        const removed = await db.chatSeen
          .where('conversationId')
          .equals(id)
          .and(
            (entry) => (entry.createdAt ?? at) < Math.floor(at / 1000) * 1000
          )
          .delete()
        usage.messages = Math.max(0, usage.messages - messages.length)
        usage.bytes = Math.max(
          0,
          usage.bytes - messages.reduce((n, m) => n + this.contentSize(m), 0)
        )
        usage.conversations = Math.max(0, usage.conversations - 1)
        usage.seen = Math.max(0, usage.seen - removed)
        guard()
        await db.chatMessages.where('conversationId').equals(id).delete()
        const cleared = await Dexie.waitFor(
          this.encodeConversation({
            ...c,
            deletedAt: at,
            clearedBefore: at,
            unread: 0,
            preview: '',
            draft: '',
            pinned: false,
          })
        )
        guard()
        await db.chatConversations.put(cleared)
        guard()
        await db.chatUsage.put(usage)
        guard()
      }
    )
  }
  watch(handler: () => void, onError: (error: unknown) => void) {
    const sub = liveQuery(() => this.records()).subscribe({
      next: handler,
      error: onError,
    })
    return () => sub.unsubscribe()
  }
}
