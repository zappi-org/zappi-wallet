import { getDecodedToken, hasValidDleq, type Token, type Proof } from '@cashu/cashu-ts'
import type { Wallet } from '@/data/cache/wallet-cache'

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

/**
 * DLEQ verification result (Macadamia approach)
 * - 'valid': All proofs have valid DLEQ — safe to accept offline
 * - 'missing': Some proofs lack DLEQ or keyset unavailable — warn user, allow accept
 * - 'failed': At least one proof has invalid DLEQ — reject (possible forgery)
 */
export type DleqResult = 'valid' | 'missing' | 'failed'

/**
 * Verify DLEQ proofs for a decoded token (Macadamia-style 3-state check)
 *
 * @param decodedToken - Decoded cashu token
 * @param getCachedWallet - Optional function to get a cached wallet (for keyset access)
 * @returns DleqResult
 */
export async function verifyTokenDleq(
  decodedToken: Token,
  getCachedWallet?: (mintUrl: string) => Wallet | undefined,
): Promise<DleqResult> {
  const { proofs, mint: mintUrl } = decodedToken

  if (proofs.length === 0) return 'missing'

  // Try to get wallet for keyset access
  let wallet: Wallet | undefined
  if (getCachedWallet) {
    wallet = getCachedWallet(mintUrl)
  }

  // Group proofs by keyset ID
  const keysetGroups = new Map<string, Proof[]>()
  for (const proof of proofs) {
    const id = proof.id
    const group = keysetGroups.get(id) || []
    group.push(proof)
    keysetGroups.set(id, group)
  }

  let allHaveDleq = true

  for (const [keysetId, groupProofs] of keysetGroups) {
    // Try to get keyset keys from cached wallet
    let keyset: { id: string; keys: Record<number, string> } | undefined
    if (wallet) {
      try {
        const ks = wallet.keyChain.getKeyset(keysetId)
        if (ks && ks.hasKeys) {
          keyset = { id: ks.id, keys: ks.keys }
        }
      } catch {
        // Keyset not found in cache
      }
    }

    for (const proof of groupProofs) {
      // No DLEQ data on proof → 'missing'
      if (!proof.dleq) {
        allHaveDleq = false
        continue
      }

      // Have DLEQ but no keyset to verify → treat as 'missing'
      if (!keyset) {
        allHaveDleq = false
        continue
      }

      // Verify DLEQ
      try {
        const valid = hasValidDleq(proof, keyset)
        if (!valid) {
          return 'failed' // Immediate reject on any invalid DLEQ
        }
      } catch {
        // Verification error → treat as missing
        allHaveDleq = false
      }
    }
  }

  return allHaveDleq ? 'valid' : 'missing'
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
