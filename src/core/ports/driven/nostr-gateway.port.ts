import type { NostrEvent, NostrFilter, UnsignedNostrEvent } from '@/core/domain/nostr'

export interface RelayStatus {
  url: string
  connected: boolean
}

export interface NostrGateway {
  connect(relays: string[]): Promise<void>
  disconnect(): Promise<void>
  getRelayStatus(): RelayStatus[]

  publish(event: UnsignedNostrEvent): Promise<NostrEvent>
  queryEvents(filters: NostrFilter[]): Promise<NostrEvent[]>

  subscribe(
    filters: NostrFilter[],
    handler: (event: NostrEvent) => void,
  ): () => void

  sendPrivateDirectMessage(params: DirectMessageParams): Promise<void>
}

export interface DirectMessageParams {
  recipientPubkey: string
  content: string
  relays: string[]
}
