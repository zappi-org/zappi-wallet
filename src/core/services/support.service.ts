import type { CustomerSupportChannel } from '@/core/ports/driven/customer-support.port'
import type { SupportUseCase } from '@/core/ports/driving/support.usecase'
import {
  DEFAULT_SUPPORT_CATEGORY,
  DEFAULT_SUPPORT_PRIORITY,
  type CreateSupportTicketInput,
  type DownloadSupportAttachmentInput,
  type SendSupportMessageInput,
  type SupportAttachmentDownload,
  type SupportAvailability,
  type SupportListener,
  type SupportSnapshot,
  type SupportTicket,
  isSupportTicketTerminal,
} from '@/core/domain/support'

export class SupportService implements SupportUseCase {
  constructor(private readonly channel: CustomerSupportChannel) {}

  getAvailability(): SupportAvailability {
    return this.channel.getAvailability()
  }

  getSnapshot(): SupportSnapshot {
    return this.channel.getSnapshot()
  }

  connect(): Promise<SupportSnapshot> {
    return this.channel.connect()
  }

  disconnect(): Promise<void> {
    return this.channel.disconnect()
  }

  destroy(): Promise<void> {
    return this.channel.destroy()
  }

  refresh(): Promise<SupportSnapshot> {
    return this.channel.refresh()
  }

  createTicket(input: CreateSupportTicketInput): Promise<SupportTicket> {
    return this.channel.createTicket({
      ...input,
      category: input.category ?? DEFAULT_SUPPORT_CATEGORY,
      priority: input.priority ?? DEFAULT_SUPPORT_PRIORITY,
    })
  }

  async sendMessage(input: SendSupportMessageInput): Promise<void> {
    const ticket = this.channel.getSnapshot().tickets.find((item) => item.id === input.ticketId)
    if (ticket && isSupportTicketTerminal(ticket.status)) {
      throw new Error('Support ticket is already resolved')
    }
    await this.channel.sendMessage(input)
  }

  downloadAttachment(input: DownloadSupportAttachmentInput): Promise<SupportAttachmentDownload> {
    return this.channel.downloadAttachment(input)
  }

  markTicketRead(ticketId: string, readAt?: number): Promise<void> {
    return this.channel.markTicketRead(ticketId, readAt)
  }

  setTicketPinned(ticketId: string, pinnedAt: number | null): Promise<void> {
    return this.channel.setTicketPinned(ticketId, pinnedAt)
  }

  archiveTicket(ticketId: string, archivedAt?: number): Promise<void> {
    return this.channel.archiveTicket(ticketId, archivedAt)
  }

  subscribe(listener: SupportListener): () => void {
    return this.channel.subscribe(listener)
  }
}
