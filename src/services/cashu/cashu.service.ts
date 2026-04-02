import {
  Wallet,
  type Proof,
  type MintQuoteState,
  getEncodedToken,
  getDecodedToken,
} from '@cashu/cashu-ts'
import { getWalletCache } from '@/data/cache'
import { ok, err, type Result } from '@/core/types'
import { classifyCashuError } from '@/modules/cashu'
import type { BaseError } from '@/core/errors'

/**
 * Result of receiving a token
 */
export interface ReceiveResult {
  proofs: Proof[]
  mintUrl: string
}

/**
 * Decoded token info
 */
export interface DecodedToken {
  mintUrl: string
  proofs: Proof[]
  unit?: string
  memo?: string
}

/**
 * Service for Cashu mint operations
 * Wraps cashu-ts library with error handling and caching
 */
export class CashuService {
  private walletCache = getWalletCache()

  /**
   * Get or create a wallet for the given mint URL
   */
  async getWallet(mintUrl: string): Promise<Wallet> {
    return this.walletCache.getWallet(mintUrl)
  }

  /**
   * Clear the wallet cache
   */
  clearCache(): void {
    this.walletCache.clear()
  }

  // ===== Quote Status =====

  /**
   * Check mint quote status
   */
  async checkMintQuote(
    mintUrl: string,
    quoteId: string
  ): Promise<MintQuoteState> {
    const wallet = await this.getWallet(mintUrl)
    const quote = await wallet.checkMintQuote(quoteId)
    return quote.state
  }

  // ===== Token Operations =====

  /**
   * Receive a token (claim proofs)
   */
  async receiveToken(
    token: string,
    options?: { privkey?: string }
  ): Promise<Result<ReceiveResult, BaseError>> {
    try {
      const decoded = this.decodeToken(token)
      const wallet = await this.getWallet(decoded.mintUrl)
      const proofs = await wallet.receive(token, options)

      return ok({
        proofs,
        mintUrl: decoded.mintUrl,
      })
    } catch (error) {
      return err(classifyCashuError(error))
    }
  }

  /**
   * Encode proofs to a token string
   */
  encodeToken(mintUrl: string, proofs: Proof[], memo?: string): string {
    return getEncodedToken({
      mint: mintUrl,
      proofs,
      memo,
    })
  }

  /**
   * Decode a token string
   */
  decodeToken(token: string): DecodedToken {
    const decoded = getDecodedToken(token)

    return {
      mintUrl: decoded.mint,
      proofs: decoded.proofs,
      unit: decoded.unit,
      memo: decoded.memo,
    }
  }

  /**
   * Get total amount from proofs
   */
  getTotalAmount(proofs: Proof[]): number {
    return proofs.reduce((sum, p) => sum + p.amount, 0)
  }

  // ===== Proof State Operations =====

  /**
   * Check which proofs have been spent
   * Returns the secrets of spent proofs
   */
  async checkProofsSpent(
    mintUrl: string,
    proofs: Array<{ secret: string }>
  ): Promise<string[]> {
    const wallet = await this.getWallet(mintUrl)
    const states = await wallet.checkProofsStates(proofs)

    const spentSecrets: string[] = []
    states.forEach((state, index) => {
      if (String(state.state) === 'SPENT') {
        spentSecrets.push(proofs[index].secret)
      }
    })

    return spentSecrets
  }

}
