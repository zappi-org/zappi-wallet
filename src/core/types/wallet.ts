import type { Proof } from '@cashu/cashu-ts'

/**
 * Network state for online/offline handling
 */
export type NetworkState = 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'ERROR'

/**
 * Mint information (runtime state)
 */
export interface MintInfo {
  url: string
  name?: string
  iconUrl?: string
  balance: number
  isOnline: boolean
  lastChecked?: number
}

/**
 * Mint metadata from NUT-06 (cached locally for offline support)
 */
export interface MintMetadata {
  url: string
  name?: string
  iconUrl?: string
  description?: string
  pubkey?: string
  fetchedAt: number
}

/**
 * Wallet balance summary
 */
export interface WalletBalance {
  total: number
  byMint: Record<string, number>
}

/**
 * Transaction direction
 */
export type TransactionDirection = 'receive' | 'send'

/**
 * Transaction type
 */
export type TransactionType = 'lightning' | 'ecash' | 'nutzap' | 'swap'

/**
 * Transaction status
 */
export type TransactionStatus = 'pending' | 'completed' | 'failed'

/**
 * Transaction record
 */
export interface Transaction {
  id: string
  direction: TransactionDirection
  type: TransactionType
  amount: number
  mintUrl: string
  status: TransactionStatus
  memo?: string
  createdAt: number
  completedAt?: number
  failedAt?: number
  failureReason?: string
  metadata?: Record<string, unknown>
}

/**
 * Proof with metadata
 */
export interface StoredProof extends Proof {
  mintUrl: string
  addedAt: number
}

/**
 * Failed swap info for retry queue
 */
export interface FailedSwap {
  id: string
  token: string
  mintUrl: string
  amount: number
  error: string
  errorCode: string
  isRetryable: boolean
  attemptCount: number
  lastAttemptAt: number
  createdAt: number
  nostrEventId?: string
  txId?: string
}

/**
 * Supported language codes
 */
export type SupportedLanguage = 'ko' | 'en' | 'es' | 'ja' | 'id'

/**
 * Wallet settings
 */
export interface WalletSettings {
  mints: string[]
  relays: string[]
  lightningAddress?: string
  autoLockEnabled: boolean
  autoLockTimeoutMinutes: number
  soundEnabled: boolean
  expertModeEnabled: boolean
  manualMintSelectionEnabled: boolean
  language?: SupportedLanguage
}

/**
 * Encrypted wallet data
 */
export interface EncryptedWalletData {
  encryptedMnemonic: string
  salt: string
  iv: string
}

/**
 * Lock state
 */
export interface LockState {
  isLocked: boolean
  failedAttempts: number
  lockedUntil?: number
}
