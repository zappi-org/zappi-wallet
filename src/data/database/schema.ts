import Dexie, { type Table } from 'dexie'
import type { Transaction, WalletSettings, MintMetadata, ExchangeRateCache, Contact } from '@/core/types'
import type { ProcessedRecord, SyncAnchor } from '@/core/types'
import { DATABASE } from '@/core/constants'

/**
 * Transaction record for DB storage (id is the primary key)
 */
export type TransactionRecord = Transaction

/**
 * Failed incoming record for DB storage (id is the primary key)
 */
export interface FailedIncomingRecord {
  id: string
  payload: string
  accountId: string
  amount: number
  error: string
  errorCode: string
  isRetryable: boolean
  attemptCount: number
  lastAttemptAt: number
  createdAt: number
  externalId?: string
  txId?: string
}

/**
 * Processed record for DB storage (externalId is the primary key)
 */
export type ProcessedRecordEntry = ProcessedRecord

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
  /** SDK SendOperation.id — for linking with coco-cashu-core's SendApi */
  operationId?: string
  createdAt: number
}

/**
 * Pending received token record for offline P2PK token storage
 * Stores tokens accepted offline, to be redeemed when online
 */
export interface PendingReceivedTokenRecord {
  id: string        // primary key (random UUID)
  token: string     // the cashu token string
  mintUrl: string
  amount: number
  dleqStatus: 'valid' | 'missing' // only valid/missing tokens are stored (failed = rejected)
  createdAt: number
}

/**
 * Receive request — first-class domain entity for pending receive requests.
 * Owns both Lightning (coco quote) and NUT-18 (ecash) payment methods.
 * Source of truth for pending receive item display.
 */
export type ReceiveRequestStatus = 'pending' | 'completed' | 'expired' | 'cancelled'

export interface ReceiveRequestRecord {
  id: string                    // primary key (UUID)
  status: ReceiveRequestStatus
  amount: number
  mintUrl: string
  createdAt: number
  expiresAt: number             // unix ms

  // Lightning payment method
  quoteId: string               // coco mint quote ID (needed for minting)
  invoice: string               // bolt11 invoice

  // NUT-18 payment method (optional — Lightning-only requests possible)
  ecashRequest?: string         // creqB/creqA encoded NUT-18 payment request
  ecashRequestId?: string       // NUT-18 request ID (for matching incoming payments)
  httpEndpoint?: string         // HTTP transport endpoint URL

  // BIP-321 unified URI
  bip321Uri?: string            // bitcoin:?lightning=...&creq=...

  // Completion info
  completedAt?: number
  completedMethod?: 'lightning' | 'ecash'
}

/**
 * Mint metadata record for offline caching (NUT-06, url is the primary key)
 */
export type MintMetadataRecord = MintMetadata

/**
 * Exchange rate cache record for offline support (single record, id = 'current')
 */
export type ExchangeRateCacheRecord = ExchangeRateCache

/**
 * Zappi Database
 */
export class ZappiDatabase extends Dexie {
  transactions!: Table<TransactionRecord, string>
  failedIncomings!: Table<FailedIncomingRecord, string>
  processedRecords!: Table<ProcessedRecordEntry, string>
  syncAnchor!: Table<SyncAnchorRecord, string>
  settings!: Table<SettingsRecord, string>
  encryptedWallet!: Table<EncryptedWalletRecord, string>
  lockState!: Table<LockStateRecord, string>
  proofs!: Table<ProofRecord, string>
  pendingMelts!: Table<PendingMeltRecord, string>
  pendingSendTokens!: Table<PendingSendTokenRecord, string>
  pendingReceivedTokens!: Table<PendingReceivedTokenRecord, string>
  receiveRequests!: Table<ReceiveRequestRecord, string>
  mintMetadata!: Table<MintMetadataRecord, string>
  exchangeRates!: Table<ExchangeRateCacheRecord, string>
  contacts!: Table<Contact, string>

  constructor() {
    super(DATABASE.NAME)

    this.version(DATABASE.VERSION).stores({
      // Transactions: indexed by id, direction, type, status, createdAt, mintUrl, operationId
      transactions: 'id, direction, type, status, createdAt, mintUrl, source, operationId',

      // v14: old failedSwaps table deleted (data loss accepted — retry queue only)
      failedSwaps: null,

      // Failed incomings: indexed by id, accountId, isRetryable, createdAt
      failedIncomings: 'id, accountId, isRetryable, createdAt, errorCode',

      // v15: old processedEvents table deleted (dedup data loss accepted — crash recovery handles re-processing)
      processedEvents: null,

      // Processed records: indexed by externalId, txId, processedAt, result
      processedRecords: 'externalId, txId, processedAt, result',

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

      // Pending melts: Lightning send recovery (melt quote info before payment)
      pendingMelts: 'meltQuoteId, mintUrl, createdAt',

      // Pending send tokens: Ecash send recovery (token saved after creation)
      pendingSendTokens: 'id, mintUrl, createdAt',

      // Pending received tokens: offline P2PK tokens awaiting online redemption
      pendingReceivedTokens: 'id, mintUrl, createdAt',

      // Receive requests: unified receive request entity (Lightning + NUT-18)
      receiveRequests: 'id, status, mintUrl, quoteId, ecashRequestId, createdAt',

      // Mint metadata: indexed by url (NUT-06 cached info for offline support)
      mintMetadata: 'url, fetchedAt',

      // Exchange rates: single record cache for offline support
      exchangeRates: 'id',

      // Contacts: address book entries
      contacts: 'id, name, address, addressType, createdAt',
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
 * Clear all data related to a specific mint
 * Removes proofs, pending items, failed incomings, and metadata.
 * Transactions are kept for historical reference.
 */
export async function clearMintData(mintUrl: string): Promise<void> {
  const db = getDatabase()
  const normalized = mintUrl.endsWith('/') ? mintUrl.slice(0, -1) : mintUrl
  const variants = [normalized, normalized + '/']

  await Promise.all([
    db.proofs.where('mintUrl').anyOf(variants).delete(),
    db.failedIncomings.where('accountId').anyOf(variants).delete(),
    db.pendingMelts.where('mintUrl').anyOf(variants).delete(),
    db.pendingSendTokens.where('mintUrl').anyOf(variants).delete(),
    db.pendingReceivedTokens.where('mintUrl').anyOf(variants).delete(),
    db.receiveRequests.where('mintUrl').anyOf(variants).delete(),
    db.mintMetadata.where('url').anyOf(variants).delete(),
  ])
}

/**
 * Clear all data (for logout)
 */
export async function clearAllData(): Promise<void> {
  const db = getDatabase()
  await Promise.all([
    db.transactions.clear(),
    db.failedIncomings.clear(),
    db.processedRecords.clear(),
    db.syncAnchor.clear(),
    db.settings.clear(),
    db.encryptedWallet.clear(),
    db.lockState.clear(),
    db.pendingMelts.clear(),
    db.pendingSendTokens.clear(),
    db.pendingReceivedTokens.clear(),
    db.receiveRequests.clear(),
  ])
}
