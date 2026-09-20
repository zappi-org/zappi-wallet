import type { ChatPaymentLink } from '@/core/domain/chat-payment'
import type {
  ChatMessage,
  ChatSnapshot,
  Conversation,
} from '@/core/domain/chat'

export interface ChatUseCase {
  getSnapshot(): ChatSnapshot
  subscribe(handler: () => void): () => void
  onMessage(handler: (message: ChatMessage) => void): () => void
  connect(): Promise<void>
  disconnect(): void
  open(
    peer: string,
    context?: { channel: string; contextId?: string }
  ): Promise<string>
  enqueue(id: string, content: string, payment?: ChatPaymentLink): Promise<void>
  retry(id: string, conversationId?: string): Promise<void>
  markRead(id: string): Promise<void>
  update(
    id: string,
    patch: Partial<Pick<Conversation, 'pinned' | 'muted' | 'blocked' | 'draft'>>
  ): Promise<void>
  delete(id: string): Promise<void>
}
