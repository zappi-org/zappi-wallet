import type { SupportMessage, SupportTicket } from '@/core/domain/support'

export interface CustomerSupportHistoryScope {
  customerId: string
  agentPubkey: string
}

export interface CustomerSupportHistory {
  tickets: SupportTicket[]
  messages: Record<string, SupportMessage[]>
}

export interface CustomerSupportHistoryStore {
  load(scope: CustomerSupportHistoryScope): Promise<CustomerSupportHistory>
  saveTicket(scope: CustomerSupportHistoryScope, ticket: SupportTicket): Promise<void>
  saveMessage(scope: CustomerSupportHistoryScope, message: SupportMessage): Promise<void>
  markTicketRead(scope: CustomerSupportHistoryScope, ticketId: string, readAt: number): Promise<void>
}
