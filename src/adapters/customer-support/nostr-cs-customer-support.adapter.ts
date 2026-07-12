import { CSClient, TicketId, decodeEnvelope, encodeEnvelope } from 'nostr-cs'
import type {
  Category as NostrCsCategory,
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
import type { SupportRelaysProvider } from '@/core/ports/driven/support-relays.port'
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
  type SupportStatusEvent,
  type SupportTicket,
  type SupportTicketStatus,
} from '@/core/domain/support'
import type {
  SupportAttachmentBlobStore,
  UploadedSupportAttachmentBlob,
} from './blossom-attachment-store.adapter'
import type { CustomerSupportConfig } from './customer-support-config'
import { RequestGate } from '@/core/utils/request-gate'
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
  private unsubscribeRelays: (() => void) | null = null
  private readonly listeners = new Set<SupportListener>()
  private readonly tickets = new Map<string, SupportTicket>()
  private readonly messages = new Map<string, SupportMessage[]>()
  private readonly attachmentSources = new Map<string, EncryptedAttachment>()
  private readonly statusEvents = new Map<string, SupportStatusEvent[]>()
  private readonly pendingStatusUpdates = new Map<string, StatusUpdate[]>()
  private status: SupportSnapshot['status'] = 'idle'
  private error: string | undefined
  private customerId: string | null = null
  private connectionGeneration = 0
  private lastUserRelays: string[] = []
  /**
   * connect single-flight. The prior guard (early return when :connected) only
   * filtered already-"completed" connections, so duplicate calls during
   * connecting (global hook + SupportPage mount racing) each ran a SimplePool
   * handshake + NIP-66 lookup.
   * The 10s failureCooldown is intentionally not applied here (0): doConnect
   * never rejects — errors come back as a snapshot (status:'error') — so there is
   * nothing to cool down. State-based retry backoff is revisited separately.
   */
  private readonly connectGate = new RequestGate({ cooldownMs: 0, failureCooldownMs: 0 })

  constructor(
    private readonly config: CustomerSupportConfig,
    private readonly keyProvider: DerivedCustomerSupportKeyProvider,
    private readonly relaysProvider: SupportRelaysProvider,
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
      tickets: [...this.tickets.values()]
        .filter((ticket) => ticket.archivedAt === undefined)
        .sort(compareSupportTickets),
      messages: Object.fromEntries(
        [...this.messages.entries()].map(([ticketId, list]) => [
          ticketId,
          [...list]
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((message) => this.withResolvedAttachmentState(message)),
        ]),
      ),
      statusEvents: Object.fromEntries(
        [...this.statusEvents.entries()].map(([ticketId, list]) => [
          ticketId,
          [...list].sort((a, b) => a.at - b.at),
        ]),
      ),
      ...(this.error ? { error: this.error } : {}),
    }
  }

  async connect(): Promise<SupportSnapshot> {
    if (this.client && this.status === 'connected') {
      return this.getSnapshot()
    }
    // Include generation in the gate key: when refresh()'s disconnect bumps the
    // generation, the immediately following connect() starts a fresh connection
    // under the new key instead of joining the existing (soon self-superseding)
    // in-flight one. Only concurrent calls of the same generation are shared.
    const { value } = await this.connectGate.run(
      `connect:${this.connectionGeneration}`,
      () => this.doConnect(),
    )
    return value
  }

  private async doConnect(): Promise<SupportSnapshot> {
    this.status = 'connecting'
    this.error = undefined
    this.emit()

    // Don't bump generation here — doing so would invalidate the gate key
    // (connect:<gen>) at the very start, so concurrent calls could never share
    // the in-flight one. Only disconnect() bumps it: the supersede signal for an
    // in-progress connection and the source of the new gate key.
    const generation = this.connectionGeneration
    let discoveryPool: SimplePool | null = null
    let client: CSClient | null = null

    try {
      this.customerId = await this.keyProvider.getPubkey()
      if (!this.isActiveGeneration(generation)) {
        return this.getSnapshot()
      }

      await this.restoreCachedHistory()
      if (!this.isActiveGeneration(generation)) {
        return this.getSnapshot()
      }

      const userRelays = this.relaysProvider.getRelays()
      const effectiveUserRelays = userRelays.length > 0
        ? userRelays
        : [...this.config.relays.bootstrap]
      this.lastUserRelays = effectiveUserRelays

      discoveryPool = new SimplePool()
      const relayIndex = new ConfiguredNip66RelayIndexAdapter(
        discoveryPool,
        this.config.relays.discovery,
      )
      client = new CSClient({
        key: { type: 'signer', value: this.keyProvider },
        relays: {
          bootstrap: this.config.relays.bootstrap,
          write: effectiveUserRelays,
          read: effectiveUserRelays,
          dm: effectiveUserRelays,
        },
        infrastructure: { relayIndex },
      })
      this.discoveryPool = discoveryPool
      this.client = client

      await client.connect()
      if (!this.isActiveConnection(generation, client)) {
        await this.cleanupSupersededConnection(client, discoveryPool)
        return this.getSnapshot()
      }

      this.attachSdkListeners(client)
      this.attachRelaysListener()
      await client.pullOwnHistory().catch(() => undefined)
      if (!this.isActiveConnection(generation, client)) {
        await this.cleanupSupersededConnection(client, discoveryPool)
        return this.getSnapshot()
      }

      this.status = 'connected'
      this.emit()
      return this.getSnapshot()
    } catch (error) {
      if (client && discoveryPool && !this.isActiveConnection(generation, client)) {
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

    if (this.unsubscribeRelays) {
      this.unsubscribeRelays()
      this.unsubscribeRelays = null
    }

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
      // nostr-cs ships a narrow Category type, but the SDK runtime publishes
      // category as a free-form string tag. We extend the vocabulary with
      // 'idea_*' so the agent can filter by tag (#category) on the relay side.
      category: input.category as NostrCsCategory,
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
    if (ticket.archivedAt !== undefined) {
      throw new Error('Support ticket is archived')
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

  async archiveTicket(ticketId: string, archivedAt = Date.now()): Promise<void> {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) return

    const updated = { ...ticket, archivedAt }
    this.tickets.set(ticketId, updated)
    this.emit()

    const scope = this.getHistoryScope()
    if (!scope || !this.historyStore) return

    try {
      await this.historyStore.archiveTicket(scope, ticketId, archivedAt)
    } catch (error) {
      this.tickets.set(ticketId, ticket)
      this.emit()
      throw error
    }
  }

  async setTicketPinned(ticketId: string, pinnedAt: number | null): Promise<void> {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) return

    const updated = {
      ...ticket,
      ...(pinnedAt === null ? {} : { pinnedAt }),
    }
    if (pinnedAt === null) {
      delete updated.pinnedAt
    }
    this.tickets.set(ticketId, updated)
    this.emit()

    const scope = this.getHistoryScope()
    if (!scope || !this.historyStore) return

    try {
      await this.historyStore.setTicketPinned(scope, ticketId, pinnedAt)
    } catch (error) {
      this.tickets.set(ticketId, ticket)
      this.emit()
      throw error
    }
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

  private withResolvedAttachmentState(message: SupportMessage): SupportMessage {
    if (!message.attachments || message.attachments.length === 0) return message
    return {
      ...message,
      attachments: message.attachments.map((attachment) => ({
        ...attachment,
        state: this.attachmentSources.has(attachment.id) ? 'available' : 'metadata_only',
      })),
    }
  }

  private attachRelaysListener(): void {
    if (this.unsubscribeRelays) {
      this.unsubscribeRelays()
    }
    this.unsubscribeRelays = this.relaysProvider.subscribe((next) => {
      const incoming = next.length > 0 ? next : [...this.config.relays.bootstrap]
      if (relayListsEqual(this.lastUserRelays, incoming)) return
      this.refresh().catch(() => undefined)
    })
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

  private isActiveGeneration(generation: number): boolean {
    return this.connectionGeneration === generation
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
      // Preserve in-memory state: live updates (status, archive, pinned) may
      // not have been persisted yet (fire-and-forget). Only fill gaps.
      if (this.tickets.has(ticket.id)) continue
      this.tickets.set(ticket.id, ticket)
    }
    for (const [ticketId, messages] of Object.entries(history.messages)) {
      // Cached messages keep whatever state was persisted; getSnapshot() derives
      // the live state from this.attachmentSources after live events repopulate.
      if (this.messages.has(ticketId)) continue
      this.messages.set(ticketId, messages)
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
    const incomingStatus = ticket.status as SupportTicketStatus
    // Terminal status sticks. Also prefer previous state if it's been
    // touched (updatedAt advanced past createdAt by a status event).
    const status = previous && (
      isSupportTicketTerminal(previous.status) || previous.updatedAt > createdAt
    )
      ? previous.status
      : incomingStatus
    const mapped: SupportTicket = {
      id,
      threadId: ticket.eventId,
      title: ticket.title,
      body: decoded.text,
      status,
      priority: ticket.priority as SupportPriority,
      category: ticket.category,
      createdAt,
      updatedAt: previous?.updatedAt ?? createdAt,
      ...(previous?.readAt ? { readAt: previous.readAt } : {}),
      ...(previous?.archivedAt ? { archivedAt: previous.archivedAt } : {}),
      ...(previous?.pinnedAt ? { pinnedAt: previous.pinnedAt } : {}),
    }
    this.tickets.set(id, mapped)
    this.persistTicket(mapped)
    // Apply any status events that arrived before this ticket.
    this.flushPendingStatusUpdates(id)
    return mapped
  }

  private updateStatus(update: StatusUpdate): void {
    const id = update.ticketId.toString()
    const ticket = this.tickets.get(id)
    if (!ticket) {
      // Status event arrived before the ticket itself (relays don't guarantee
      // delivery order). Queue and replay once the ticket is upserted —
      // otherwise terminal events like 'closed' would be silently dropped.
      const pending = this.pendingStatusUpdates.get(id) ?? []
      pending.push(update)
      this.pendingStatusUpdates.set(id, pending)
      return
    }

    // Terminal lock: once resolved/closed, the ticket is final. Ignore any
    // further status events (out-of-order replay, agent re-open, stale relay
    // delivery) so the customer never sees the status revert.
    if (isSupportTicketTerminal(ticket.status)) return

    // Timestamp guard: only newer events win. Protects against out-of-order
    // delivery from multiple relays.
    const updateAtMs = update.at * 1000
    if (updateAtMs < ticket.updatedAt) return

    const updated = {
      ...ticket,
      status: update.newStatus as SupportTicketStatus,
      updatedAt: updateAtMs,
    }
    this.tickets.set(id, updated)
    this.persistTicket(updated)

    const event: SupportStatusEvent = {
      id: `status:${id}:${update.at}:${update.newStatus}`,
      ticketId: id,
      threadId: ticket.threadId,
      from: ticket.status,
      to: update.newStatus as SupportTicketStatus,
      at: updateAtMs,
    }
    const list = this.statusEvents.get(id) ?? []
    if (!list.some((existing) => existing.id === event.id)) {
      this.statusEvents.set(id, [...list, event])
    }
  }

  private flushPendingStatusUpdates(ticketId: string): void {
    const pending = this.pendingStatusUpdates.get(ticketId)
    if (!pending) return
    this.pendingStatusUpdates.delete(ticketId)
    // Apply chronologically so the terminal lock engages on the latest
    // terminal event regardless of original arrival order.
    pending.sort((a, b) => a.at - b.at)
    for (const update of pending) {
      this.updateStatus(update)
    }
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

function relayListsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] !== sortedB[i]) return false
  }
  return true
}

function compareSupportTickets(a: SupportTicket, b: SupportTicket): number {
  if (a.pinnedAt !== undefined || b.pinnedAt !== undefined) {
    return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
  }
  return b.updatedAt - a.updatedAt
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

function wipeUploadedAttachmentSecrets(uploaded: UploadedAttachment[]): void {
  for (const attachment of uploaded) {
    attachment.uploaderSecretKey.fill(0)
  }
}
