import type { CustomerSupportChannel } from '@/core/ports/driven/customer-support.port'
import type {
  CreateSupportTicketCommand,
  DownloadSupportAttachmentInput,
  SendSupportMessageInput,
  SupportAttachmentDownload,
  SupportAvailability,
  SupportListener,
  SupportSnapshot,
  SupportTicket,
} from '@/core/domain/support'

export class DisabledCustomerSupportChannel implements CustomerSupportChannel {
  private readonly snapshot: SupportSnapshot

  constructor(reason: SupportAvailability['reason'] = 'not_configured') {
    this.snapshot = {
      status: 'disabled',
      availability: { available: false, reason },
      capabilities: {
        attachments: {
          available: false,
          maxCount: 0,
          maxSizeBytes: 0,
        },
      },
      customerId: null,
      tickets: [],
      messages: {},
      statusEvents: {},
    }
  }

  getAvailability(): SupportAvailability {
    return this.snapshot.availability
  }

  getSnapshot(): SupportSnapshot {
    return this.snapshot
  }

  async connect(): Promise<SupportSnapshot> {
    return this.snapshot
  }

  async disconnect(): Promise<void> {}

  async destroy(): Promise<void> {}

  async refresh(): Promise<SupportSnapshot> {
    return this.snapshot
  }

  async createTicket(_input: CreateSupportTicketCommand): Promise<SupportTicket> {
    throw new Error('Customer support is not configured')
  }

  async sendMessage(_input: SendSupportMessageInput): Promise<void> {
    throw new Error('Customer support is not configured')
  }

  async downloadAttachment(_input: DownloadSupportAttachmentInput): Promise<SupportAttachmentDownload> {
    throw new Error('Customer support is not configured')
  }

  async markTicketRead(_ticketId: string, _readAt?: number): Promise<void> {}

  async setTicketPinned(_ticketId: string, _pinnedAt: number | null): Promise<void> {}

  async archiveTicket(_ticketId: string, _archivedAt?: number): Promise<void> {}

  subscribe(listener: SupportListener): () => void {
    listener(this.snapshot)
    return () => {}
  }
}
