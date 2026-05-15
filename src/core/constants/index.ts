/**
 * Default mints
 */
export const DEFAULT_MINTS = [
  'https://mint.lemonfizz.st',
] as const

/**
 * Default relays
 */
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nostr.vulpem.com',
  'wss://nos.lol',
] as const

/**
 * ZS (Zap Server) domain for NIP-05 relay lookup
 * TODO: Replace with actual ZS domain when ready
 * Set to empty string to skip ZS lookup and use DEFAULT_RELAYS
 */
export const ZS_DOMAIN = ''

/**
 * Nostr event kinds
 */
export const NOSTR_KINDS = {
  PROFILE: 0,
  TEXT_NOTE: 1,
  NIP98_AUTH: 27235,
  PARAMETERIZED_REPLACEABLE: 30078,
  RELAY_LIST: 10002,
  DM_RELAY_LIST: 10050, // NIP-17 DM Relay List
  NUTZAP_INFO: 10019,
  GIFT_WRAP: 1059,
  PRIVATE_DM: 14,
} as const

/**
 * Zappi Link service configuration
 */
export const ZAPPI_LINK_URL = 'https://link.zappi.space'
export const ZAPPI_LINK_DOMAIN = 'zappi.space'

/**
 * Timeout configurations (in milliseconds)
 */
export const TIMEOUTS = {
  /** Relay WebSocket connection timeout */
  RELAY_CONNECTION: 5000,
  /** Mint API request timeout */
  MINT_REQUEST: 10000,
  /** Mint quote polling interval */
  MINT_QUOTE_POLL: 8000,
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
  VERSION: 19,
} as const

/**
 * Nostr gift-wrap receive synchronization
 */
export const GIFT_WRAP_SYNC = {
  /** NIP-17/NIP-59 wrappers can be timestamped up to two days in the past; add five minutes for clock skew. */
  TIMESTAMP_OVERLAP_SECONDS: TIMEOUTS.RECOVERY_BUFFER_SECONDS + 5 * 60,
  /** Stale processing rows are safe to retry after this interval. */
  STALE_PROCESSING_MS: 2 * 60 * 1000,
  /** Avoid expensive relay catch-up on every visibility flicker. */
  RESUME_THROTTLE_MS: 60 * 1000,
  /** Keep each processor pass bounded for foreground UX. */
  PROCESS_BATCH_LIMIT: 25,
  /** Backoff failed inbox rows before retrying. */
  FAILED_RETRY_DELAY_MS: 30 * 1000,
} as const

/**
 * Outgoing eCash lifecycle synchronization
 */
export const OUTGOING_ECASH_SYNC = {
  /** Foreground-only polling interval for recipient-claimed outgoing tokens. */
  ACTIVE_POLL_MS: 15 * 1000,
  /** If publish has not completed by then, treat it as recoverable unknown instead of leaving it stuck. */
  PENDING_PUBLISH_STALE_MS: 60 * 1000,
} as const

/**
 * Exchange rate configurations
 */
export const EXCHANGE_RATE = {
  /** Minimum interval between API calls (60 seconds) */
  THROTTLE_MS: 60_000,
  /** Rate considered stale after 5 minutes (triggers background refresh) */
  STALE_MS: 5 * 60_000,
  /** API request timeout */
  FETCH_TIMEOUT: 10_000,
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
  /** Maximum number of relays */
  MAX_RELAYS: 5,
  /** Minimum number of relays */
  MIN_RELAYS: 2,
  /** Minimum number of mints */
  MIN_MINTS: 1,
  /** Maximum address book display name length */
  MAX_CONTACT_NAME_LENGTH: 30,
  /** Maximum custom mint card name length */
  MAX_MINT_NAME_LENGTH: 20,
} as const

export { FIAT_CURRENCIES } from './fiat'
export { NUT_NAMES, getNutName, getSupportedNuts } from './nuts'
