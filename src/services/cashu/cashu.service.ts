import {
  Wallet,
  type Proof,
  type MintQuoteState,
  type MintQuoteBolt11Response,
  getEncodedToken,
  getDecodedToken,
} from '@cashu/cashu-ts'
import { getWalletCache } from '@/data/cache'
import { ok, err, type Result } from '@/core/types'
import { classifyCashuError, type BaseError } from '@/core/errors'
import type { MintQuote, MeltQuote } from '@/core/types'

/**
 * Type for subscription canceller function
 */
export type SubscriptionCanceller = () => void

/**
 * Result of receiving a token
 */
export interface ReceiveResult {
  proofs: Proof[]
  mintUrl: string
}

/**
 * Result of melting tokens
 */
export interface MeltResult {
  paid: boolean
  preimage?: string
  change: Proof[]
}

/**
 * Result of creating send proofs
 */
export interface SendProofsResult {
  send: Proof[]
  keep: Proof[]
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

  // ===== Mint Operations =====

  /**
   * Create a mint quote (Lightning invoice for receiving)
   */
  async createMintQuote(
    mintUrl: string,
    amount: number
  ): Promise<Result<MintQuote, BaseError>> {
    try {
      const wallet = await this.getWallet(mintUrl)
      const quote = await wallet.createMintQuote(amount)

      return ok({
        quoteId: quote.quote,
        mintUrl,
        amount,
        request: quote.request,
        state: quote.state as MintQuote['state'],
        expiry: quote.expiry,
      })
    } catch (error) {
      return err(classifyCashuError(error))
    }
  }

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

  /**
   * Redeem a paid mint quote to get proofs
   */
  async redeemMintQuote(
    mintUrl: string,
    quoteId: string,
    amount: number
  ): Promise<Result<Proof[], BaseError>> {
    try {
      const wallet = await this.getWallet(mintUrl)
      const proofs = await wallet.mintProofs(amount, quoteId)
      return ok(proofs)
    } catch (error) {
      return err(classifyCashuError(error))
    }
  }

  // ===== Melt Operations =====

  /**
   * Create a melt quote (for paying Lightning invoice)
   */
  async createMeltQuote(
    mintUrl: string,
    invoice: string
  ): Promise<Result<MeltQuote, BaseError>> {
    try {
      const wallet = await this.getWallet(mintUrl)
      const quote = await wallet.createMeltQuote(invoice)

      return ok({
        quoteId: quote.quote,
        mintUrl,
        amount: quote.amount,
        feeReserve: quote.fee_reserve,
        request: invoice,
        state: quote.state as MeltQuote['state'],
        expiry: quote.expiry,
      })
    } catch (error) {
      return err(classifyCashuError(error))
    }
  }

