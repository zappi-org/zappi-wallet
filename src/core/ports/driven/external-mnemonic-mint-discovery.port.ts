export type ExternalMnemonicMintDiscoverySource = 'public-profile' | 'encrypted-backup'

export interface DiscoveredExternalMint {
  mintUrl: string
  source: ExternalMnemonicMintDiscoverySource
  createdAt?: number
}

export interface ExternalMnemonicMintDiscoveryResult {
  mintUrls: string[]
  discoveredMints: DiscoveredExternalMint[]
  failedSources: { source: ExternalMnemonicMintDiscoverySource; error: string }[]
}

export interface ExternalMnemonicMintDiscoveryPort {
  discoverMintUrls(params: {
    mnemonic: string
  }): Promise<ExternalMnemonicMintDiscoveryResult>
}
