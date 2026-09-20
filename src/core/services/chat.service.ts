import { ChatAddressError, ChatCapacityError } from '@/core/errors/chat'
import {
  parseChatPaymentLink,
  type ChatPaymentLink,
} from '@/core/domain/chat-payment'
import {
  conversationId,
  conversationCapabilities,
  chatMessageKey,
  MAX_CHAT_MESSAGE_BYTES,
} from '@/core/domain/chat'
import type {
  ChatMessage,
  ChatSnapshot,
  Conversation,
} from '@/core/domain/chat'
import type { ChatTransport } from '@/core/ports/driven/chat-transport.port'
import type { ChatRepository } from '@/core/ports/driven/chat.repository.port'
import type { ChatUseCase } from '@/core/ports/driving/chat.usecase'

export class ChatService implements ChatUseCase {
  private snapshot: ChatSnapshot = {
    conversations: [],
    messages: [],
    ready: false,
    error: false,
  }
  private listeners = new Set<() => void>()
  private arrivals = new Set<(message: ChatMessage) => void>()
  private stop?: () => void
  private unwatch?: () => void
  private generation = 0
  private revision = 0
  private outbox: Array<{ message: ChatMessage; generation: number }> = []
  private queued = new Set<string>()
  private delivering = 0
  private active = false
  private pending: Promise<unknown> = Promise.resolve()
  private sending = new Set<string>()

