export interface SeedCache {
  cacheMnemonic(mnemonic: string): void
  getCachedMnemonic(): string | null
  isCached(): boolean
  clearCache(): void
}
