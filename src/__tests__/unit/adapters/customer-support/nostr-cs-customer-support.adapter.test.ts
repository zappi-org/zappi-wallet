import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Message as NostrCsMessage,
  StatusUpdate,
  Ticket as NostrCsTicket,
  TicketReply,
} from 'nostr-cs'
import { NostrCsCustomerSupportAdapter } from '@/adapters/customer-support/nostr-cs-customer-support.adapter'
import type { CustomerSupportConfig } from '@/adapters/customer-support/customer-support-config'
import type { SupportAttachmentBlobStore } from '@/adapters/customer-support/blossom-attachment-store.adapter'
import type { DerivedCustomerSupportKeyProvider } from '@/adapters/customer-support/derived-customer-support-key-provider'
import type { CustomerSupportHistoryStore } from '@/core/ports/driven/customer-support-history-store.port'

const nostrCsMock = vi.hoisted(() => {
  class MockTicketId {
    constructor(private readonly value: string) {}

    static fromString(value: string): MockTicketId {
      return new MockTicketId(value)
    }

    toString(): string {
      return this.value
    }
  }

  class MockCSClient {
    static instances: MockCSClient[] = []
    static connectImpl: (_client: MockCSClient) => Promise<void> = async () => {}
    static createTicketImpl: (_params: unknown) => Promise<unknown> = async () => {
      throw new Error('createTicket mock not configured')
    }
    static sendMessageImpl: (_params: unknown) => Promise<void> = async () => {}
    static pullOwnHistoryCalls = 0

    private readonly ticketHandlers: Array<(ticket: unknown) => void> = []
    private readonly replyHandlers: Array<(reply: unknown) => void> = []
    private readonly messageHandlers: Array<(message: unknown) => void> = []
    private readonly statusHandlers: Array<(update: unknown) => void> = []

    constructor() {
      MockCSClient.instances.push(this)
    }

    async connect(): Promise<void> {
      return MockCSClient.connectImpl(this)
    }
    async disconnect(): Promise<void> {}
    async pullOwnHistory(): Promise<void> {
      MockCSClient.pullOwnHistoryCalls += 1
    }
    async createTicket(params: unknown): Promise<unknown> {
      return MockCSClient.createTicketImpl(params)
    }
    async sendMessage(params: unknown): Promise<void> {
      return MockCSClient.sendMessageImpl(params)
    }

    onTicket(handler: (ticket: unknown) => void): () => void {
      this.ticketHandlers.push(handler)
      return () => {}
    }

    onReply(handler: (reply: unknown) => void): () => void {
      this.replyHandlers.push(handler)
      return () => {}
    }

    onMessage(handler: (message: unknown) => void): () => void {
      this.messageHandlers.push(handler)
      return () => {}
    }

    onStatusChange(handler: (update: unknown) => void): () => void {
      this.statusHandlers.push(handler)
      return () => {}
    }

    emitTicket(ticket: unknown): void {
      for (const handler of this.ticketHandlers) handler(ticket)
    }

    emitReply(reply: unknown): void {
      for (const handler of this.replyHandlers) handler(reply)
    }

    emitMessage(message: unknown): void {
      for (const handler of this.messageHandlers) handler(message)
    }

    emitStatus(update: unknown): void {
      for (const handler of this.statusHandlers) handler(update)
    }

    getHandlerCount(): number {
      return (
        this.ticketHandlers.length +
        this.replyHandlers.length +
        this.messageHandlers.length +
        this.statusHandlers.length
      )
    }
  }

  return { MockCSClient, MockTicketId }
})

vi.mock('nostr-cs', () => ({
  CSClient: nostrCsMock.MockCSClient,
  TicketId: nostrCsMock.MockTicketId,
  encodeEnvelope: (env: { v: 1; text: string; attachments: unknown[] }) => JSON.stringify(env),
  decodeEnvelope: (body: string) => {
    try {
      const parsed = JSON.parse(body) as { v?: number; text?: unknown; attachments?: unknown }
      if (parsed.v === 1) {
        return {
          v: 1,
          text: typeof parsed.text === 'string' ? parsed.text : '',
          attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
        }
      }
    } catch {
      return { v: 1, text: body, attachments: [] }
    }
    return { v: 1, text: body, attachments: [] }
  },
}))

vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    destroy(): void {}
  },
}))

vi.mock('@/adapters/customer-support/support-attachment-crypto', () => ({
  encryptSupportAttachment: vi.fn().mockResolvedValue({
    ciphertext: new Uint8Array([9, 8, 7]),
    key: 'mock-key',
    iv: 'mock-iv',
    plaintextSha256: 'mock-plain-sha',
    ciphertextSha256: 'mock-cipher-sha',
  }),
  decryptSupportAttachment: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}))

const agentPubkey = 'a'.repeat(64)
const customerPubkey = 'b'.repeat(64)
const attackerPubkey = 'c'.repeat(64)

const config: CustomerSupportConfig = {
  agentPubkey,
  relays: {
    bootstrap: ['wss://relay.example/'],
    write: ['wss://relay.example/'],
    read: ['wss://relay.example/'],
    dm: ['wss://relay.example/'],
    discovery: ['wss://relay.example/'],
  },
  attachments: {
    servers: [],
    maxCount: 3,
    maxSizeBytes: 10_000,
  },
}

describe('NostrCsCustomerSupportAdapter', () => {
  beforeEach(() => {
    nostrCsMock.MockCSClient.instances.length = 0
    nostrCsMock.MockCSClient.connectImpl = async () => {}
    nostrCsMock.MockCSClient.createTicketImpl = async () => {
      throw new Error('createTicket mock not configured')
    }
    nostrCsMock.MockCSClient.sendMessageImpl = async () => {}
    nostrCsMock.MockCSClient.pullOwnHistoryCalls = 0
  })

  it('only accepts tickets and status updates bound to the configured support agent', async () => {
    const { adapter, client } = await connectAdapter()

    client.emitTicket(makeTicket({ agentPubkey: attackerPubkey }))
    expect(adapter.getSnapshot().tickets).toHaveLength(0)

    client.emitTicket(makeTicket())
    expect(adapter.getSnapshot().tickets[0]?.status).toBe('open')

    client.emitStatus(makeStatusUpdate({ byPubkey: attackerPubkey, newStatus: 'closed' }))
    expect(adapter.getSnapshot().tickets[0]?.status).toBe('open')

    client.emitStatus(makeStatusUpdate({ byPubkey: agentPubkey, newStatus: 'resolved' }))
    expect(adapter.getSnapshot().tickets[0]?.status).toBe('resolved')
  })

  it('rejects customer follow-up messages after support resolves a ticket', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    nostrCsMock.MockCSClient.sendMessageImpl = sendMessage
    const { adapter, client } = await connectAdapter()

    client.emitTicket(makeTicket())
    client.emitStatus(makeStatusUpdate({ byPubkey: agentPubkey, newStatus: 'resolved' }))

    await expect(adapter.sendMessage({ ticketId: 'ticket-1', body: 'follow up' }))
      .rejects.toThrow('Support ticket is already resolved')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('only displays support messages from the configured agent or the local customer identity', async () => {
    const { adapter, client } = await connectAdapter()
    client.emitTicket(makeTicket())

    client.emitReply(makeReply({ byPubkey: attackerPubkey }))
    expect(adapter.getSnapshot().messages['ticket-1']).toBeUndefined()

    client.emitReply(makeReply({ byPubkey: agentPubkey, threadRoot: 'wrong-thread' }))
    expect(adapter.getSnapshot().messages['ticket-1']).toBeUndefined()

    client.emitReply(makeReply({
      byPubkey: agentPubkey,
      body: JSON.stringify({ v: 1, text: 'agent reply', attachments: [] }),
    }))
    expect(adapter.getSnapshot().messages['ticket-1']).toMatchObject([
      { sender: 'support', channel: 'thread', body: 'agent reply' },
    ])

    client.emitMessage(makeMessage({ senderPubkey: attackerPubkey }))
    expect(adapter.getSnapshot().messages['ticket-1']).toHaveLength(1)

    client.emitMessage(makeMessage({
      senderPubkey: customerPubkey,
      body: JSON.stringify({ v: 1, text: 'local history', attachments: [] }),
    }))
    expect(adapter.getSnapshot().messages['ticket-1']).toMatchObject([
      { sender: 'support', channel: 'thread', body: 'agent reply' },
      { sender: 'customer', channel: 'private', body: 'local history' },
    ])

    client.emitMessage(makeMessage({ senderPubkey: agentPubkey, channel: 'reply' }))
    expect(adapter.getSnapshot().messages['ticket-1']).toHaveLength(2)
  })

  it('preserves attachment metadata from decoded message envelopes', async () => {
    const { adapter, client } = await connectAdapter()
    client.emitTicket(makeTicket())

    client.emitReply(makeReply({
      byPubkey: agentPubkey,
      body: JSON.stringify({
        v: 1,
        text: 'see file',
        attachments: [{
          type: 'encrypted_blob',
          mime: 'image/png',
          name: 'screenshot.png',
          size: 1234,
          sha256: 'file-sha',
          cipher: 'aes-256-gcm',
          key: 'key',
          iv: 'iv',
          blossom: { blob_sha256: 'blob-sha', servers: ['https://blossom.test'] },
        }],
      }),
    }))

    expect(adapter.getSnapshot().messages['ticket-1']).toMatchObject([
      {
        body: 'see file',
        attachments: [{
          id: 'blob-sha',
          name: 'screenshot.png',
          mime: 'image/png',
          size: 1234,
          state: 'available',
        }],
      },
    ])
  })

  it('uploads encrypted attachments and downloads verified attachment content', async () => {
    let createdTicketParams: { body: string } | undefined
    nostrCsMock.MockCSClient.createTicketImpl = async (params: unknown) => {
      createdTicketParams = params as { body: string }
      return makeTicket({ body: createdTicketParams.body })
    }
    const attachmentStore = makeAttachmentStore()
    const { adapter, client } = await connectAdapter(undefined, withAttachmentConfig(), attachmentStore)

    await adapter.createTicket({
      title: 'Need help',
      body: 'see attached',
      priority: 'normal',
      category: 'general',
      attachments: [{
        name: 'receipt.txt',
        mime: 'text/plain',
        size: 3,
        data: new Uint8Array([1, 2, 3]),
      }],
    })

    expect(attachmentStore.upload).toHaveBeenCalledWith({
      ciphertext: new Uint8Array([9, 8, 7]),
      ciphertextSha256: 'mock-cipher-sha',
      contentType: 'application/octet-stream',
    })
    expect(createdTicketParams?.body).toContain('mock-cipher-sha')
    expect(adapter.getSnapshot().messages['ticket-1']).toMatchObject([
      {
        body: 'see attached',
        attachments: [{
          id: 'mock-cipher-sha',
          name: 'receipt.txt',
          mime: 'text/plain',
          size: 3,
          state: 'available',
        }],
      },
    ])

    client.emitReply(makeReply({
      byPubkey: agentPubkey,
      body: JSON.stringify({
        v: 1,
        text: 'download this',
        attachments: [{
          type: 'encrypted_blob',
          mime: 'image/png',
          name: 'screen.png',
          size: 3,
          sha256: 'plain-sha',
          cipher: 'aes-256-gcm',
          key: 'key',
          iv: 'iv',
          blossom: { blob_sha256: 'blob-sha', servers: ['https://remote.blossom'] },
        }],
      }),
    }))

    await expect(adapter.downloadAttachment({ attachmentId: 'blob-sha' })).resolves.toEqual({
      name: 'screen.png',
      mime: 'image/png',
      data: new Uint8Array([1, 2, 3]),
    })
    expect(attachmentStore.download).toHaveBeenCalledWith({
      blobSha256: 'blob-sha',
      servers: ['https://remote.blossom'],
    })
  })

  it('restores cached support history on connect and persists relay updates', async () => {
    const historyStore: CustomerSupportHistoryStore = {
      load: vi.fn().mockResolvedValue({
        tickets: [{
          id: 'cached-ticket',
          threadId: 'cached-thread',
          title: 'Cached request',
          body: 'Cached body',
          status: 'open',
          priority: 'normal',
          category: 'general',
          createdAt: 10,
          updatedAt: 10,
        }],
        messages: {
          'cached-ticket': [{
            id: 'cached-message',
            ticketId: 'cached-ticket',
            threadId: 'cached-thread',
            body: 'Cached message',
            sender: 'customer',
            channel: 'thread',
            createdAt: 10,
          }],
        },
      }),
      saveTicket: vi.fn().mockResolvedValue(undefined),
      saveMessage: vi.fn().mockResolvedValue(undefined),
      markTicketRead: vi.fn().mockResolvedValue(undefined),
    }

    const { adapter, client } = await connectAdapter(historyStore)

    expect(historyStore.load).toHaveBeenCalledWith({ customerId: customerPubkey, agentPubkey })
    expect(adapter.getSnapshot().tickets).toMatchObject([{ id: 'cached-ticket' }])

    client.emitTicket(makeTicket())
    client.emitReply(makeReply({ byPubkey: agentPubkey }))

    expect(historyStore.saveTicket).toHaveBeenCalledWith(
      { customerId: customerPubkey, agentPubkey },
      expect.objectContaining({ id: 'ticket-1' }),
    )
    expect(historyStore.saveMessage).toHaveBeenCalledWith(
      { customerId: customerPubkey, agentPubkey },
      expect.objectContaining({ ticketId: 'ticket-1', body: 'agent reply' }),
    )

    await adapter.markTicketRead('ticket-1', 5000)
    expect(adapter.getSnapshot().tickets.find((ticket) => ticket.id === 'ticket-1')?.readAt).toBe(5000)
    expect(historyStore.markTicketRead).toHaveBeenCalledWith(
      { customerId: customerPubkey, agentPubkey },
      'ticket-1',
      5000,
    )
  })

  it('restores cached support history before network connection completes', async () => {
    let resolveConnect: (() => void) | undefined
    nostrCsMock.MockCSClient.connectImpl = () => new Promise<void>((resolve) => {
      resolveConnect = resolve
    })
    const historyStore: CustomerSupportHistoryStore = {
      load: vi.fn().mockResolvedValue({
        tickets: [{
          id: 'cached-ticket',
          threadId: 'cached-thread',
          title: 'Cached request',
          body: 'Cached body',
          status: 'open',
          priority: 'normal',
          category: 'general',
          createdAt: 10,
          updatedAt: 10,
        }],
        messages: {},
      }),
      saveTicket: vi.fn().mockResolvedValue(undefined),
      saveMessage: vi.fn().mockResolvedValue(undefined),
      markTicketRead: vi.fn().mockResolvedValue(undefined),
    }
    const keyProvider = {
      getPubkey: vi.fn().mockResolvedValue(customerPubkey),
      destroy: vi.fn(),
    } as unknown as DerivedCustomerSupportKeyProvider
    const adapter = new NostrCsCustomerSupportAdapter(config, keyProvider, historyStore)

    const connectPromise = adapter.connect()
    await vi.waitFor(() => {
      expect(historyStore.load).toHaveBeenCalledWith({ customerId: customerPubkey, agentPubkey })
      expect(adapter.getSnapshot().tickets).toMatchObject([{ id: 'cached-ticket' }])
      expect(resolveConnect).toBeTypeOf('function')
    })

    resolveConnect!()
    await connectPromise
  })

  it('does not attach listeners to a stale client when disconnect wins the connect race', async () => {
    let resolveConnect: (() => void) | undefined
    nostrCsMock.MockCSClient.connectImpl = () => new Promise<void>((resolve) => {
      resolveConnect = resolve
    })

    const keyProvider = {
      getPubkey: vi.fn().mockResolvedValue(customerPubkey),
      destroy: vi.fn(),
    } as unknown as DerivedCustomerSupportKeyProvider
    const adapter = new NostrCsCustomerSupportAdapter(config, keyProvider)

    const connectPromise = adapter.connect()
    await vi.waitFor(() => {
      expect(resolveConnect).toBeTypeOf('function')
    })
    const client = nostrCsMock.MockCSClient.instances[0]!

    await adapter.disconnect()
    resolveConnect!()

    const snapshot = await connectPromise

    expect(snapshot.status).toBe('idle')
    expect(snapshot.error).toBeUndefined()
    expect(client.getHandlerCount()).toBe(0)
  })

  it('refreshes support history through the connected client', async () => {
    const { adapter } = await connectAdapter()
    expect(nostrCsMock.MockCSClient.pullOwnHistoryCalls).toBe(1)

    await adapter.refresh()

    expect(nostrCsMock.MockCSClient.pullOwnHistoryCalls).toBe(2)
  })
})

async function connectAdapter(
  historyStore?: CustomerSupportHistoryStore,
  supportConfig: CustomerSupportConfig = config,
  attachmentStore?: SupportAttachmentBlobStore,
): Promise<{
  adapter: NostrCsCustomerSupportAdapter
  client: InstanceType<typeof nostrCsMock.MockCSClient>
}> {
  const keyProvider = {
    getPubkey: vi.fn().mockResolvedValue(customerPubkey),
    destroy: vi.fn(),
  } as unknown as DerivedCustomerSupportKeyProvider

  const adapter = new NostrCsCustomerSupportAdapter(supportConfig, keyProvider, historyStore, attachmentStore)
  await adapter.connect()

  return {
    adapter,
    client: nostrCsMock.MockCSClient.instances[0]!,
  }
}

function withAttachmentConfig(): CustomerSupportConfig {
  return {
    ...config,
    attachments: {
      servers: ['https://blossom.test'],
      maxCount: 3,
      maxSizeBytes: 10_000,
    },
  }
}

function makeAttachmentStore(): SupportAttachmentBlobStore {
  return {
    upload: vi.fn().mockResolvedValue({
      servers: ['https://blossom.test'],
      uploaderSecretKey: new Uint8Array(32),
    }),
    download: vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7])),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function makeTicket(overrides: Partial<NostrCsTicket> = {}): NostrCsTicket {
  return {
    id: ticketId('ticket-1'),
    eventId: 'thread-1',
    customerPubkey,
    agentPubkey,
    status: 'open',
    priority: 'normal',
    category: 'general',
    title: 'Need help',
    body: 'Help body',
    createdAt: 1,
    ...overrides,
  } as NostrCsTicket
}

function makeReply(overrides: Partial<TicketReply> = {}): TicketReply {
  return {
    ticketId: ticketId('ticket-1'),
    threadRoot: 'thread-1',
    byPubkey: agentPubkey,
    body: 'agent reply',
    at: 2,
    ...overrides,
  } as TicketReply
}

function makeMessage(overrides: Partial<NostrCsMessage> = {}): NostrCsMessage {
  return {
    ticketId: ticketId('ticket-1'),
    threadRoot: 'thread-1',
    senderPubkey: agentPubkey,
    body: 'agent dm',
    createdAt: 3,
    channel: 'dm',
    ...overrides,
  } as NostrCsMessage
}

function makeStatusUpdate(overrides: Partial<StatusUpdate> = {}): StatusUpdate {
  return {
    ticketId: ticketId('ticket-1'),
    threadRoot: 'thread-1',
    newStatus: 'in_progress',
    byPubkey: agentPubkey,
    at: 4,
    ...overrides,
  } as StatusUpdate
}

function ticketId(value: string): NostrCsTicket['id'] {
  return new nostrCsMock.MockTicketId(value) as unknown as NostrCsTicket['id']
}