  constructor(
    private repo: ChatRepository,
    private transport: ChatTransport,
    private additionalTransports: ChatTransport[] = []
  ) {
    const scopes = new Set<string>()
    for (const channel of [transport, ...additionalTransports]) {
      if (channel.account !== transport.account)
        throw new Error('Chat account mismatch')
      const scope = conversationId(channel, '')
      if (scopes.has(scope)) throw new Error('Duplicate chat channel')
      scopes.add(scope)
    }
  }
  private get transports() {
    return [this.transport, ...this.additionalTransports]
  }
  getSnapshot = () => this.snapshot
  subscribe = (handler: () => void) => {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }
  onMessage = (handler: (m: ChatMessage) => void) => {
    this.arrivals.add(handler)
    return () => {
      this.arrivals.delete(handler)
    }
  }
  private async refresh(clearError = false) {
    if (!this.active) return
    const revision = ++this.revision
    const generation = this.generation
    const data = await this.repo.load()
    if (
      generation !== this.generation ||
      revision !== this.revision ||
      !this.active
    )
      return
    this.snapshot = {
      ...data,
      ready: true,
      error: clearError ? false : this.snapshot.error,
      errorReason: clearError ? undefined : this.snapshot.errorReason,
    }
    this.listeners.forEach((fn) => fn())
  }
  private async refreshAfterWrite() {
    const generation = this.generation
    await this.refresh().catch((error) => {
      if (this.active && generation === this.generation) this.fail(error)
    })
  }
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work)
    this.pending = result.catch(() => undefined)
    return result
  }
  async connect() {
    if (this.stop && !this.snapshot.error) return
    this.stop?.()
    this.unwatch?.()
    this.stop = undefined
    this.unwatch = undefined
    this.outbox = []
    this.queued.clear()
    this.active = true
    const generation = ++this.generation
    const stops: Array<() => void> = []
    try {
      await this.refresh(true)
      if (generation !== this.generation || this.stop) return
      const onError = (error: unknown) => {
        if (this.active && generation === this.generation) this.fail(error)
      }
      this.unwatch = this.repo.watch(() => {
        void this.queue(async () => {
          if (generation !== this.generation || !this.active) return
          await this.refresh()
          this.recoverOutbox(generation)
        }).catch(onError)
      }, onError)
      for (const transport of this.transports) {
        stops.push(
          transport.subscribe(
            (message) =>
              this.queue(async () => {
                if (generation !== this.generation || !this.active) return
                const peer = message.outgoing
                  ? message.recipient
                  : message.sender
                const conversation = await this.conversation(peer, transport)
                if (
                  generation !== this.generation ||
                  !this.active ||
                  message.conversationId !== conversation.id
                )
                  return
                const accepted = await this.repo.receive(message, conversation)
                if (generation !== this.generation || !this.active) return
                if (accepted) {
                  await this.refresh()
                  if (!message.outgoing && !conversation.muted)
                    this.arrivals.forEach((fn) => fn(message))
                }
              }).catch((error) => {
                onError(error)
                throw error
              }),
            onError
          )
        )
      }
      this.stop = () => stops.forEach((stop) => stop())
      this.recoverOutbox(generation)
    } catch (error) {
      stops.forEach((stop) => stop())
      if (generation === this.generation) {
        this.unwatch?.()
        this.unwatch = undefined
        this.fail(error)
      }
      throw error
    }
  }

  private fail(error?: unknown) {
    this.snapshot = {
      ...this.snapshot,
      ready: true,
      error: true,
      errorReason: error instanceof ChatCapacityError ? error.kind : undefined,
    }
    this.listeners.forEach((fn) => fn())
  }
  disconnect() {
    ++this.generation
    this.active = false
    this.outbox = []
    this.queued.clear()
    this.stop?.()
    this.unwatch?.()
    this.stop = undefined
    this.unwatch = undefined
    this.snapshot = {
      conversations: [],
      messages: [],
      ready: false,
      error: false,
    }
    this.listeners.forEach((fn) => fn())
  }
  private async conversation(
    peer: string,
    transport = this.transport
  ): Promise<Conversation> {
    const id = conversationId(transport, peer)
    return (
      (await this.repo.getConversation(id)) ?? {
        id,
        account: transport.account,
        channel: transport.channel,
        contextId: transport.contextId,
        capabilities:
          transport.capabilities ?? conversationCapabilities(transport),
        peer,
        updatedAt: 0,
        unread: 0,
        pinned: false,
        muted: false,
        blocked: false,
        preview: '',
        draft: '',
      }
    )
  }
  async open(
    address: string,
    context?: { channel: string; contextId?: string }
  ) {
    const transport = context
      ? this.transports.find(
          (t) =>
            t.channel === context.channel && t.contextId === context.contextId
        )
      : this.transport
    if (!transport) throw new Error('Conversation unavailable')
    const peer = transport.resolvePeer(address)
    if (!peer) throw new ChatAddressError('invalid')
    if (peer === (transport.identity ?? transport.account)) throw new ChatAddressError('self')
    const generation = this.generation
    return this.queue(async () => {
      const conversation = await this.conversation(peer, transport)
      if (!this.active || generation !== this.generation)
        throw new Error('Chat is locked')
      await this.repo.saveConversation({
        ...conversation,
        address,
        deletedAt: undefined,
      })
      await this.refresh()
      return conversation.id
    })
  }
  async enqueue(id: string, content: string, payment?: ChatPaymentLink) {
    const generation = this.generation
    const message = await this.createOutgoing(id, content, payment)
    this.schedule(message, generation)
  }
  private async createOutgoing(
    id: string,
    content: string,
    payment?: ChatPaymentLink
  ) {
    const generation = this.generation
    const trimmed = content.trim()
    if (payment && !parseChatPaymentLink(payment))
      throw new Error('Invalid chat payment link')
    if (
      !trimmed ||
      new TextEncoder().encode(trimmed).length > MAX_CHAT_MESSAGE_BYTES
    )
      throw new Error('Invalid message length')
    const message = await this.queue(async () => {
      const c = await this.repo.getConversation(id)
      if (!this.active || generation !== this.generation)
        throw new Error('Chat is locked')
      if (!c || c.blocked) throw new Error('Conversation unavailable')
      if (payment && !conversationCapabilities(c).payments)
        throw new Error('Payments unavailable')
      const transport = this.transports.find(
        (t) => t.channel === c.channel && t.contextId === c.contextId
      )
      if (!transport) throw new Error('Conversation unavailable')
      const m = transport.prepare(c.peer, trimmed, payment?.kind === 'request' ? { expiresAt: payment.expiresAt } : undefined)
      if (payment) m.payment = payment
      if (m.conversationId !== c.id) throw new Error('Chat scope mismatch')
      if (!(await this.repo.receive(m, { ...c, draft: '' })))
        throw new Error('Message was not saved')
      await this.refreshAfterWrite()
      return m
    })
    return message
  }
  private schedule(message: ChatMessage, generation: number) {
    if (
      !this.active ||
      generation !== this.generation ||
      this.queued.has(chatMessageKey(message)) ||
      this.sending.has(chatMessageKey(message))
    )
      return
    this.queued.add(chatMessageKey(message))
    this.outbox.push({ message, generation })
    this.drainOutbox()
  }
  private recoverOutbox(generation: number) {
    this.snapshot.messages
      .filter((message) => message.outgoing && message.status === 'sending')
      .forEach((message) => this.schedule(message, generation))
  }
  private drainOutbox() {
    while (this.active && this.delivering < 3 && this.outbox.length) {
      const job = this.outbox.shift()!
      this.queued.delete(chatMessageKey(job.message))
      if (job.generation !== this.generation) continue
      this.delivering++
      void this.deliver(job.message, job.generation)
        .catch(() => undefined)
        .finally(() => {
          this.delivering--
          this.drainOutbox()
        })
    }
  }
  private async deliver(message: ChatMessage, generation = this.generation) {
    if (!this.active || generation !== this.generation)
      throw new Error('Chat is locked')
    if (this.sending.has(chatMessageKey(message))) return
    this.sending.add(chatMessageKey(message))
    try {
      if (!(await this.repo.saveMessage({ ...message, status: 'sending' })))
        return
      await this.refreshAfterWrite()
      const c = await this.repo.getConversation(message.conversationId)
      if (
        !this.active ||
        generation !== this.generation ||
        !c ||
        c.blocked ||
        c.deletedAt
      )
        throw new Error('Chat unavailable')
      const transport = this.transports.find(
        (t) => t.channel === c?.channel && t.contextId === c?.contextId
      )
      if (!transport) throw new Error('Conversation unavailable')
      transport.resolvePeer(c?.address ?? message.recipient)
      await transport.send(message)
      await this.repo.saveMessage({ ...message, status: 'sent' })
    } catch (error) {
      try {
        await this.repo.saveMessage({ ...message, status: 'failed' })
      } catch (storageError) {
        if (this.active) this.fail(storageError)
      }
      throw error
    } finally {
      await this.queue(() => this.refresh()).catch((error) => {
        if (this.active) this.fail(error)
      })
      this.sending.delete(chatMessageKey(message))
    }
  }
  async retry(id: string, conversationId?: string) {
    const generation = this.generation
    if (!this.active) throw new Error('Chat is locked')
    const data = await this.repo.load()
    const matches = data.messages.filter(
      (m) =>
        m.id === id &&
        m.outgoing &&
        m.status !== 'sent' &&
        (!conversationId || m.conversationId === conversationId)
    )
    if (matches.length > 1) throw new Error('Conversation is required')
    const message = matches[0]
    if (
      message &&
      (this.queued.has(chatMessageKey(message)) ||
        this.sending.has(chatMessageKey(message)))
    )
      return
    if (
      message &&
      !data.conversations.find((c) => c.id === message.conversationId)?.blocked
    )
      await this.deliver(message, generation)
  }
  async markRead(id: string) {
    await this.patch(id, { unread: 0 })
  }
  async update(
    id: string,
    patch: Partial<Pick<Conversation, 'pinned' | 'muted' | 'blocked' | 'draft'>>
  ) {
    await this.patch(id, patch)
  }
  private async patch(id: string, patch: Partial<Conversation>) {
    const generation = this.generation
    if (
      patch.draft &&
      new TextEncoder().encode(patch.draft).length > MAX_CHAT_MESSAGE_BYTES
    )
      throw new Error('Draft too long')
    await this.queue(async () => {
      if (!this.active || generation !== this.generation) return
      const conversation = await this.repo.getConversation(id)
      if (!this.active || generation !== this.generation || !conversation)
        return
      if (
        patch.blocked !== undefined &&
        !conversationCapabilities(conversation).blocking
      )
        throw new Error('Blocking unavailable')
      await this.repo.updateConversation(id, patch)
      await this.refresh()
    })
  }
  async delete(id: string) {
    const generation = this.generation
    await this.queue(async () => {
      if (!this.active || generation !== this.generation) return
      const conversation = await this.repo.getConversation(id)
      if (!this.active || generation !== this.generation) return
      if (!conversation || !conversationCapabilities(conversation).deletion)
        throw new Error('Deletion unavailable')
      await this.repo.deleteConversation(id, Date.now())
      await this.refresh()
    })
  }
}
