import type { SupportTicketStatus } from '@/core/domain/support'

export type CSStatusKind = 'received' | 'progress' | 'answered'

export function ticketStatusToCSKind(status: SupportTicketStatus): CSStatusKind {
  if (status === 'open') return 'received'
  if (status === 'in_progress') return 'progress'
  return 'answered'
}
