import type { ChatPaymentLink } from './chat-payment'

export const MAX_CHAT_MESSAGE_BYTES = 16_000

export interface ChatCapabilities {
  contacts: boolean
  payments: boolean
  deletion: boolean
  blocking: boolean
}

export function conversationId(
  scope: { account: string; channel: string; contextId?: string },
  peer: string
): string {
  return [
    scope.account,
    scope.channel,
    ...(scope.contextId === undefined ? [] : [scope.contextId]),
    peer,
  ]
    .map(encodeURIComponent)
    .join(':')
}

export function conversationCapabilities(
  conversation: Pick<Conversation, 'channel' | 'contextId' | 'capabilities'>
): ChatCapabilities {
  const direct =
    conversation.channel === 'direct' && conversation.contextId === undefined
  return {
    contacts: direct,
    payments: direct,
    deletion: direct,
    blocking: direct,
    ...conversation.capabilities,
  }
}

export interface Conversation {
  capabilities?: ChatCapabilities
  id: string
  account: string
  peer: string
  address?: string
  channel: string
  contextId?: string
  updatedAt: number
  unread: number
  pinned: boolean
  muted: boolean
  blocked: boolean
  deletedAt?: number
  clearedBefore?: number
  preview: string
  draft: string
}

export interface ChatMessage {
  expiresAt?: number
  payment?: ChatPaymentLink
  id: string
  conversationId: string
  sender: string
  recipient: string
  content: string
  createdAt: number
  outgoing: boolean
  status: 'sending' | 'sent' | 'failed' | 'received'
  receivedAt?: number
  nonce?: string
}

export interface ChatSnapshot {
  conversations: Conversation[]
  messages: ChatMessage[]
  ready: boolean
  error: boolean
  errorReason?: 'storage' | 'receive'
}

export function chatMessageKey(
  message: Pick<ChatMessage, 'id' | 'conversationId'>
): string {
  return `${message.conversationId}:${encodeURIComponent(message.id)}`
}

export function unreadChatCount(conversations: Conversation[]): number {
  return conversations.reduce(
    (n, c) => n + (c.deletedAt || c.blocked ? 0 : c.unread),
    0
  )
}

export function unreadBadge(count: number): string {
  return count > 99 ? '99+' : String(count)
}
