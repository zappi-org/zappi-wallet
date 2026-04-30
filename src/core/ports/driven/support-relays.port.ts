export interface SupportRelaysProvider {
  getRelays(): string[]
  subscribe(listener: (relays: string[]) => void): () => void
}
