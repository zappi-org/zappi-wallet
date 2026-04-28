import { beforeEach, describe, expect, it } from 'vitest'
import { DexieCustomerSupportHistoryStore } from '@/adapters/storage/dexie/dexie-customer-support-history.store'
import { resetDatabase } from '@/adapters/storage/dexie/schema'

describe('DexieCustomerSupportHistoryStore', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('persists and loads support history scoped to the customer and support agent', async () => {
    const store = new DexieCustomerSupportHistoryStore()
    const scope = { customerId: 'customer-a', agentPubkey: 'agent-a' }

    await store.saveTicket(scope, {
      id: 'ticket-1',
      threadId: 'thread-1',
      title: 'Need help',
      body: 'Help body',
      status: 'open',
      priority: 'high',
      category: 'technical',
      createdAt: 1,
      updatedAt: 3,
      readAt: 2,
    })
    await store.saveMessage(scope, {
      id: 'message-1',
      ticketId: 'ticket-1',
      threadId: 'thread-1',
      body: 'Reply body',
      sender: 'support',
      channel: 'thread',
      createdAt: 2,
      attachments: [{
        id: 'file-sha',
        name: 'screenshot.png',
        mime: 'image/png',
        size: 1234,
        state: 'metadata_only',
      }],
    })
    await store.saveTicket({ customerId: 'customer-b', agentPubkey: 'agent-a' }, {
      id: 'ticket-other',
      threadId: 'thread-other',
      title: 'Other',
      body: 'Other body',
      status: 'open',
      priority: 'normal',
      category: 'general',
      createdAt: 1,
      updatedAt: 1,
    })

    const history = await store.load(scope)

    expect(history.tickets).toMatchObject([{ id: 'ticket-1', category: 'technical', readAt: 2 }])
    expect(history.messages['ticket-1']).toMatchObject([{
      id: 'message-1',
      body: 'Reply body',
      attachments: [{ id: 'file-sha', name: 'screenshot.png' }],
    }])
    expect(history.tickets.some((ticket) => ticket.id === 'ticket-other')).toBe(false)

    await store.markTicketRead(scope, 'ticket-1', 5)
    await expect(store.load(scope)).resolves.toMatchObject({
      tickets: [{ id: 'ticket-1', readAt: 5 }],
    })
  })
})
