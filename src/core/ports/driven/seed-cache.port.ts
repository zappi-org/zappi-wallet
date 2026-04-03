export interface SeedCache {
  cacheMnemonic(mnemonic: string): void
  clearCache(): void
}
