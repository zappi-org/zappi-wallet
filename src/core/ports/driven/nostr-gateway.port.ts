// Nostr 도메인 타입 — nostr-tools에 의존하지 않는 순수 정의

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export interface UnsignedNostrEvent {
  kind: number
  tags: string[][]
  content: string
  created_at?: number
}

export interface NostrFilter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  [key: `#${string}`]: string[] | undefined
}

export interface DirectMessage {
  id: string
  senderPubkey: string
  content: string
  createdAt: number
  relayUrl?: string
}

export interface RelayStatus {
  url: string
  connected: boolean
}

export interface NostrGateway {
  // 연결
  connect(relays: string[]): Promise<void>
  disconnect(): Promise<void>
  getRelayStatus(): RelayStatus[]

  // 발행
  publish(event: UnsignedNostrEvent): Promise<NostrEvent>

  // 구독 (unsubscribe 반환)
  subscribe(
    filters: NostrFilter[],
    handler: (event: NostrEvent) => void,
  ): () => void

  // 일회성 조회
  queryEvents(filters: NostrFilter[]): Promise<NostrEvent[]>

  // DM (NIP-17 Gift Wrap 캡슐화)
  sendDirectMessage(recipientPubkey: string, content: string): Promise<void>
  onDirectMessage(handler: (dm: DirectMessage) => void): () => void
}
