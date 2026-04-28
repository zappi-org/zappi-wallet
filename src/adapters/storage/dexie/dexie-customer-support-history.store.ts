import type {
  CustomerSupportHistory,
  CustomerSupportHistoryScope,
  CustomerSupportHistoryStore,
} from '@/core/ports/driven/customer-support-history-store.port'
import type { SupportMessage, SupportTicket } from '@/core/domain/support'
import type { SupportMessageRecord, SupportTicketRecord } from './schema'
import { getDatabase } from './schema'

export class DexieCustomerSupportHistoryStore implements CustomerSupportHistoryStore {
  private get db() {
    return getDatabase()
  }

  async load(scope: CustomerSupportHistoryScope): Promise<CustomerSupportHistory> {
    const [ticketRecords, messageRecords] = await Promise.all([
      this.db.supportTickets
        .where('customerId')
        .equals(scope.customerId)
        .and((record) => record.agentPubkey === scope.agentPubkey)
        .toArray(),
      this.db.supportMessages
        .where('customerId')
        .equals(scope.customerId)
        .and((record) => record.agentPubkey === scope.agentPubkey)
        .toArray(),
    ])

    const messages: Record<string, SupportMessage[]> = {}
    for (const record of messageRecords) {
      const message = toMessage(record)
      messages[message.ticketId] = [...(messages[message.ticketId] ?? []), message]
    }

    return {
      tickets: ticketRecords.map(toTicket).sort((a, b) => b.updatedAt - a.updatedAt),
      messages: Object.fromEntries(
        Object.entries(messages).map(([ticketId, list]) => [
          ticketId,
          list.sort((a, b) => a.createdAt - b.createdAt),
        ]),
      ),
    }
  }

  async saveTicket(scope: CustomerSupportHistoryScope, ticket: SupportTicket): Promise<void> {
    await this.db.supportTickets.put({
      ...ticket,
      customerId: scope.customerId,
      agentPubkey: scope.agentPubkey,
    })
  }

  async saveMessage(scope: CustomerSupportHistoryScope, message: SupportMessage): Promise<void> {
    await this.db.supportMessages.put({
      ...message,
      customerId: scope.customerId,
      agentPubkey: scope.agentPubkey,
    })
  }

  async markTicketRead(
    scope: CustomerSupportHistoryScope,
    ticketId: string,
    readAt: number,
  ): Promise<void> {
    const existing = await this.db.supportTickets.get(ticketId)
    if (
      !existing ||
      existing.customerId !== scope.customerId ||
      existing.agentPubkey !== scope.agentPubkey
    ) {
      return
    }

    await this.db.supportTickets.update(ticketId, { readAt })
  }
}

function toTicket(record: SupportTicketRecord): SupportTicket {
  return {
    id: record.id,
    threadId: record.threadId,
    title: record.title,
    body: record.body,
    status: record.status,
    priority: record.priority,
    category: record.category,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.readAt ? { readAt: record.readAt } : {}),
  }
}

function toMessage(record: SupportMessageRecord): SupportMessage {
  return {
    id: record.id,
    ticketId: record.ticketId,
    threadId: record.threadId,
    body: record.body,
    sender: record.sender,
    channel: record.channel,
    createdAt: record.createdAt,
    ...(record.attachments ? { attachments: record.attachments } : {}),
  }
}
