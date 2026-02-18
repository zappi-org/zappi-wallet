/**
 * Default mints
 */
export const DEFAULT_MINTS = [
  'https://mint.cubabitcoin.org',
  'https://mint.lnserver.com',
] as const

/**
 * Default relays
 */
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
] as const

/**
 * ZS (Zap Server) domain for NIP-05 relay lookup
 * TODO: Replace with actual ZS domain when ready
 * Set to empty string to skip ZS lookup and use DEFAULT_RELAYS
 */
export const ZS_DOMAIN = 'alpha-api.zappi.space'

/**
 * Nostr event kinds
 */
export const NOSTR_KINDS = {
  PROFILE: 0,
  TEXT_NOTE: 1,
  RELAY_LIST: 10002,
  DM_RELAY_LIST: 10050, // NIP-17 DM Relay List
  NUTZAP_INFO: 10019,
  GIFT_WRAP: 1059,
  PRIVATE_DM: 14,
} as const

/**
 * Timeout configurations (in milliseconds)
 */
export const TIMEOUTS = {
  /** Relay WebSocket connection timeout */
  RELAY_CONNECTION: 5000,
  /** Mint API request timeout */
  MINT_REQUEST: 10000,
  /** Mint quote polling interval */
  MINT_QUOTE_POLL: 2000,
  /** Watcher initialization timeout */
  WATCHER_INIT: 5000,
  /** Minimum interval between state reconstructions */
  MIN_RECONSTRUCTION_INTERVAL: 60000,
  /** Buffer for event recovery (2 days in seconds) */
  RECOVERY_BUFFER_SECONDS: 2 * 24 * 60 * 60,
} as const

/**
 * Auto-lock configurations
 */
export const AUTO_LOCK = {
  /** Default timeout in minutes */
  DEFAULT_TIMEOUT_MINUTES: 5,
  /** Minimum timeout in minutes */
  MIN_TIMEOUT_MINUTES: 1,
  /** Maximum timeout in minutes */
  MAX_TIMEOUT_MINUTES: 60,
  /** Maximum failed password attempts before lockout */
  MAX_FAILED_ATTEMPTS: 5,
  /** Lockout duration in minutes */
  LOCKOUT_DURATION_MINUTES: 15,
} as const

/**
 * Retry configurations
 */
export const RETRY = {
  /** Initial retry delay in milliseconds */
  INITIAL_DELAY: 30000,
  /** Maximum retry delay in milliseconds */
  MAX_DELAY: 300000,
  /** Exponential backoff multiplier */
  BACKOFF_MULTIPLIER: 2,
  /** Maximum number of retry attempts */
  MAX_ATTEMPTS: 10,
} as const

/**
 * Animation durations (in milliseconds)
 */
export const ANIMATIONS = {
  /** Success feedback duration */
  SUCCESS_FEEDBACK: 1500,
  /** Toast display duration */
  TOAST_DURATION: 3000,
  /** Modal transition duration */
  MODAL_TRANSITION: 200,
} as const

/**
 * Storage keys
 */
export const STORAGE_KEYS = {
  ENCRYPTED_MNEMONIC: 'zappi_encrypted_mnemonic',
  SETTINGS: 'zappi_settings',
  LOCK_STATE: 'zappi_lock_state',
  LAST_BACKGROUND_TIME: 'zappi_last_background_time',
} as const

/**
 * Database name and version
 */
export const DATABASE = {
  NAME: 'zappi_wallet_db',
  VERSION: 6,
} as const

/**
 * NIP-06 derivation path for Nostr keys
 */
export const NIP06_DERIVATION_PATH = "m/44'/1237'/0'/0/0"

/**
 * Cashu unit
 */
export const CASHU_UNIT = 'sat' as const

/**
 * Limits for mints and relays
 */
export const LIMITS = {
  /** Maximum number of mints */
  MAX_MINTS: 5,
  /** Maximum number of relays */
  MAX_RELAYS: 5,
} as const
