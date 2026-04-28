import { CSClient, TicketId, decodeEnvelope, encodeEnvelope } from 'nostr-cs'
import type {
  EncryptedAttachment,
  Message as NostrCsMessage,
  StatusUpdate,
  Ticket as NostrCsTicket,
  TicketReply,
} from 'nostr-cs'
import { SimplePool } from 'nostr-tools/pool'
import type { CustomerSupportChannel } from '@/core/ports/driven/customer-support.port'
import type {
  CustomerSupportHistoryScope,
  CustomerSupportHistoryStore,
} from '@/core/ports/driven/customer-support-history-store.port'
import {
  isSupportTicketTerminal,
  type CreateSupportTicketCommand,
  type DownloadSupportAttachmentInput,
  type SendSupportMessageInput,
  type SupportAttachmentDownload,
  type SupportAttachmentUpload,
  type SupportAvailability,
  type SupportAttachment,
  type SupportListener,
  type SupportMessage,
  type SupportPriority,
  type SupportSnapshot,
  type SupportTicket,
  type SupportTicketStatus,
} from '@/core/domain/support'
import type {
  SupportAttachmentBlobStore,
  UploadedSupportAttachmentBlob,
} from './blossom-attachment-store.adapter'
import type { CustomerSupportConfig } from './customer-support-config'
import { ConfiguredNip66RelayIndexAdapter } from './configured-nip66-relay-index.adapter'
import { DerivedCustomerSupportKeyProvider } from './derived-customer-support-key-provider'
import {
  decryptSupportAttachment,
  encryptSupportAttachment,
} from './support-attachment-crypto'

export class NostrCsCustomerSupportAdapter implements CustomerSupportChannel {
  private client: CSClient | null = null
  private discoveryPool: SimplePool | null = null
  private unsubscribeSdk: Array<() => void> = []
  private readonly listeners = new Set<SupportListener>()
  private readonly tickets = new Map<string, SupportTicket>()
  private readonly messages = new Map<string, SupportMessage[]>()
  private readonly attachmentSources = new Map<string, EncryptedAttachment>()
  private status: SupportSnapshot['status'] = 'idle'
  private error: string | undefined
  private customerId: string | null = null
  private connectionGeneration = 0

  constructor(
    private readonly config: CustomerSupportConfig,
    private readonly keyProvider: DerivedCustomerSupportKeyProvider,
    private readonly historyStore?: CustomerSupportHistoryStore,
    private readonly attachmentStore?: SupportAttachmentBlobStore,
  ) {}

  getAvailability(): SupportAvailability {
    return { available: true }
  }

