import type {
  CreateSupportTicketInput,
  DownloadSupportAttachmentInput,
  SendSupportMessageInput,
  SupportAttachmentDownload,
  SupportAvailability,
  SupportListener,
  SupportSnapshot,
  SupportTicket,
} from '@/core/domain/support'

export interface SupportUseCase {
  getAvailability(): SupportAvailability
  getSnapshot(): SupportSnapshot
  connect(): Promise<SupportSnapshot>
  disconnect(): Promise<void>
  destroy(): Promise<void>
  refresh(): Promise<SupportSnapshot>
  createTicket(input: CreateSupportTicketInput): Promise<SupportTicket>
  sendMessage(input: SendSupportMessageInput): Promise<void>
  downloadAttachment(input: DownloadSupportAttachmentInput): Promise<SupportAttachmentDownload>
  markTicketRead(ticketId: string, readAt?: number): Promise<void>
  subscribe(listener: SupportListener): () => void
}