  /**
   * Melt tokens (pay Lightning invoice)
   */
  async meltTokens(
    mintUrl: string,
    quoteId: string,
    proofs: Proof[]
  ): Promise<Result<MeltResult, BaseError>> {
    try {
      const wallet = await this.getWallet(mintUrl)
      // Get the full quote object first
      const quoteResponse = await wallet.checkMeltQuoteBolt11(quoteId)
      // Use the ops API for melting
      const result = await wallet.ops.meltBolt11(quoteResponse, proofs).run()

      return ok({
        paid: result.quote.state === 'PAID',
        preimage: result.quote.payment_preimage ?? undefined,
        change: result.change,
      })
    } catch (error) {
      return err(classifyCashuError(error))
    }
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
   * Create proofs for sending (swap to specific amount)
   */
  async createSendProofs(
    mintUrl: string,
    amount: number,
    proofs: Proof[]
  ): Promise<Result<SendProofsResult, BaseError>> {
    try {
      const wallet = await this.getWallet(mintUrl)
      const result = await wallet.send(amount, proofs)

      return ok({
        send: result.send,
        keep: result.keep,
      })
    } catch (error) {
      return err(classifyCashuError(error))
    }
  }

  /**
   * Get total amount from proofs
   */
  getTotalAmount(proofs: Proof[]): number {
    return proofs.reduce((sum, p) => sum + p.amount, 0)
  }

  // ===== WebSocket Operations (NUT-17) =====

  /**
   * Connect WebSocket for a mint
   */
  async connectWebSocket(mintUrl: string): Promise<boolean> {
    try {
      const wallet = await this.getWallet(mintUrl)
      await wallet.mint.connectWebSocket()
      return true
    } catch (error) {
      console.warn('WebSocket connection failed for mint:', mintUrl, error)
      return false
    }
  }

  /**
   * Disconnect WebSocket for a mint
   */
  async disconnectWebSocket(mintUrl: string): Promise<void> {
    try {
      const wallet = await this.getWallet(mintUrl)
      wallet.mint.disconnectWebSocket()
    } catch (error) {
      console.warn('WebSocket disconnect failed:', error)
    }
  }

  /**
   * Check if WebSocket is connected for a mint
   */
  async isWebSocketConnected(mintUrl: string): Promise<boolean> {
    try {
      const wallet = await this.getWallet(mintUrl)
      return wallet.mint.webSocketConnection !== undefined
    } catch {
      return false
    }
  }

  /**
   * Subscribe to mint quote payment status via WebSocket
   * Returns a canceller function to unsubscribe
   */
  async subscribeMintQuotePaid(
    mintUrl: string,
    quoteId: string,
    onPaid: (quote: MintQuoteBolt11Response) => void,
    onError?: (error: Error) => void
  ): Promise<SubscriptionCanceller | null> {
    try {
      const wallet = await this.getWallet(mintUrl)

      // Ensure WebSocket is connected
      if (!wallet.mint.webSocketConnection) {
        await wallet.mint.connectWebSocket()
      }

      // Subscribe to quote updates via wallet.on (WalletEvents)
      const canceller = await wallet.on.mintQuotePaid(
        quoteId,
        (quote: MintQuoteBolt11Response) => {
          console.log('[WebSocket] Mint quote paid:', quoteId)
          onPaid(quote)
        },
        (error: Error) => {
          console.error('[WebSocket] Mint quote subscription error:', error)
          onError?.(error)
        }
      )

      return canceller
    } catch (error) {
      console.warn('[WebSocket] Failed to subscribe to mint quote:', error)
      // Return null to indicate subscription failed - caller should fall back to polling
      return null
    }
  }

  /**
   * Subscribe to multiple mint quote updates via WebSocket
   */
  async subscribeMintQuoteUpdates(
    mintUrl: string,
    quoteIds: string[],
    onUpdate: (quote: MintQuoteBolt11Response) => void,
    onError?: (error: Error) => void
  ): Promise<SubscriptionCanceller | null> {
    try {
      const wallet = await this.getWallet(mintUrl)

      // Ensure WebSocket is connected
      if (!wallet.mint.webSocketConnection) {
        await wallet.mint.connectWebSocket()
      }

      // Subscribe to quote updates via wallet.on (WalletEvents)
      const canceller = await wallet.on.mintQuoteUpdates(
        quoteIds,
        (quote: MintQuoteBolt11Response) => {
          console.log('[WebSocket] Mint quote update:', quote.quote, quote.state)
          onUpdate(quote)
        },
        (error: Error) => {
          console.error('[WebSocket] Mint quote updates error:', error)
          onError?.(error)
        }
      )

      return canceller
    } catch (error) {
      console.warn('[WebSocket] Failed to subscribe to mint quote updates:', error)
      return null
    }
  }

  /**
   * Subscribe to proof state updates via WebSocket (NUT-17)
   * Returns a canceller function to unsubscribe, or null if WebSocket is not supported
   */
  async subscribeProofStateUpdates(
    mintUrl: string,
    proofs: Proof[],
    onSpent: (proof: Proof) => void,
    onError?: (error: Error) => void
  ): Promise<SubscriptionCanceller | null> {
    try {
      const wallet = await this.getWallet(mintUrl)

      // Check if mint supports WebSocket (NUT-17)
      const mintInfo = await wallet.mint.getInfo()
      const nut17 = (mintInfo as { nuts?: Record<string, unknown> }).nuts?.['17']
      if (!nut17) {
        console.log('[WebSocket] Mint does not support NUT-17 WebSocket')
        return null
      }

      // Ensure WebSocket is connected
      if (!wallet.mint.webSocketConnection) {
        await wallet.mint.connectWebSocket()
      }

      // Subscribe to proof state updates
      const canceller = await wallet.on.proofStateUpdates(
        proofs,
        (payload) => {
          console.log('[WebSocket] Proof state update:', payload.state)
          if (String(payload.state) === 'SPENT') {
            onSpent(payload.proof)
          }
        },
        (error: Error) => {
          console.error('[WebSocket] Proof state subscription error:', error)
          onError?.(error)
        }
      )

      return canceller
    } catch (error) {
      console.warn('[WebSocket] Failed to subscribe to proof state updates:', error)
      return null
    }
  }
}
