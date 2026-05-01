import type { FiatCurrency } from './fiat'
import type { TransactionIntent } from '@/core/domain/transaction'

/**
 * Cashu proof (inlined from cashu-ts to maintain R1 domain purity)
 */
export interface Proof {
  id: string
  amount: number
  secret: string
  C: string
}

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
  /** User-defined alias (e.g. "지갑 1") — takes display priority over name */
  alias?: string
  /** Original mint name from NUT-06 metadata */
  mintName?: string
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
  /** Raw NUT support declarations from NUT-06 nuts field */
  nuts?: Record<string, unknown>
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
export type TransactionType = 'lightning' | 'ecash' | 'ecash-token' | 'nutzap' | 'swap'

/**
 * Transaction status
 */
export type TransactionStatus = 'pending' | 'completed' | 'failed'

/**
 * Token state (cached from mint's checkProofsStates)
 */
export type TokenState = 'unspent' | 'pending' | 'spent' | 'unknown'

/**
 * Transaction source (derived from NUT-18 request ID prefix)
 */
export type TransactionSource = 'zappi-pos' | 'zappi-kiosk' | 'zappi-api' | 'zappi-link' | 'wallet' | 'unknown'

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
  expiresAt?: number
  failedAt?: number
  failureReason?: string
  /** Domain intent — persisted as a free-form Dexie field; toDomain reads this first. */
  intent?: TransactionIntent
  metadata?: Record<string, unknown>

  // Token lifecycle
  token?: string
  tokenState?: TokenState
  /** External send operation identifier for lifecycle recovery/finalization */
  operationId?: string

  // Lightning details
  bolt11?: string
  preimage?: string

  // Source identification (NUT-18 prefix)
  source?: TransactionSource

  // Fiat currency (populated when exchange rate available)
  fiatAmount?: number
  fiatCurrency?: string
  exchangeRate?: number
}

/**
 * Proof with metadata
 */
export interface StoredProof extends Proof {
  mintUrl: string
  addedAt: number
}

/**
 * Failed incoming payment for retry queue
 */
export interface FailedIncoming {
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
  redeemSucceeded?: boolean
  receiveRequestPaymentRef?: string
  receiveRequestMethod?: string
}

/**
 * Supported language codes
 */
export type SupportedLanguage = 'ko' | 'en' | 'es' | 'ja' | 'id'

export type MintCardDesignPreset = 'classic' | 'modern'

/**
 * Provisioned POS device record
 */
export interface POSDevice {
  index: number
  label: string
  p2pkPublicKey: string // hex, for identifying payments from this POS
  nostrPublicKey: string // hex, for receiving ACKs from wallet
  createdAt: number
}

/**
 * POS provisioning payload (encoded in QR code)
 */
export interface POSProvisioningPayload {
  version: 1
  walletPubkey: string       // wallet's P2PK pubkey (re-lock target)
  walletNostrPubkey: string  // wallet's Nostr pubkey (NIP-17 recipient)
  subKeypair: {
    index: number
    p2pkPublicKey: string
    p2pkPrivateKey: string
    nostrPublicKey: string
    nostrPrivateKey: string
  }
  zappiLinkUrl?: string
  zappiLinkUser?: string
  mints: string[]
  relays: string[]
}

/**
 * Wallet settings
 */
export interface WalletSettings {
  mints: string[]
  relays: string[]
  lightningAddress?: string
  /** zappi-link API base URL extracted from LNURL callback (e.g. "https://link.zappi.space") */
  zappiLinkApiUrl?: string
  autoLockEnabled: boolean
  autoLockTimeoutMinutes: number
  soundEnabled: boolean
  expertModeEnabled: boolean
  manualMintSelectionEnabled: boolean
  balanceHidden: boolean
  language?: SupportedLanguage
  /** Amount display format: BIP-177 (₿ 1,000) or sats (1,000 sats) */
  unitDisplay?: 'bip177' | 'sats'
  /** User-defined mint aliases: { mintUrl: "지갑 1" } */
  mintAliases?: Record<string, string>
  /** User-defined mint card colors: { mintUrl: "indigo" | "#FF5500" } */
  mintColors?: Record<string, string>
  /** User-defined mint card design presets: { mintUrl: "classic" | "modern" } */
  mintCardDesignPresets?: Record<string, MintCardDesignPreset>
  posDevices?: POSDevice[]
  /** Preferred fiat currency for display (default: 'USD') */
  fiatCurrency?: FiatCurrency
  /** Whether to show fiat conversion alongside BTC amounts (default: true) */
  showFiatConversion?: boolean
  /** Sender Privacy mode: prefer routes where the mint cannot link sender to receiver, even at higher fees */
  senderPrivacyMode?: boolean
  /** Token 탭 PendingEmptyWidget을 마지막으로 닫은 시각 (ms epoch). 이후 새 send-claim 발생 시 다시 표시. */
  pendingEmptyDismissedAt?: number | null
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