  getSnapshot(): SupportSnapshot {
    return {
      status: this.status,
      availability: this.getAvailability(),
      capabilities: {
        attachments: {
          available: this.config.attachments.servers.length > 0 && this.attachmentStore !== undefined,
          maxCount: this.config.attachments.maxCount,
          maxSizeBytes: this.config.attachments.maxSizeBytes,
        },
      },
      customerId: this.customerId,
      tickets: [...this.tickets.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      messages: Object.fromEntries(
        [...this.messages.entries()].map(([ticketId, list]) => [
          ticketId,
          [...list].sort((a, b) => a.createdAt - b.createdAt),
        ]),
      ),
      ...(this.error ? { error: this.error } : {}),
    }
  }

  async connect(): Promise<SupportSnapshot> {
    if (this.client && this.status === 'connected') {
      return this.getSnapshot()
    }

    this.status = 'connecting'
    this.error = undefined
    this.emit()

    const generation = ++this.connectionGeneration
    const discoveryPool = new SimplePool()
    const relayIndex = new ConfiguredNip66RelayIndexAdapter(
      discoveryPool,
      this.config.relays.discovery,
    )
    const client = new CSClient({
      key: { type: 'signer', value: this.keyProvider },
      relays: {
        bootstrap: this.config.relays.bootstrap,
        write: this.config.relays.write,
        read: this.config.relays.read,
        dm: this.config.relays.dm,
      },
      infrastructure: { relayIndex },
    })
    this.discoveryPool = discoveryPool
    this.client = client

    try {
      await client.connect()
      if (!this.isActiveConnection(generation, client)) {
        await this.cleanupSupersededConnection(client, discoveryPool)
        return this.getSnapshot()
      }

      this.customerId = await this.keyProvider.getPubkey()
      if (!this.isActiveConnection(generation, client)) {
        await this.cleanupSupersededConnection(client, discoveryPool)
        return this.getSnapshot()
      }

      await this.restoreCachedHistory()
      if (!this.isActiveConnection(generation, client)) {
        await this.cleanupSupersededConnection(client, discoveryPool)
        return this.getSnapshot()
      }

      this.attachSdkListeners(client)
      await client.pullOwnHistory().catch(() => undefined)
      if (!this.isActiveConnection(generation, client)) {
        await this.cleanupSupersededConnection(client, discoveryPool)
        return this.getSnapshot()
      }

      this.status = 'connected'
      this.emit()
      return this.getSnapshot()
    } catch (error) {
      if (!this.isActiveConnection(generation, client)) {
        await this.cleanupSupersededConnection(client, discoveryPool)
        return this.getSnapshot()
      }
      await this.disconnect()
      this.status = 'error'
      this.error = error instanceof Error ? error.message : 'Customer support connection failed'
      this.emit()
      return this.getSnapshot()
    }
  }

  async disconnect(): Promise<void> {
    this.connectionGeneration += 1

    for (const unsubscribe of this.unsubscribeSdk) {
      unsubscribe()
    }
    this.unsubscribeSdk = []

    if (this.client) {
      await this.client.disconnect().catch(() => undefined)
      this.client = null
    }
    if (this.discoveryPool) {
      this.discoveryPool.destroy()
      this.discoveryPool = null
    }

    if (this.status !== 'disabled') {
      this.status = 'idle'
      this.emit()
    }
  }

  async refresh(): Promise<SupportSnapshot> {
    if (this.status !== 'connected' || !this.client) {
      return this.connect()
    }

    await this.disconnect()
    return this.connect()
  }

  async createTicket(input: CreateSupportTicketCommand): Promise<SupportTicket> {
    await this.ensureConnected()
    const body = input.body.trim()
    const encoded = await this.encodeSupportBody(body, input.attachments)
    const ticket = await this.client!.createTicket({
      title: input.title,
      body: encoded.body,
      agentPubkey: this.config.agentPubkey,
      priority: toSdkPriority(input.priority),
      category: input.category,
    }).catch(async (error: unknown) => {
      await this.cleanupUploadedAttachments(encoded.uploaded)
      throw error
    }).finally(() => {
      wipeUploadedAttachmentSecrets(encoded.uploaded)
    })

    const mapped = this.upsertTicket(ticket)
    this.addMessage({
      id: `ticket:${mapped.id}`,
      ticketId: mapped.id,
      threadId: mapped.threadId,
      body,
      sender: 'customer',
      channel: 'thread',
      createdAt: mapped.createdAt,
      ...(encoded.attachments.length > 0 ? {
        attachments: encoded.attachments.map((attachment) => toSupportAttachment(attachment, 'available')),
      } : {}),
    })
    this.emit()
    return mapped
  }

  async sendMessage(input: SendSupportMessageInput): Promise<void> {
    await this.ensureConnected()
    const body = input.body.trim()
    const ticket = this.tickets.get(input.ticketId)
    if (!ticket) {
      throw new Error('Support ticket not found')
    }
    if (isSupportTicketTerminal(ticket.status)) {
      throw new Error('Support ticket is already resolved')
    }

    const encoded = await this.encodeSupportBody(body, input.attachments)
    await this.client!.sendMessage({
      ticketId: TicketId.fromString(ticket.id),
      threadRoot: ticket.threadId,
      content: encoded.body,
      recipientPubkey: this.config.agentPubkey,
    }).catch(async (error: unknown) => {
      await this.cleanupUploadedAttachments(encoded.uploaded)
      throw error
    }).finally(() => {
      wipeUploadedAttachmentSecrets(encoded.uploaded)
    })

    this.addMessage({
      id: `local:${ticket.id}:${Date.now()}`,
      ticketId: ticket.id,
      threadId: ticket.threadId,
      body,
      sender: 'customer',
      channel: 'private',
      createdAt: Date.now(),
      ...(encoded.attachments.length > 0 ? {
        attachments: encoded.attachments.map((attachment) => toSupportAttachment(attachment, 'available')),
      } : {}),
    })
    this.touchTicket(ticket.id)
    this.emit()
  }

  async downloadAttachment(input: DownloadSupportAttachmentInput): Promise<SupportAttachmentDownload> {
    if (!this.attachmentStore) {
      throw new Error('Support attachment storage is not configured')
    }

    const attachment = this.attachmentSources.get(input.attachmentId)
    if (!attachment) {
      throw new Error('Support attachment is not ready yet')
    }

    const ciphertext = await this.attachmentStore.download({
      blobSha256: attachment.blossom.blob_sha256,
      servers: attachment.blossom.servers,
    })
    const data = await decryptSupportAttachment({
      ciphertext,
      key: attachment.key,
      iv: attachment.iv,
      expectedCiphertextSha256: attachment.blossom.blob_sha256,
      expectedPlaintextSha256: attachment.sha256,
    })

    return {
      ...(attachment.name ? { name: attachment.name } : {}),
      mime: attachment.mime,
      data,
    }
  }

  async markTicketRead(ticketId: string, readAt = Date.now()): Promise<void> {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) return

    const updated = { ...ticket, readAt }
    this.tickets.set(ticketId, updated)
    this.persistTicket(updated)

    const scope = this.getHistoryScope()
    if (scope && this.historyStore) {
      await this.historyStore.markTicketRead(scope, ticketId, readAt).catch(() => undefined)
    }

    this.emit()
  }

