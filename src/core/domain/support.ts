export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type SupportPriority = 'normal' | 'high'
export type SupportCategory = 'general' | 'technical' | 'billing'
export type SupportConnectionStatus = 'disabled' | 'idle' | 'connecting' | 'connected' | 'error'

export const DEFAULT_SUPPORT_PRIORITY: SupportPriority = 'normal'
export const DEFAULT_SUPPORT_CATEGORY: SupportCategory = 'general'

export interface SupportAvailability {
  available: boolean
  reason?: 'not_configured' | 'invalid_config'
}

export interface SupportTicket {
  id: string
  threadId: string
  title: string
  body: string
  status: SupportTicketStatus
  priority: SupportPriority
  category: SupportCategory
  createdAt: number
  updatedAt: number
  readAt?: number
  archivedAt?: number
  pinnedAt?: number
}

export interface SupportAttachment {
  id: string
  name?: string
  mime: string
  size: number
  state: 'available' | 'metadata_only'
}

export interface SupportAttachmentUpload {
  name?: string
  mime: string
  size: number
  data: Uint8Array
}

export interface SupportAttachmentDownload {
  name?: string
  mime: string
  data: Uint8Array
}

export interface SupportMessage {
  id: string
  ticketId: string
  threadId: string
  body: string
  sender: 'customer' | 'support'
  channel: 'thread' | 'private'
  createdAt: number
  attachments?: SupportAttachment[]
}

export interface SupportSnapshot {
  status: SupportConnectionStatus
  availability: SupportAvailability
  capabilities: SupportCapabilities
  customerId: string | null
  tickets: SupportTicket[]
  messages: Record<string, SupportMessage[]>
  error?: string
}

export interface SupportCapabilities {
  attachments: {
    available: boolean
    maxCount: number
    maxSizeBytes: number
  }
}

export interface CreateSupportTicketInput {
  title: string
  body: string
  priority?: SupportPriority
  category?: SupportCategory
  attachments?: SupportAttachmentUpload[]
}

export interface CreateSupportTicketCommand {
  title: string
  body: string
  priority: SupportPriority
  category: SupportCategory
  attachments?: SupportAttachmentUpload[]
}

export interface SendSupportMessageInput {
  ticketId: string
  body: string
  attachments?: SupportAttachmentUpload[]
}

export interface DownloadSupportAttachmentInput {
  attachmentId: string
}

export function isSupportTicketTerminal(status: SupportTicketStatus): boolean {
  return status === 'resolved' || status === 'closed'
}

export function countUnreadSupportReplies(ticket: SupportTicket, messages: SupportMessage[]): number {
  const readAt = ticket.readAt ?? 0
  return messages.reduce((count, message) => {
    if (message.sender !== 'support') return count
    return message.createdAt > readAt ? count + 1 : count
  }, 0)
}

export function getLatestSupportMessage(messages: SupportMessage[]): SupportMessage | null {
  return messages.reduce<SupportMessage | null>((latest, message) => {
    if (!latest || message.createdAt > latest.createdAt) return message
    return latest
  }, null)
}

export function getLatestSupportMessageAt(messages: SupportMessage[]): number {
  return messages.reduce((latest, message) => {
    if (message.sender !== 'support') return latest
    return Math.max(latest, message.createdAt)
  }, 0)
}

export type SupportListener = (snapshot: SupportSnapshot) => void
