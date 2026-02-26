import Dexie, { type Table } from 'dexie'
import type { Transaction, FailedSwap, WalletSettings, MintMetadata } from '@/core/types'
import type { ProcessedEvent, SyncAnchor } from '@/core/types'
import { DATABASE } from '@/core/constants'

/**
 * Transaction record for DB storage (id is the primary key)
 */
export type TransactionRecord = Transaction

/**
 * Failed swap record for DB storage (id is the primary key)
 */
export type FailedSwapRecord = FailedSwap

/**
 * Processed event record for DB storage (eventId is the primary key)
 */
export type ProcessedEventRecord = ProcessedEvent

/**
 * Sync anchor record for DB storage
 */
export interface SyncAnchorRecord extends SyncAnchor {
  id: string // single record with id 'current'
}

/**
 * Settings record for DB storage
 */
export interface SettingsRecord extends WalletSettings {
  id: string // single record with id 'current'
}

/**
 * Encrypted wallet data for DB storage
 */
export interface EncryptedWalletRecord {
  id: string // single record with id 'current'
  encryptedMnemonic: string
  salt: string
  iv: string
}

/**
 * Lock state for DB storage
 */
export interface LockStateRecord {
  id: string // single record with id 'current'
  isLocked: boolean
  failedAttempts: number
  lockedUntil?: number
}

/**
 * Proof record for DB storage
 */
export interface ProofRecord {
  id: string // unique id: mintUrl + secret
  mintUrl: string
  amount: number
  secret: string
  C: string
  keysetId: string
  addedAt: number
}

/**
 * Pending quote record for DB storage
 * Stores Lightning quotes that haven't been claimed yet
 */
export interface PendingQuoteRecord {
  quoteId: string // primary key
  mintUrl: string
  amount: number
  invoice: string
  createdAt: number
  expiresAt?: number // quote expiration time
}

/**
 * Pending melt record for Lightning send recovery
 * Stores melt quote info before payment to recover from crashes
 */
export interface PendingMeltRecord {
  meltQuoteId: string // primary key
  mintUrl: string
  amount: number       // invoice amount
  fee: number          // fee_reserve
  destination: string  // Lightning address or invoice
  createdAt: number
}

/**
 * Pending send token record for Ecash send recovery
 * Phase 1: intent saved BEFORE cocoSendToken (token is undefined)
 * Phase 2: token saved AFTER cocoSendToken returns (token is set)
 */
export interface PendingSendTokenRecord {
  id: string       // primary key (matches transaction ID)
  token?: string   // the cashu token string (undefined if crash before token creation)
  mintUrl: string
  amount: number
  createdAt: number
}

/**
 * Mint metadata record for offline caching (NUT-06, url is the primary key)
 */
export type MintMetadataRecord = MintMetadata

/**
 * Zappi Database
 */
export class ZappiDatabase extends Dexie {
  transactions!: Table<TransactionRecord, string>
  failedSwaps!: Table<FailedSwapRecord, string>
  processedEvents!: Table<ProcessedEventRecord, string>
  syncAnchor!: Table<SyncAnchorRecord, string>
  settings!: Table<SettingsRecord, string>
  encryptedWallet!: Table<EncryptedWalletRecord, string>
  lockState!: Table<LockStateRecord, string>
  proofs!: Table<ProofRecord, string>
  pendingQuotes!: Table<PendingQuoteRecord, string>
  pendingMelts!: Table<PendingMeltRecord, string>
  pendingSendTokens!: Table<PendingSendTokenRecord, string>
  mintMetadata!: Table<MintMetadataRecord, string>

  constructor() {
    super(DATABASE.NAME)

    this.version(DATABASE.VERSION).stores({
      // Transactions: indexed by id, direction, type, status, createdAt, mintUrl
      transactions: 'id, direction, type, status, createdAt, mintUrl, source',

      // Failed swaps: indexed by id, mintUrl, isRetryable, createdAt
      failedSwaps: 'id, mintUrl, isRetryable, createdAt, errorCode',

      // Processed events: indexed by eventId, txId, processedAt, result
      processedEvents: 'eventId, txId, processedAt, result',

      // Sync anchor: single record
      syncAnchor: 'id',

      // Settings: single record
      settings: 'id',

      // Encrypted wallet: single record
      encryptedWallet: 'id',

      // Lock state: single record
      lockState: 'id',

      // Proofs: indexed by id, mintUrl, secret
      proofs: 'id, mintUrl, secret',

      // Pending quotes: indexed by quoteId, mintUrl, createdAt
      pendingQuotes: 'quoteId, mintUrl, createdAt',

      // Pending melts: Lightning send recovery (melt quote info before payment)
      pendingMelts: 'meltQuoteId, mintUrl, createdAt',

      // Pending send tokens: Ecash send recovery (token saved after creation)
      pendingSendTokens: 'id, mintUrl, createdAt',

      // Mint metadata: indexed by url (NUT-06 cached info for offline support)
      mintMetadata: 'url, fetchedAt',
    })
  }
}

/**
 * Database singleton instance
 */
let dbInstance: ZappiDatabase | null = null

/**
 * Get database instance (singleton)
 */
export function getDatabase(): ZappiDatabase {
  if (!dbInstance) {
    dbInstance = new ZappiDatabase()
  }
  return dbInstance
}

/**
 * Reset database instance (for testing)
 */
export async function resetDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.delete()
    dbInstance = null
  }
}

/**
 * Clear all data (for logout)
 */
export async function clearAllData(): Promise<void> {
  const db = getDatabase()
  await Promise.all([
    db.transactions.clear(),
    db.failedSwaps.clear(),
    db.processedEvents.clear(),
    db.syncAnchor.clear(),
    db.settings.clear(),
    db.encryptedWallet.clear(),
    db.lockState.clear(),
    db.pendingQuotes.clear(),
    db.pendingMelts.clear(),
    db.pendingSendTokens.clear(),
  ])
}