  subscribe(listener: SupportListener): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  async destroy(): Promise<void> {
    await this.disconnect()
    this.keyProvider.destroy()
  }

  private attachSdkListeners(client: CSClient): void {
    this.unsubscribeSdk = [
      client.onTicket((ticket) => {
        if (!this.isConfiguredTicket(ticket)) return
        this.upsertTicket(ticket)
        this.emit()
      }),
      client.onReply((reply) => {
        const sender = this.getSenderRole(reply.byPubkey)
        if (!sender || !this.isKnownTicketThread(reply.ticketId.toString(), reply.threadRoot)) return
        this.addMessage(this.fromReply(reply, sender))
        this.touchTicket(reply.ticketId.toString(), reply.at)
        this.emit()
      }),
      client.onMessage((message) => {
        if (message.channel === 'reply') return
        const sender = this.getSenderRole(message.senderPubkey)
        if (!sender || !this.isKnownTicketThread(message.ticketId.toString(), message.threadRoot)) return
        this.addMessage(this.fromMessage(message, sender))
        this.touchTicket(message.ticketId.toString(), message.createdAt)
        this.emit()
      }),
      client.onStatusChange((update) => {
        if (
          update.byPubkey !== this.config.agentPubkey ||
          !this.isKnownTicketThread(update.ticketId.toString(), update.threadRoot)
        ) {
          return
        }
        this.updateStatus(update)
        this.emit()
      }),
    ]
  }

  private isActiveConnection(generation: number, client: CSClient): boolean {
    return this.connectionGeneration === generation && this.client === client
  }

  private async cleanupSupersededConnection(client: CSClient, discoveryPool: SimplePool): Promise<void> {
    await client.disconnect().catch(() => undefined)
    discoveryPool.destroy()
  }

  private async restoreCachedHistory(): Promise<void> {
    const scope = this.getHistoryScope()
    if (!scope || !this.historyStore) return

    const history = await this.historyStore.load(scope).catch(() => null)
    if (!history) return

    for (const ticket of history.tickets) {
      this.tickets.set(ticket.id, ticket)
    }
    for (const [ticketId, messages] of Object.entries(history.messages)) {
      this.messages.set(ticketId, messages.map(withCachedAttachmentState))
    }
    this.emit()
  }

  private isConfiguredTicket(ticket: NostrCsTicket): boolean {
    return (
      this.customerId !== null &&
      ticket.customerPubkey === this.customerId &&
      ticket.agentPubkey === this.config.agentPubkey
    )
  }

  private getSenderRole(pubkey: string): SupportMessage['sender'] | null {
    if (pubkey === this.customerId) return 'customer'
    if (pubkey === this.config.agentPubkey) return 'support'
    return null
  }

  private isKnownTicketThread(ticketId: string, threadRoot: string): boolean {
    const ticket = this.tickets.get(ticketId)
    return ticket?.threadId === threadRoot
  }

