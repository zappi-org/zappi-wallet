import type { AnchorData } from '@/core/ports/driven/anchor.port'
import type { SyncResult, FailedIncoming } from '@/core/types'

export interface AnchorCheckResult {
  anchor: AnchorData | null
  isRecoveryMode: boolean
  oldestAnchor?: AnchorData
}

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

export interface RecoveryUseCase {
  /** Full recovery: anchor check → reconstruct → retry → update anchor */
  syncAll(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<SyncResult>

  /** Reconstruct state only (recover missed tokens) */
  reconstructState(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<SyncResult>

  /** Retry failed incomings only */
  retryFailedIncomings(): Promise<RetryResult>

  /** Query failed incomings */
  getFailedIncomings(): Promise<FailedIncoming[]>

  /** Query recovery status */
  getSyncStatus(): Promise<RecoveryStatus>

  /** Cleanup old non-retryable data */
  cleanupOldData(): Promise<void>
}
