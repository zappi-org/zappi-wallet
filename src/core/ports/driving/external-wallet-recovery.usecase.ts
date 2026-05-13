import type { ExternalMnemonicRecoveryProgress } from '@/core/ports/driven/external-mnemonic-recovery.port'

export interface ExternalWalletRecoveryReport {
  recovered: number
  failed: number
  scannedMints: number
  recoveredMintUrls: string[]
  discoveredMintUrls: string[]
  trustedMintUrls: string[]
  failedMints: { mintUrl: string; error: string }[]
}

export interface ExternalWalletRecoveryUseCase {
  recoverFromMnemonic(params: {
    mnemonic: string
    currentMintUrls: string[]
    onProgress?: (progress: ExternalMnemonicRecoveryProgress) => void
  }): Promise<ExternalWalletRecoveryReport>
}
