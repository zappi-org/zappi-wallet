import type {
  ChatMessage,
  ChatSnapshot,
  Conversation,
} from '@/core/domain/chat'

export interface ChatRepository {
  load(): Promise<Pick<ChatSnapshot, 'conversations' | 'messages'>>
  getConversation(id: string): Promise<Conversation | undefined>
  receive(message: ChatMessage, conversation: Conversation): Promise<boolean>
  /** Updates only an existing message; false means it no longer exists. */
  saveMessage(message: ChatMessage): Promise<boolean>
  saveConversation(conversation: Conversation): Promise<void>
  updateConversation(id: string, patch: Partial<Conversation>): Promise<void>
  deleteConversation(id: string, at: number): Promise<void>
  watch(handler: () => void, onError: (error: unknown) => void): () => void
}
