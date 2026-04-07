/**
 * Sync state
 */
export type SyncState = 'idle' | 'syncing' | 'completed' | 'error'

/**
 * Anchor for recovery
 * Stored in local DB and optionally published to relays
 */
export interface SyncAnchor {
  timestamp: number
  eventId?: string
  lastProcessedEventId?: string
  updatedAt: number
}

/**
 * Sync result
 */
export interface SyncResult {
  eventsProcessed: number
  tokensReceived: number
  amountReceived: number
  failedIncomings: number
  errors: string[]
  duration: number
}

/**
 * Offline queue item
 */
export interface OfflineQueueItem {
  id: string
  type: 'retry_swap' | 'publish_event' | 'refresh_balance'
  data: Record<string, unknown>
  createdAt: number
  priority: number
}

/**
 * Processed event record (for deduplication)
 */
export interface ProcessedEvent {
  eventId: string
  txId?: string
  processedAt: number
  result: 'success' | 'failed' | 'skipped'
  error?: string
}

/**
 * State reconstruction options
 */
export interface ReconstructionOptions {
  /** Timestamp to start recovery from (defaults to anchor - 2 days) */
  since?: number
  /** Maximum number of events to process */
  limit?: number
  /** Whether to retry failed swaps */
  retryFailedIncomings?: boolean
}
