import type { AnchorData } from '@/core/ports/driven/anchor.port'

export interface AnchorCheckResult {
  anchor: AnchorData | null
  isRecoveryMode: boolean
  oldestAnchor?: AnchorData
}

export interface AnchorUseCase {
  check(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<AnchorCheckResult>
}
