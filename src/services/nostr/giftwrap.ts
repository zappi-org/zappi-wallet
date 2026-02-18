import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { decryptWithKeys } from './nip44'
import { NOSTR_KINDS } from '@/core/constants'

/**
 * Rumor event (unsigned inner event from gift wrap)
 */
export interface Rumor {
  id?: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

/**
 * Unwrapped gift wrap result
 */
export interface UnwrappedGiftWrap {
  /** The outer gift wrap event */
  giftWrap: NostrEvent
  /** The sealed (encrypted) event inside the gift wrap */
  seal: NostrEvent
  /** The rumor (actual message) inside the seal */
  rumor: Rumor
}

/**
 * NutZap token data extracted from a private DM
 */
export interface NutZapData {
  /** Cashu token string */
  token: string
  /** Optional memo/comment */
  memo?: string
  /** Mint URL from token */
  mintUrl?: string
  /** Amount in sats */
  amount?: number
  /** Sender pubkey */
  senderPubkey: string
  /** Timestamp */
  createdAt: number
}

/**
 * Unwrap a NIP-59 gift wrap event
 *
 * Gift wrap structure:
 * 1. kind 1059 (gift wrap) - encrypted with recipient's key
 * 2. contains kind 13 (seal) - encrypted with sender's key
 * 3. seal contains the rumor (actual content)
 *
 * @param giftWrap The gift wrap event (kind 1059)
 * @param recipientPrivateKeyHex Recipient's private key for decryption
 */
export function unwrapGiftWrap(
  giftWrap: NostrEvent,
  recipientPrivateKeyHex: string
): UnwrappedGiftWrap {
  // Verify it's a gift wrap event
  if (giftWrap.kind !== NOSTR_KINDS.GIFT_WRAP) {
    throw new Error(`Expected kind ${NOSTR_KINDS.GIFT_WRAP}, got ${giftWrap.kind}`)
  }

  // Decrypt the seal (gift wrap is encrypted with recipient's key)
  const sealJson = decryptWithKeys(
    giftWrap.content,
    recipientPrivateKeyHex,
    giftWrap.pubkey
  )
  const seal = JSON.parse(sealJson) as NostrEvent

  // Verify seal signature
  if (!verifyEvent(seal)) {
    throw new Error('Invalid seal signature')
  }

  // Decrypt the rumor (seal is encrypted with sender's key)
  const rumorJson = decryptWithKeys(
    seal.content,
    recipientPrivateKeyHex,
    seal.pubkey
  )
  const rumor = JSON.parse(rumorJson) as Rumor

  return {
    giftWrap,
    seal,
    rumor,
  }
}

/**
 * Extract NutZap token from a private DM rumor
 *
 * NutZap structure in kind 14 (private DM):
 * - content: may contain memo
 * - tags: ["cashu", "cashuA..."] or ["cashu", "cashuB..."]
 *
 * @param rumor The decrypted rumor from a gift wrap
 */
export function extractNutZapFromRumor(rumor: Rumor): NutZapData | null {
  // Look for cashu token in tags
  let token: string | null = null
  let memo: string | undefined

  for (const tag of rumor.tags) {
    if (tag[0] === 'cashu' && tag[1]) {
      token = tag[1]
    }
  }

  // If no cashu tag, check if content is a token
  if (!token && rumor.content) {
    const content = rumor.content.trim()
    if (content.startsWith('cashuA') || content.startsWith('cashuB')) {
      token = content
    } else {
      // Content might be a memo
      memo = content || undefined
    }
  }

  if (!token) {
    return null
  }

  // Try to extract mint URL and amount from token
  let mintUrl: string | undefined
  let amount: number | undefined

  try {
    // Parse cashu token to get mint and amount
    const tokenData = parseTokenBasic(token)
    mintUrl = tokenData.mint
    amount = tokenData.amount
  } catch {
    // Ignore parsing errors - token will be validated when received
  }

  return {
    token,
    memo,
    mintUrl,
    amount,
    senderPubkey: rumor.pubkey,
    createdAt: rumor.created_at,
  }
}

/**
 * Process a gift wrap event and extract NutZap data
 *
 * @param giftWrap The gift wrap event
 * @param recipientPrivateKeyHex Recipient's private key
 * @returns NutZap data if the gift wrap contains a NutZap, null otherwise
 */
export function processGiftWrapForNutZap(
  giftWrap: NostrEvent,
  recipientPrivateKeyHex: string
): NutZapData | null {
  try {
    const { rumor } = unwrapGiftWrap(giftWrap, recipientPrivateKeyHex)

    // Check if it's a private DM (kind 14)
    if (rumor.kind !== NOSTR_KINDS.PRIVATE_DM) {
      return null
    }

    return extractNutZapFromRumor(rumor)
  } catch (error) {
    console.error('[GiftWrap] Failed to process gift wrap:', error)
    return null
  }
}

/**
 * Basic token parsing to extract mint URL and amount
 * This is a simplified version - full parsing happens in CashuService
 */
function parseTokenBasic(token: string): { mint: string; amount: number } {
  // Remove prefix
  const prefix = token.startsWith('cashuA') ? 'cashuA' : 'cashuB'
  const base64 = token.slice(prefix.length)

  // Decode base64url
  const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'))
  const data = JSON.parse(json)

  // cashuA format: { token: [{ mint, proofs }] }
  // cashuB format: { m: mint, u: unit, d: memo, t: [{ i, p: [proofs] }] }
  if (prefix === 'cashuA') {
    const tokenData = data.token?.[0]
    const mint = tokenData?.mint || ''
    const proofs = tokenData?.proofs || []
    const amount = proofs.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)
    return { mint, amount }
  } else {
    const mint = data.m || ''
    const proofs = data.t?.flatMap((t: { p: Array<{ a: number }> }) =>
      t.p?.map((p) => ({ amount: p.a })) || []
    ) || []
    const amount = proofs.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)
    return { mint, amount }
  }
}
