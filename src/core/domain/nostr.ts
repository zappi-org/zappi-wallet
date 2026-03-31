export interface NostrEvent {
    id: string,
    pubkey: string
    created_at: number,
    kind:number,
    tags: string[][],
    content:string,
    sig:string
}

export interface UnsignedNostrEvent {
    pubkey: string,
    created_at: number,
    kind:number,
    tags: string[][],
    content:string,
}

export interface Relay{
    url: string
}

export interface NostrFilter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  [key: `#${string}`]: string[] | undefined //hashtags
}

