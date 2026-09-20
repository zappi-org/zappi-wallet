import type { ChatMessage, ChatCapabilities } from "@/core/domain/chat";

export interface ChatTransport {
  readonly capabilities?: ChatCapabilities;
  readonly account: string;
  readonly identity?: string;
  readonly channel: string;
  readonly contextId?: string;
  resolvePeer(address: string): string;
  prepare(peer: string, content: string, options?: { expiresAt: number }): ChatMessage;
  send(message: ChatMessage): Promise<void>;
  subscribe(
    handler: (message: ChatMessage) => Promise<void>,
    onError: (error: unknown) => void
  ): () => void;
}
