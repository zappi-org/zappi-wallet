export interface ExternalMnemonicRecoveryProgress {
  mintUrl: string
  index: number
  total: number
}

export interface RecoveredEcashToken {
  mintUrl: string
  token: string
  amount: number
  proofCount: number
}

export interface ExternalMnemonicRecoveryResult {
  tokens: RecoveredEcashToken[]
  scannedMints: number
  failedMints: { mintUrl: string; error: string }[]
}

export interface ExternalMnemonicRecoveryPort {
  recoverTokens(params: {
    mnemonic: string
    mintUrls: string[]
    onProgress?: (progress: ExternalMnemonicRecoveryProgress) => void
  }): Promise<ExternalMnemonicRecoveryResult>
}