  private async ensureConnected(): Promise<void> {
    if (this.status !== 'connected' || !this.client) {
      const snapshot = await this.connect()
      if (snapshot.status !== 'connected') {
        throw new Error(snapshot.error ?? 'Customer support is unavailable')
      }
    }
  }

  private upsertTicket(ticket: NostrCsTicket): SupportTicket {
    const id = ticket.id.toString()
    const createdAt = ticket.createdAt * 1000
    const previous = this.tickets.get(id)
    const decoded = decodeSupportEnvelope(ticket.body)
    this.registerAttachmentSources(decoded.encryptedAttachments)
    const mapped: SupportTicket = {
      id,
      threadId: ticket.eventId,
      title: ticket.title,
      body: decoded.text,
      status: ticket.status as SupportTicketStatus,
      priority: ticket.priority as SupportPriority,
      category: ticket.category,
      createdAt,
      updatedAt: previous?.updatedAt ?? createdAt,
      ...(previous?.readAt ? { readAt: previous.readAt } : {}),
    }
    this.tickets.set(id, mapped)
    this.persistTicket(mapped)
    return mapped
  }

  private updateStatus(update: StatusUpdate): void {
    const id = update.ticketId.toString()
    const ticket = this.tickets.get(id)
    if (!ticket) return

    const updated = {
      ...ticket,
      status: update.newStatus as SupportTicketStatus,
      updatedAt: update.at * 1000,
    }
    this.tickets.set(id, updated)
    this.persistTicket(updated)
  }

