export interface NostrSigner {
  createNip98Token(url: string, method: string): string
  getPublicKey(): string
  getNpub(): string
}
