// Build-time defaults for customer support (PWA / no-env builds rely on these).
// User-coupled relays (write/read/dm) are NOT here — those come from
// SupportRelaysProvider (settings store).
//
// To change which agent users contact, update SUPPORT_AGENT_NPUB.

export const SUPPORT_AGENT_NPUB =
  'npub15dyu2nnzckggfe6ccz465cx0cnsf6g3mmpr5h8nau3jt49w0ydkslj83ty'

export const SUPPORT_BOOTSTRAP_RELAYS: readonly string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.vulpem.com'
]

export const SUPPORT_DISCOVERY_RELAYS: readonly string[] = SUPPORT_BOOTSTRAP_RELAYS

export const SUPPORT_BLOSSOM_SERVERS: readonly string[] = [
  'https://blossom.primal.net',
  'https://blossom.band',
  'https://blossom.nostr.build',
]

// Always-on relays merged into write/read/dm regardless of user settings.
// Guarantees the support channel keeps working even if the user wipes their
// relay list. URLs here cannot be removed or disabled from the UI.
export const SUPPORT_FLOOR_RELAYS: readonly string[] = [
  'wss://nostr.vulpem.com',
]

export const SUPPORT_DEFAULT_MAX_ATTACHMENT_COUNT = 3
export const SUPPORT_DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