  private touchTicket(ticketId: string, createdAtSeconds?: number): void {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) return
    const updated = {
      ...ticket,
      updatedAt: createdAtSeconds ? createdAtSeconds * 1000 : Date.now(),
    }
    this.tickets.set(ticketId, updated)
    this.persistTicket(updated)
  }

  private addMessage(message: SupportMessage): void {
    const list = this.messages.get(message.ticketId) ?? []
    if (list.some((item) => item.id === message.id)) return
    this.messages.set(message.ticketId, [...list, message])
    this.persistMessage(message)
  }

  private fromReply(reply: TicketReply, sender: SupportMessage['sender']): SupportMessage {
    const ticketId = reply.ticketId.toString()
    const decoded = decodeSupportEnvelope(reply.body)
    this.registerAttachmentSources(decoded.encryptedAttachments)
    return {
      id: `reply:${ticketId}:${reply.at}:${reply.byPubkey}`,
      ticketId,
      threadId: reply.threadRoot,
      body: decoded.text,
      sender,
      channel: 'thread',
      createdAt: reply.at * 1000,
      ...(decoded.attachments.length > 0 ? { attachments: decoded.attachments } : {}),
    }
  }

  private fromMessage(message: NostrCsMessage, sender: SupportMessage['sender']): SupportMessage {
    const ticketId = message.ticketId.toString()
    const decoded = decodeSupportEnvelope(message.body)
    this.registerAttachmentSources(decoded.encryptedAttachments)
    return {
      id: `message:${ticketId}:${message.createdAt}:${message.senderPubkey}`,
      ticketId,
      threadId: message.threadRoot,
      body: decoded.text,
      sender,
      channel: message.channel === 'reply' ? 'thread' : 'private',
      createdAt: message.createdAt * 1000,
      ...(decoded.attachments.length > 0 ? { attachments: decoded.attachments } : {}),
    }
  }

  private registerAttachmentSources(attachments: EncryptedAttachment[]): void {
    for (const attachment of attachments) {
      this.attachmentSources.set(attachment.blossom.blob_sha256, attachment)
    }
  }

  private async encodeSupportBody(text: string, attachments?: SupportAttachmentUpload[]): Promise<{
    body: string
    attachments: EncryptedAttachment[]
    uploaded: UploadedAttachment[]
  }> {
    const normalizedAttachments = attachments ?? []
    if (normalizedAttachments.length === 0) {
      return { body: encodeEnvelope({ v: 1, text, attachments: [] }), attachments: [], uploaded: [] }
    }
    if (!this.attachmentStore || this.config.attachments.servers.length === 0) {
      throw new Error('Support attachment storage is not configured')
    }
    if (normalizedAttachments.length > this.config.attachments.maxCount) {
      throw new Error('Too many support attachments')
    }

    const encryptedAttachments: EncryptedAttachment[] = []
    const uploaded: UploadedAttachment[] = []

    try {
      for (const attachment of normalizedAttachments) {
        if (attachment.size > this.config.attachments.maxSizeBytes) {
          throw new Error('Support attachment is too large')
        }

        const encrypted = await encryptSupportAttachment(attachment.data)
        const upload = await this.attachmentStore.upload({
          ciphertext: encrypted.ciphertext,
          ciphertextSha256: encrypted.ciphertextSha256,
          contentType: 'application/octet-stream',
        })
        const encryptedAttachment: EncryptedAttachment = {
          type: 'encrypted_blob',
          mime: attachment.mime || 'application/octet-stream',
          ...(attachment.name ? { name: attachment.name } : {}),
          size: attachment.size,
          sha256: encrypted.plaintextSha256,
          cipher: 'aes-256-gcm',
          key: encrypted.key,
          iv: encrypted.iv,
          blossom: {
            blob_sha256: encrypted.ciphertextSha256,
            servers: upload.servers,
          },
        }
        encryptedAttachments.push(encryptedAttachment)
        uploaded.push({
          blobSha256: encrypted.ciphertextSha256,
          servers: upload.servers,
          uploaderSecretKey: upload.uploaderSecretKey,
        })
        this.attachmentSources.set(encrypted.ciphertextSha256, encryptedAttachment)
      }
    } catch (error) {
      await this.cleanupUploadedAttachments(uploaded)
      wipeUploadedAttachmentSecrets(uploaded)
      throw error
    }

    return {
      body: encodeEnvelope({ v: 1, text, attachments: encryptedAttachments }),
      attachments: encryptedAttachments,
      uploaded,
    }
  }

  private async cleanupUploadedAttachments(uploaded: UploadedAttachment[]): Promise<void> {
    if (!this.attachmentStore) return
    await Promise.all(uploaded.map((attachment) => this.attachmentStore!.delete({
      blobSha256: attachment.blobSha256,
      uploaderSecretKey: attachment.uploaderSecretKey,
      servers: attachment.servers,
    }).catch(() => undefined)))
  }

  private getHistoryScope(): CustomerSupportHistoryScope | null {
    if (!this.customerId) return null
    return {
      customerId: this.customerId,
      agentPubkey: this.config.agentPubkey,
    }
  }

  private persistTicket(ticket: SupportTicket): void {
    const scope = this.getHistoryScope()
    if (!scope || !this.historyStore) return
    this.historyStore.saveTicket(scope, ticket).catch(() => undefined)
  }

  private persistMessage(message: SupportMessage): void {
    const scope = this.getHistoryScope()
    if (!scope || !this.historyStore) return
    this.historyStore.saveMessage(scope, message).catch(() => undefined)
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

interface UploadedAttachment extends UploadedSupportAttachmentBlob {
  blobSha256: string
}

function toSdkPriority(priority: SupportPriority): 'normal' | 'high' {
  return priority
}

function decodeSupportEnvelope(body: string): {
  text: string
  attachments: SupportAttachment[]
  encryptedAttachments: EncryptedAttachment[]
} {
  const envelope = decodeEnvelope(body)
  return {
    text: envelope.text,
    attachments: envelope.attachments.map((attachment) => toSupportAttachment(attachment, 'available')),
    encryptedAttachments: envelope.attachments,
  }
}

function toSupportAttachment(
  attachment: EncryptedAttachment,
  state: SupportAttachment['state'],
): SupportAttachment {
  return {
    id: attachment.blossom.blob_sha256,
    ...(attachment.name ? { name: attachment.name } : {}),
    mime: attachment.mime,
    size: attachment.size,
    state,
  }
}

function withCachedAttachmentState(message: SupportMessage): SupportMessage {
  if (!message.attachments || message.attachments.length === 0) return message
  return {
    ...message,
    attachments: message.attachments.map((attachment) => ({
      ...attachment,
      state: 'metadata_only',
    })),
  }
}

function wipeUploadedAttachmentSecrets(uploaded: UploadedAttachment[]): void {
  for (const attachment of uploaded) {
    attachment.uploaderSecretKey.fill(0)
  }
}
