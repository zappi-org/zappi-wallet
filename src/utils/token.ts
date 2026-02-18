import { getDecodedToken } from '@cashu/cashu-ts'

/**
 * P2PK secret structure
 * Format: ["P2PK", { "nonce": "...", "data": "<pubkey>", "tags": [...] }]
 */

/**
 * Parse a proof's secret to check if it's P2PK and extract the pubkey
 */
function parseP2PKSecret(secret: string): string | null {
  try {
    const parsed = JSON.parse(secret)
    if (Array.isArray(parsed) && parsed[0] === 'P2PK' && parsed[1]?.data) {
      return parsed[1].data // Return the pubkey
    }
    return null
  } catch {
    return null
  }
}

/**
 * Check if a Cashu token is P2PK locked to a specific public key
 * Only tokens locked to the user's own key can be safely stored for later redemption
 *
 * @param token - Cashu token string (cashuA... or cashuB...)
 * @param userPubkey - User's P2PK public key (hex format, with or without '02' prefix)
 * @returns true if ALL proofs in the token are locked to the user's pubkey
 */
export function isP2PKLockedToUser(token: string, userPubkey: string): boolean {
  try {
    const decoded = getDecodedToken(token)

    if (decoded.proofs.length === 0) return false

    // Normalize pubkey (handle both with and without 02 prefix)
    const normalizedUserPubkey = userPubkey.startsWith('02')
      ? userPubkey
      : `02${userPubkey}`

    // Check if ALL proofs are P2PK locked to the user's pubkey
    return decoded.proofs.every(proof => {
      const lockedToPubkey = parseP2PKSecret(proof.secret)
      if (!lockedToPubkey) return false

      // Compare pubkeys (handle 02 prefix variations)
      const normalizedLockPubkey = lockedToPubkey.startsWith('02')
        ? lockedToPubkey
        : `02${lockedToPubkey}`

      return normalizedUserPubkey === normalizedLockPubkey
    })
  } catch {
    return false
  }
}

/**
 * Check if a token has any P2PK lock (regardless of which key)
 */
export function hasP2PKLock(token: string): boolean {
  try {
    const decoded = getDecodedToken(token)
    return decoded.proofs.some(proof => parseP2PKSecret(proof.secret) !== null)
  } catch {
    return false
  }
}

/**
 * Get token info for display purposes
 */
export interface TokenInfo {
  amount: number
  mintUrl: string
  isP2PKLockedToUser: boolean
  hasAnyP2PKLock: boolean
  memo?: string
}

export function getTokenInfo(token: string, userPubkey?: string): TokenInfo | null {
  try {
    const decoded = getDecodedToken(token)
    const amount = decoded.proofs.reduce((sum, p) => sum + p.amount, 0)

    return {
      amount,
      mintUrl: decoded.mint,
      isP2PKLockedToUser: userPubkey ? isP2PKLockedToUser(token, userPubkey) : false,
      hasAnyP2PKLock: hasP2PKLock(token),
      memo: decoded.memo,
    }
  } catch {
    return null
  }
}
