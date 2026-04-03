import type { SyncAnchor, SyncResult, FailedSwap } from '@/core/types'

export interface RetryResult {
  succeeded: number
  failed: number
  errors: string[]
}

export interface RecoveryStatus {
  hasAnchor: boolean
  lastSyncAt?: number
  pendingRetries: number
  isSyncing: boolean
}

export interface RecoverTokenUseCase {
  reconstructState(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<SyncResult>

  retryFailedSwaps(): Promise<RetryResult>

  getFailedSwaps(): Promise<FailedSwap[]>

  getSyncStatus(): Promise<RecoveryStatus>

  getAnchor(): Promise<SyncAnchor | null>

  updateAnchor(timestamp: number): Promise<void>

  cleanupOldData(): Promise<void>
}
