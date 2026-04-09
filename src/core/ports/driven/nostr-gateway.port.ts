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

  /** Send NIP-17 gift wrap and return the wrapped event */
  sendGiftWrap(params: GiftWrapParams): Promise<NostrEvent>

  /** Query and unwrap NIP-17 gift wrap events */
  fetchGiftWraps(params: FetchGiftWrapsParams): Promise<UnwrappedMessage[]>

  /** Subscribe to gift wraps and deliver unwrapped messages to handler */
  subscribeGiftWraps(
    params: SubscribeGiftWrapsParams,
    handler: (msg: UnwrappedMessage) => void,
  ): () => void
}

export interface DirectMessageParams {
  recipientPubkey: string
  content: string
  relays: string[]
}

export interface GiftWrapParams {
  recipientPubkey: string
  content: string
  relays: string[]
}

export interface FetchGiftWrapsParams {
  recipientPubkey: string
  relays: string[]
}

export interface SubscribeGiftWrapsParams {
  recipientPubkey: string
  since?: number
}

export interface UnwrappedMessage {
  eventId: string
  content: string
  sender: string
}
