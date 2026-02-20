/**
 * Nostr DM Service
 * Handles sending encrypted direct messages via NIP-17 (Gift Wrap)
 *
 * Used for:
 * - Sending Cashu tokens in response to NUT-18 payment requests
 * - Future: General DM functionality
 */

import { SimplePool, nip17, nip19 } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'

// ============= Types =============

export interface SendDMOptions {
  /** Recipient's public key (hex or npub/nprofile) */
  recipientPubkey: string
  /** Message content */
  content: string
  /** Sender's private key (hex) */
  senderPrivkey: string
  /** Relays to publish to */
  relays: string[]
}

export interface SendTokenDMOptions {
  /** Recipient's public key (hex or npub/nprofile) */
  recipientPubkey: string
  /** Cashu token string */
  token: string
  /** Optional memo/description */
  memo?: string
  /** Payment request ID (for correlation) */
  requestId?: string
  /** Sender's private key (hex) */
  senderPrivkey: string
  /** Relays to publish to */
  relays: string[]
}

export interface DMSendResult {
  success: boolean
  eventId?: string
  error?: string
  publishedRelays?: string[]
}

// ============= Constants =============

const RELAY_TIMEOUT_MS = 10000

// ============= Functions =============

/**
 * Send a Cashu token via NIP-17 encrypted DM
 * Used for responding to NUT-18 payment requests with Nostr transport
 *
 * Sends in V4 JSON format for compatibility with cashu.me:
 * {id: requestId, mint, unit, proofs}
 *
 * Falls back to raw token if decoding fails.
 */
export async function sendTokenViaDM(options: SendTokenDMOptions): Promise<DMSendResult> {
  const { recipientPubkey, token, requestId, senderPrivkey, relays } = options

  // Try to convert to V4 JSON format (what cashu.me expects)
  let content = token
  try {
    // Dynamic import to avoid circular dependencies
    const { getDecodedToken } = await import('@cashu/cashu-ts')
    const decoded = getDecodedToken(token)

    // Build V4 JSON format with request ID
    const v4Token = {
      id: requestId,  // NUT-18 request ID for correlation
      mint: decoded.mint,
      unit: decoded.unit || 'sat',
      proofs: decoded.proofs,
    }
    content = JSON.stringify(v4Token)
  } catch (err) {
    // Fallback to raw token if decoding fails
    console.warn('[NostrDM] Failed to convert to V4 JSON, sending raw token:', err)
  }

  return sendDM({
    recipientPubkey,
    content,
    senderPrivkey,
    relays,
  })
}

/**
 * Send an encrypted DM via NIP-17 (Gift Wrap)
 */
export async function sendDM(options: SendDMOptions): Promise<DMSendResult> {
  const { recipientPubkey, content, senderPrivkey, relays } = options

  if (relays.length === 0) {
    return {
      success: false,
      error: 'No relays configured',
    }
  }

  try {
    // Normalize recipient pubkey (convert npub/nprofile to hex if needed)
    const recipientHex = normalizePubkey(recipientPubkey)
    if (!recipientHex) {
      return {
        success: false,
        error: 'Invalid recipient public key',
      }
    }

    // Convert sender private key to bytes
    const senderPrivkeyBytes = hexToBytes(senderPrivkey)

    // Create NIP-17 Gift Wrapped event
    // nip17.wrapEvent is async in some versions of nostr-tools
    // nip17.wrapEvent(senderPrivateKey, recipient, message)
    const giftWrappedEvent = await nip17.wrapEvent(
      senderPrivkeyBytes,
      { publicKey: recipientHex },
      content
    )

    // Publish to relays
    const pool = new SimplePool()
    const publishedRelays: string[] = []
    const errors: string[] = []

    // Publish to each relay with timeout
    await Promise.all(
      relays.map(async (relayUrl) => {
        try {
          const publishPromise = Promise.all(pool.publish([relayUrl], giftWrappedEvent))
          // Prevent unhandled rejection if timeout wins the race
          publishPromise.catch(() => {})
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Publish timeout')), RELAY_TIMEOUT_MS)
          )

          await Promise.race([publishPromise, timeoutPromise])
          publishedRelays.push(relayUrl)
          console.log(`[NostrDM] Published to ${relayUrl}`)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          errors.push(`${relayUrl}: ${errorMsg}`)
          console.warn(`[NostrDM] Failed to publish to ${relayUrl}:`, err)
        }
      })
    )

    // Clean up
    pool.close(relays)

    if (publishedRelays.length === 0) {
      return {
        success: false,
        error: `Failed to publish to any relay: ${errors.join(', ')}`,
      }
    }

    return {
      success: true,
      eventId: giftWrappedEvent.id,
      publishedRelays,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('[NostrDM] Error sending DM:', err)
    return {
      success: false,
      error: errorMsg,
    }
  }
}

/**
 * Normalize a public key to hex format
 * Accepts: hex, npub1..., nprofile1...
 */
function normalizePubkey(input: string): string | null {
  const trimmed = input.trim()

  // Already hex (64 chars)
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  // npub or nprofile
  if (trimmed.startsWith('npub1') || trimmed.startsWith('nprofile1')) {
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type === 'npub') {
        return decoded.data
      }
      if (decoded.type === 'nprofile') {
        return decoded.data.pubkey
      }
    } catch {
      return null
    }
  }

  return null
}

/**
 * Extract relay hints from nprofile
 * Returns empty array if input is not nprofile or has no relays
 */
function extractRelaysFromNprofile(input: string): string[] {
  const trimmed = input.trim()

  if (!trimmed.startsWith('nprofile1')) {
    return []
  }

  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'nprofile' && decoded.data.relays) {
      return decoded.data.relays
    }
  } catch {
    // Ignore decode errors
  }

  return []
}

/**
 * Get recommended relays for a recipient
 * Priority:
 * 1. Relay hints embedded in nprofile (most reliable for NUT-18)
 * 2. Kind:10050 (DM Relay List) lookup
 * 3. Default relays
 */
export async function getRecipientDMRelays(
  recipientPubkey: string,
  defaultRelays: string[]
): Promise<string[]> {
  // First, try to extract relays from nprofile (most reliable for NUT-18)
  const nprofileRelays = extractRelaysFromNprofile(recipientPubkey)
  if (nprofileRelays.length > 0) {
    console.log(`[NostrDM] Using ${nprofileRelays.length} relays from nprofile`)
    return nprofileRelays
  }

  // Normalize pubkey for kind:10050 lookup
  const recipientHex = normalizePubkey(recipientPubkey)
  if (!recipientHex) {
    return defaultRelays
  }

  // Try to fetch kind:10050 (DM Relay List)
  try {
    const pool = new SimplePool()

    // Fetch kind:10050 (DM Relay List) for recipient
    const events = await pool.querySync(defaultRelays, {
      kinds: [10050],
      authors: [recipientHex],
      limit: 1,
    })

    pool.close(defaultRelays)

    if (events.length === 0) {
      console.log('[NostrDM] No kind:10050 found, using default relays')
      return defaultRelays
    }

    // Extract relay URLs from tags
    const dmRelays = events[0].tags
      .filter((tag) => tag[0] === 'relay' && tag[1])
      .map((tag) => tag[1])

    if (dmRelays.length === 0) {
      return defaultRelays
    }

    console.log(`[NostrDM] Found ${dmRelays.length} DM relays from kind:10050`)
    return dmRelays
  } catch (err) {
    console.warn('[NostrDM] Failed to fetch recipient DM relays:', err)
    return defaultRelays
  }
}
