import type { Proof, MintQuoteBolt11Response } from '@cashu/cashu-ts'
import { CashuService, type SubscriptionCanceller } from '@/services/cashu/cashu.service'
import { WalletService } from '@/services/wallet/wallet.service'
import { TransactionRepository } from '@/data/repositories/transaction.repository'
import { getDatabase, type PendingQuoteRecord, type PendingMeltRecord, type PendingSendTokenRecord } from '@/data/database/schema'
import { ok, err, type Result } from '@/core/types'
import type { MintQuote, PaymentRequest } from '@/core/types'
import type { BaseError } from '@/core/errors'
import { MintConnectionError, InsufficientBalanceError, MintError, classifyCashuError } from '@/core/errors'
import {
  isBolt11Invoice,
  decodeInvoice,
  isValidLightningAddress,
} from '@/services/lightning'
import {
  resolveLightningAddress,
  fetchLnurlPayInvoice,
} from '@/services/lnurl'
import {
  createMintQuote as cocoCreateMintQuote,
  createMeltQuote as cocoCreateMeltQuote,
  payMeltQuote as cocoPayMeltQuote,
  getBalances as cocoGetBalances,
  redeemMintQuote as cocoRedeemMintQuote,
  receiveToken as cocoReceiveToken,
} from '@/coco/cashuService'
import { getDecodedToken } from '@cashu/cashu-ts'

/**
 * Result of creating a Lightning invoice
 */
export interface CreateInvoiceResult {
  quote: MintQuote
}

/**
 * Result of claiming a payment
 */
export interface ClaimPaymentResult {
  proofs: Proof[]
  amount: number
  transactionId: string
}

/**
 * Result of receiving ecash
 */
export interface ReceiveEcashResult {
  proofs: Proof[]
  amount: number
  mintUrl: string
  transactionId: string
}

/**
 * Result of sending Lightning payment
 */
export interface SendLightningResult {
  paid: boolean
  amount: number
  fee: number
  mintUrl: string
  preimage?: string
  transactionId: string
}

/**
 * Result of mint swap
 */
export interface MintSwapResult {
  success: boolean
  amount: number
  fee: number
  fromMintUrl: string
  toMintUrl: string
  transactionId: string
}

/**
 * Service for payment operations (receive Lightning, receive Ecash)
 */
export class PaymentService {
  private cashuService: CashuService
  private walletService: WalletService
  private transactionRepo: TransactionRepository
  private claimInFlight = new Set<string>() // Prevent concurrent claimPayment calls

  constructor() {
    this.cashuService = new CashuService()
    this.walletService = new WalletService()
    this.transactionRepo = new TransactionRepository()
  }

  /**
   * Create a Lightning invoice for receiving payment
   */
  async createLightningInvoice(
    amount: number,
    mintUrl?: string
  ): Promise<Result<CreateInvoiceResult, BaseError>> {
    // Use provided mint or get first available
    let targetMint = mintUrl
    if (!targetMint) {
      const mints = await this.walletService.getMints()
      if (mints.length === 0) {
        return err(new MintConnectionError('No mints configured'))
      }
      targetMint = mints[0]
    }

    // Create mint quote via Coco (stores quote internally for later redemption)
    try {
      const cocoQuote = await cocoCreateMintQuote(targetMint, amount)
      const quoteId = cocoQuote.quote
      const request = cocoQuote.request
      const expiry = cocoQuote.expiry // Unix timestamp (seconds)

      // Build quote object for return
      const quote: MintQuote = {
        quoteId,
        mintUrl: targetMint,
        amount,
        request,
        state: 'UNPAID',
        expiry,
      }

      // Save pending quote for recovery with expiry (convert to ms)
      // Transaction record is created later when payment is confirmed (in claimPayment)
      await this.savePendingQuote(
        quoteId,
        targetMint,
        amount,
        request,
        expiry * 1000 // Convert seconds to milliseconds
      )

      return ok({
        quote,
      })
    } catch (error) {
      console.error('createLightningInvoice error:', error)
      return err(new MintConnectionError(error instanceof Error ? error.message : 'Failed to create invoice'))
    }
  }

  /**
   * Check if a payment has been received
   */
  async checkPaymentStatus(mintUrl: string, quoteId: string): Promise<boolean> {
    const state = await this.cashuService.checkMintQuote(mintUrl, quoteId)
    return state === 'PAID'
  }

  /**
   * Claim tokens after payment and store them
   * Uses Coco for redemption and storage to maintain single source of truth
   * This function is idempotent - calling it multiple times for the same quote is safe
   */
  async claimPayment(
    mintUrl: string,
    quoteId: string,
    amount: number
  ): Promise<Result<ClaimPaymentResult, BaseError>> {
    const transactionId = `tx-${quoteId}`

    // Prevent concurrent calls for the same quote
    if (this.claimInFlight.has(quoteId)) {
      console.log('[claimPayment] Already in progress:', quoteId)
      return err(new MintConnectionError('Claim already in progress'))
    }

    // Check if already claimed (idempotency check)
    const existingTx = await this.transactionRepo.findById(transactionId)
    if (existingTx && existingTx.status === 'completed') {
      console.log('[claimPayment] Quote already claimed:', quoteId)
      await this.removePendingQuote(quoteId)
      return ok({
        proofs: [],
        amount: existingTx.amount,
        transactionId,
      })
    }

    this.claimInFlight.add(quoteId)
    try {
      // Fetch bolt11 from pending quote before redeeming
      const db = getDatabase()
      const pendingQuote = await db.pendingQuotes.get(quoteId)
      const bolt11 = pendingQuote?.invoice

      // Redeem the quote using Coco (stores proofs automatically)
      // Coco manages proofs internally, so we get an empty array back
      await cocoRedeemMintQuote(mintUrl, quoteId, amount)

      // Create or update transaction as completed
      // (handles both new flow where no pending tx exists, and old flow where it might)
      if (existingTx) {
        await this.transactionRepo.update(transactionId, {
          status: 'completed',
          completedAt: Date.now(),
          ...(bolt11 && !existingTx.bolt11 ? { bolt11 } : {}),
        })
      } else {
        await this.transactionRepo.create({
          id: transactionId,
          direction: 'receive',
          type: 'lightning',
          amount,
          mintUrl,
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
          bolt11,
          metadata: { quoteId },
        })
      }

      // Remove pending quote
      await this.removePendingQuote(quoteId)

      return ok({
        proofs: [], // Coco manages proofs internally
        amount,     // Use the expected amount (Coco stores the actual proofs)
        transactionId,
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      // "Quote not found" usually means it was already redeemed
      // Check if transaction is completed - if so, treat as success
      if (errorMsg.includes('Quote not found') || errorMsg.includes('quote not found')) {
        const tx = await this.transactionRepo.findById(transactionId)
        if (tx && tx.status === 'completed') {
          console.log('[claimPayment] Quote already redeemed (race condition):', quoteId)
          return ok({
            proofs: [],
            amount: tx.amount,
            transactionId,
          })
        }
      }

      console.error('claimPayment error:', error)
      return err(new MintConnectionError(error instanceof Error ? error.message : 'Failed to claim payment'))
    } finally {
      this.claimInFlight.delete(quoteId)
    }
  }

  /**
   * Receive an ecash token and store proofs
   * Uses Coco for storage to maintain single source of truth with balance
   */
  async receiveEcash(
    token: string,
    options?: { privkey?: string }
  ): Promise<Result<ReceiveEcashResult, BaseError>> {
    try {
      // Decode token to get mint URL and amount
      const decoded = getDecodedToken(token)
      const mintUrl = decoded.mint
      const proofs = decoded.proofs
      const amount = proofs.reduce((sum, p) => sum + p.amount, 0)

      // If P2PK token with privkey, use cashu-ts to unlock first
      if (options?.privkey) {
        // For P2PK tokens, use cashuService to unlock then re-encode for Coco
        const receiveResult = await this.cashuService.receiveToken(token, options)
        if (receiveResult.isErr()) {
          return err(receiveResult.error)
        }
        // Re-encode the unlocked proofs and store via Coco
        const unlockedProofs = receiveResult.value.proofs
        const { getEncodedToken } = await import('@cashu/cashu-ts')
        const unlockedToken = getEncodedToken({ mint: mintUrl, proofs: unlockedProofs })
        await cocoReceiveToken(unlockedToken)
      } else {
        // Regular token - store directly via Coco (single source of truth)
        await cocoReceiveToken(token)
      }

      // Create transaction record (store original token for reference)
      const transactionId = await this.transactionRepo.create({
        id: `tx-ecash-${crypto.randomUUID()}`,
        direction: 'receive',
        type: 'ecash',
        amount,
        mintUrl,
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
        token,
      })

      return ok({
        proofs: [], // Coco manages proofs internally
        amount,
        mintUrl,
        transactionId,
      })
    } catch (error) {
      console.error('receiveEcash error:', error)
      return err(new MintConnectionError(error instanceof Error ? error.message : 'Failed to receive ecash'))
    }
  }

  /**
   * Send Lightning payment (melt tokens)
   * Supports both Lightning Address (user@domain.com) and bolt11 invoice
   * Uses Coco system for proof management
   * Automatically tries mints with balance and selects one with sufficient funds
   */
  async sendLightning(
    addressOrInvoice: string,
    amount: number,
    mintUrl?: string
  ): Promise<Result<SendLightningResult, BaseError>> {
    let invoice: string
    let invoiceAmount: number

    try {
      // Determine if it's a Lightning Address or bolt11 invoice
      if (isValidLightningAddress(addressOrInvoice)) {
        // Resolve Lightning Address to invoice
        console.log('Resolving Lightning Address:', addressOrInvoice)
        const lnurlParams = await resolveLightningAddress(addressOrInvoice)
        const lnurlResult = await fetchLnurlPayInvoice(lnurlParams, amount)
        invoice = lnurlResult.pr
        invoiceAmount = amount
      } else if (isBolt11Invoice(addressOrInvoice)) {
        // It's a bolt11 invoice
        invoice = addressOrInvoice
        const decoded = decodeInvoice(invoice)

        if (decoded.isExpired) {
          return err(new MintConnectionError('Invoice has expired'))
        }

        invoiceAmount = decoded.amountSats
        if (invoiceAmount === 0) {
          // Zero-amount invoice - use the provided amount
          invoiceAmount = amount
        }
      } else {
        return err(new MintConnectionError('Invalid Lightning Address or invoice'))
      }

      // Get all balances from Coco
      const cocoBalances = await cocoGetBalances()

      // Build list of mints to try
      let mintsToTry: string[]
      if (mintUrl) {
        // User specified a mint
        mintsToTry = [mintUrl]
      } else {
        // Smart mint selection: find the smallest balance that can cover the payment
        // This preserves larger balances for bigger payments
        const mintsWithBalance = Object.entries(cocoBalances)
          .filter(([, balance]) => balance > 0)

        // First, try mints that have at least the invoice amount (likely candidates)
        // Sort by balance ascending (smallest first) - best-fit algorithm
        const sufficientMints = mintsWithBalance
          .filter(([, balance]) => balance >= invoiceAmount)
          .sort(([, a], [, b]) => a - b)
          .map(([mint]) => mint)

        // Then, add remaining mints sorted by balance descending (for error reporting)
        const insufficientMints = mintsWithBalance
          .filter(([, balance]) => balance < invoiceAmount)
          .sort(([, a], [, b]) => b - a)
          .map(([mint]) => mint)

        mintsToTry = [...sufficientMints, ...insufficientMints]
      }

      if (mintsToTry.length === 0) {
        return err(new InsufficientBalanceError(invoiceAmount, 0))
      }

      // Try each mint until we find one with sufficient balance
      // Track the best attempt (smallest gap between needed and available)
      let bestAttempt: { mint: string; needed: number; available: number; gap: number } | null = null

      for (const targetMint of mintsToTry) {
        const available = cocoBalances[targetMint] || 0
        console.log(`[sendLightning] Trying mint ${targetMint} with balance ${available} sats`)

        let meltQuoteId: string | null = null
        try {
          // Create melt quote to get exact fee
          console.log('Creating melt quote for invoice:', invoice.substring(0, 50) + '...')
          const meltQuote = await cocoCreateMeltQuote(targetMint, invoice)
          meltQuoteId = meltQuote.quote
          const totalNeeded = meltQuote.amount + meltQuote.fee_reserve
          console.log(`Melt quote: amount=${meltQuote.amount}, fee=${meltQuote.fee_reserve}, total=${totalNeeded}`)

          // Check if this mint has enough balance
          if (available < totalNeeded) {
            const gap = totalNeeded - available
            console.log(`[sendLightning] Mint ${targetMint} insufficient: need ${totalNeeded}, have ${available}, gap ${gap}`)
            if (!bestAttempt || gap < bestAttempt.gap) {
              bestAttempt = { mint: targetMint, needed: totalNeeded, available, gap }
            }
            continue // Try next mint
          }

          // Save pending melt BEFORE payment (for crash recovery)
          await this.savePendingMelt({
            meltQuoteId: meltQuote.quote,
            mintUrl: targetMint,
            amount: invoiceAmount,
            fee: meltQuote.fee_reserve,
            destination: addressOrInvoice,
            createdAt: Date.now(),
          })

          // Execute melt using Coco (handles proof selection internally)
          console.log('Executing melt via Coco...')
          await cocoPayMeltQuote(targetMint, meltQuote.quote)
          console.log('Melt completed successfully')

          // Use deterministic transaction ID based on melt quote
          const transactionId = `tx-melt-${meltQuote.quote}`
          const actualFee = meltQuote.fee_reserve

          // Create transaction record
          await this.transactionRepo.create({
            id: transactionId,
            direction: 'send',
            type: 'lightning',
            amount: invoiceAmount,
            mintUrl: targetMint,
            status: 'completed',
            createdAt: Date.now(),
            completedAt: Date.now(),
            bolt11: invoice,
            metadata: {
              fee: actualFee,
              destination: addressOrInvoice,
            },
          })

          // Clean up pending melt
          await this.removePendingMelt(meltQuote.quote)

          return ok({
            paid: true,
            amount: invoiceAmount,
            fee: actualFee,
            mintUrl: targetMint,
            transactionId,
          })
        } catch (meltError) {
          console.error(`[sendLightning] Mint ${targetMint} melt failed:`, meltError)
          // Clean up pending melt on explicit failure (payment wasn't sent)
          if (meltQuoteId) {
            await this.removePendingMelt(meltQuoteId).catch(() => {})
          }
          // Continue to try next mint
        }
      }

      // All mints failed - show detailed error
      if (bestAttempt) {
        const mintHostname = new URL(bestAttempt.mint).hostname
        console.error(
          `[sendLightning] All mints insufficient. Best attempt: ${mintHostname} needs ${bestAttempt.needed} (amount + fee), has ${bestAttempt.available}, gap: ${bestAttempt.gap}`
        )
        // Return error with the best mint's required amount vs its available balance
        // This gives a clearer picture of why it failed
        return err(new InsufficientBalanceError(bestAttempt.needed, bestAttempt.available))
      }

      return err(new MintConnectionError('No mint available for payment'))
    } catch (error) {
      console.error('sendLightning error:', error)
      return err(new MintConnectionError(error instanceof Error ? error.message : 'Lightning payment failed'))
    }
  }

  /**
   * Swap tokens between mints via Lightning
   * Creates a mint quote on target mint, pays it from source mint via melt
   */
  async mintSwap(
    fromMintUrl: string,
    toMintUrl: string,
    amount: number
  ): Promise<Result<MintSwapResult, BaseError>> {
    try {
      console.log(`[MintSwap] Starting swap: ${amount} sats from ${fromMintUrl} to ${toMintUrl}`)

      // 1. Check source mint balance
      const balances = await cocoGetBalances()
      const sourceBalance = balances[fromMintUrl] || 0

      if (sourceBalance < amount) {
        return err(new InsufficientBalanceError(amount, sourceBalance))
      }

      // 2. Create mint quote on target mint (generates Lightning invoice)
      console.log('[MintSwap] Creating mint quote on target mint...')
      const mintQuote = await cocoCreateMintQuote(toMintUrl, amount)
      const invoice = mintQuote.request

      // 3. Create melt quote on source mint for that invoice
      console.log('[MintSwap] Creating melt quote on source mint...')
      const meltQuote = await cocoCreateMeltQuote(fromMintUrl, invoice)
      const totalNeeded = meltQuote.amount + meltQuote.fee_reserve
      console.log(`[MintSwap] Melt quote created: amount=${meltQuote.amount}, fee_reserve=${meltQuote.fee_reserve}, totalNeeded=${totalNeeded}, sourceBalance=${sourceBalance}`)

      // 4. Verify sufficient balance including fee
      if (sourceBalance < totalNeeded) {
        console.log(`[MintSwap] Insufficient balance: need ${totalNeeded} but have ${sourceBalance}`)
        return err(new InsufficientBalanceError(totalNeeded, sourceBalance))
      }

      // 5. Save pending quote BEFORE melt (for crash recovery)
      // If crash after melt but before redeem, recoverPendingQuotes will pick this up
      // If melt fails, we clean up in the catch block below
      await this.savePendingQuote(
        mintQuote.quote,
        toMintUrl,
        amount,
        mintQuote.request,
        mintQuote.expiry ? mintQuote.expiry * 1000 : undefined
      )

      // 6. Execute melt (pay the invoice from source mint)
      console.log('[MintSwap] Paying invoice via melt...')
      try {
        await cocoPayMeltQuote(fromMintUrl, meltQuote.quote)
      } catch (meltError) {
        // Melt failed explicitly — invoice was NOT paid, clean up pending quote
        await this.removePendingQuote(mintQuote.quote).catch(() => {})
        throw meltError
      }

      // 7. Redeem mint quote on target mint (receive the tokens)
      console.log('[MintSwap] Redeeming mint quote on target mint...')
      await cocoRedeemMintQuote(toMintUrl, mintQuote.quote, amount)

      // 7.5. Remove pending quote (redeem succeeded)
      await this.removePendingQuote(mintQuote.quote)

      // 8. Create transaction record
      const transactionId = await this.transactionRepo.create({
        id: `tx-swap-${crypto.randomUUID()}`,
        direction: 'send',
        type: 'swap',
        amount, // The amount swapped
        mintUrl: fromMintUrl,
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
        memo: `${amount} sats`,
        metadata: {
          swapType: 'mint_swap',
          fromMintUrl,
          toMintUrl,
          fee: meltQuote.fee_reserve,
        },
      })

      console.log(`[MintSwap] Swap completed successfully: ${amount} sats`)

      return ok({
        success: true,
        amount,
        fee: meltQuote.fee_reserve,
        fromMintUrl,
        toMintUrl,
        transactionId,
      })
    } catch (error) {
      console.error('mintSwap error:', error)
      // Classify the error for better user feedback
      if (error instanceof Error) {
        const classified = classifyCashuError(error)
        return err(classified)
      }
      return err(new MintError(fromMintUrl, undefined, 'Mint swap failed', error))
    }
  }

  /**
   * Create a NUT-18 payment request for receiving ecash
   */
  async createPaymentRequest(
    amount: number,
    mintUrl: string,
    p2pkPubkey?: string
  ): Promise<Result<PaymentRequest, BaseError>> {
    const id = crypto.randomUUID()

    // Build the payment request
    const paymentRequest: PaymentRequest = {
      id,
      amount,
      unit: 'sat',
      mints: [mintUrl],
      singleUse: true,
      p2pkPubkey,
      encoded: this.encodePaymentRequest({
        id,
        amount,
        unit: 'sat',
        mints: [mintUrl],
        p2pkPubkey,
      }),
    }

    return ok(paymentRequest)
  }

  /**
   * Encode a payment request to creqA... format
   */
  private encodePaymentRequest(request: {
    id: string
    amount: number
    unit: string
    mints: string[]
    p2pkPubkey?: string
  }): string {
    // NUT-18 payment request format
    const data: Record<string, unknown> = {
      i: request.id,
      a: request.amount,
      u: request.unit,
      m: request.mints,
      s: true, // singleUse
    }

    if (request.p2pkPubkey) {
      data.t = { kind: 'P2PK', data: request.p2pkPubkey }
    }

    // Base64url encode
    const json = JSON.stringify(data)
    const base64 = btoa(json)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    return `creqA${base64}`
  }

  /**
   * Calculate total amount from proofs
   */
  getTotalAmount(proofs: Proof[]): number {
    return proofs.reduce((sum, p) => sum + p.amount, 0)
  }

  /**
   * Save a pending quote to the database
   */
  async savePendingQuote(
    quoteId: string,
    mintUrl: string,
    amount: number,
    invoice: string,
    expiresAt?: number
  ): Promise<void> {
    const db = getDatabase()
    await db.pendingQuotes.put({
      quoteId,
      mintUrl,
      amount,
      invoice,
      createdAt: Date.now(),
      expiresAt,
    })
  }

  /**
   * Remove a pending quote from the database
   */
  async removePendingQuote(quoteId: string): Promise<void> {
    const db = getDatabase()
    await db.pendingQuotes.delete(quoteId)
  }

  /**
   * Clean up a leftover pending transaction (from old code that created them at invoice time)
   * Only deletes if the transaction exists and is still 'pending'
   */
  private async cleanupPendingTransaction(transactionId: string): Promise<void> {
    const tx = await this.transactionRepo.findById(transactionId)
    if (tx && tx.status === 'pending') {
      await this.transactionRepo.delete(transactionId)
    }
  }

  // ===== Pending Melt Management (Lightning Send Recovery) =====

  /**
   * Save a pending melt to the database (before Lightning send payment)
   */
  async savePendingMelt(record: PendingMeltRecord): Promise<void> {
    const db = getDatabase()
    await db.pendingMelts.put(record)
  }

  /**
   * Remove a pending melt from the database
   */
  async removePendingMelt(meltQuoteId: string): Promise<void> {
    const db = getDatabase()
    await db.pendingMelts.delete(meltQuoteId)
  }

  // ===== Pending Send Token Management (Ecash Send Recovery) =====

  /**
   * Save a pending send token to the database (after ecash token creation)
   */
  async savePendingSendToken(record: PendingSendTokenRecord): Promise<void> {
    const db = getDatabase()
    await db.pendingSendTokens.put(record)
  }

  /**
   * Remove a pending send token from the database
   */
  async removePendingSendToken(id: string): Promise<void> {
    const db = getDatabase()
    await db.pendingSendTokens.delete(id)
  }

  /**
   * Get all pending quotes (for recovery)
   */
  async getPendingQuotes(): Promise<PendingQuoteRecord[]> {
    const db = getDatabase()
    return db.pendingQuotes.toArray()
  }

  /**
   * Try to recover pending quotes - check and claim any that are paid
   */
  async recoverPendingQuotes(): Promise<{
    recovered: number
    failed: number
    expired: number
  }> {
    const pendingQuotes = await this.getPendingQuotes()
    let recovered = 0
    let failed = 0
    let expired = 0

    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours max age

    for (const quote of pendingQuotes) {
      const transactionId = `tx-${quote.quoteId}`

      // Check if quote has expired
      if (quote.expiresAt && quote.expiresAt < now) {
        await this.removePendingQuote(quote.quoteId)
        // Clean up any leftover pending transaction from old code
        await this.cleanupPendingTransaction(transactionId)
        expired++
        continue
      }

      // Remove quotes older than 24 hours (even without expiry)
      if (!quote.expiresAt && quote.createdAt && (now - quote.createdAt) > maxAge) {
        await this.removePendingQuote(quote.quoteId)
        // Clean up any leftover pending transaction from old code
        await this.cleanupPendingTransaction(transactionId)
        expired++
        continue
      }

      try {
        // Check if payment was received
        const isPaid = await this.checkPaymentStatus(quote.mintUrl, quote.quoteId)
        if (isPaid) {
          // Claim the tokens (also creates completed transaction)
          const result = await this.claimPayment(quote.mintUrl, quote.quoteId, quote.amount)
          if (result.isOk()) {
            await this.removePendingQuote(quote.quoteId)
            recovered++
          } else {
            failed++
          }
        }
      } catch {
        // Quote might have expired or mint is unreachable
        failed++
      }
    }

    return { recovered, failed, expired }
  }

  /**
   * Recover all pending operations (quotes, melts, send tokens)
   * Should be called at app init, on visibility change, etc.
   */
  async recoverAll(): Promise<{
    quotes: { recovered: number; failed: number; expired: number }
    melts: { recovered: number; failed: number }
    sendTokens: { reclaimed: number; recorded: number }
  }> {
    const { recoverPendingMelts, recoverPendingSendTokens } = await import('@/coco/cashuService')

    const [quotes, melts, sendTokens] = await Promise.allSettled([
      this.recoverPendingQuotes(),
      recoverPendingMelts(),
      recoverPendingSendTokens(),
    ])

    return {
      quotes: quotes.status === 'fulfilled' ? quotes.value : { recovered: 0, failed: 0, expired: 0 },
      melts: melts.status === 'fulfilled' ? melts.value : { recovered: 0, failed: 0 },
      sendTokens: sendTokens.status === 'fulfilled' ? sendTokens.value : { reclaimed: 0, recorded: 0 },
    }
  }

  // ===== WebSocket Subscription Methods =====

  /**
   * Subscribe to a specific mint quote payment status.
   * Uses polling as the reliable base, and also tries WebSocket (NUT-17) for faster detection.
   * Both run simultaneously (same pattern as cashu.me).
   */
  async subscribeToQuote(
    mintUrl: string,
    quoteId: string,
    amount: number,
    onPaid: (result: ClaimPaymentResult) => void,
    onError?: (error: Error) => void
  ): Promise<SubscriptionCanceller> {
    // Guard: prevent double-firing onPaid when both WS and polling detect payment.
    // No explicit cross-cancellation — claimPayment is idempotent (checks existing tx),
    // polling stops itself after successful claim (return), WS cleaned up on unmount.
    // Same approach as cashu.me: let both run, rely on server-side idempotency.
    let paidHandled = false
    const guardedOnPaid = (result: ClaimPaymentResult) => {
      if (paidHandled) return
      paidHandled = true
      onPaid(result)
    }

    // 1. Start polling first (reliable base)
    const pollCanceller = this.pollQuoteStatus(mintUrl, quoteId, amount, guardedOnPaid, onError)

    // 2. Also try WebSocket for faster detection
    let wsCanceller: SubscriptionCanceller | null = null
    try {
      wsCanceller = await this.cashuService.subscribeMintQuotePaid(
        mintUrl,
        quoteId,
        async (quote: MintQuoteBolt11Response) => {
          if (quote.state === 'PAID') {
            try {
              const result = await this.claimPayment(mintUrl, quoteId, amount)
              if (result.isOk()) {
                guardedOnPaid(result.value)
              }
            } catch (e) {
              // Polling will pick it up
              console.error('[WS] Claim failed, polling will retry:', e)
            }
          }
        },
        (error) => {
          console.warn('[WS] Subscription error (polling still active):', error)
        }
      )
      if (wsCanceller) {
        console.log('[Payment] WebSocket + polling active for quote:', quoteId)
      }
    } catch {
      // WebSocket failed to set up — polling is already running
    }

    // Return combined canceller (for screen unmount / effect cleanup)
    return () => {
      pollCanceller()
      wsCanceller?.()
    }
  }

  /**
   * Poll quote status as fallback when WebSocket is not available
   */
  private pollQuoteStatus(
    mintUrl: string,
    quoteId: string,
    amount: number,
    onPaid: (result: ClaimPaymentResult) => void,
    onError?: (error: Error) => void,
    intervalMs: number = 2000
  ): SubscriptionCanceller {
    let cancelled = false
    const startTime = Date.now()
    const maxDuration = 60 * 60 * 1000 // 1 hour max polling duration

    const poll = async () => {
      if (cancelled) return

      // Self-timeout: stop polling after maxDuration
      if (Date.now() - startTime > maxDuration) {
        console.log(`[Polling] Stopping poll for quote ${quoteId} after max duration`)
        return
      }

      try {
        const isPaid = await this.checkPaymentStatus(mintUrl, quoteId)
        if (isPaid) {
          const result = await this.claimPayment(mintUrl, quoteId, amount)
          if (result.isOk()) {
            onPaid(result.value)
            return // Stop polling after successful claim
          }
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e)

        // "quote not found" = quote was already redeemed (by Coco) or doesn't exist.
        // This is a terminal state, not transient — stop polling.
        if (errorMsg.toLowerCase().includes('quote not found')) {
          // Try claimPayment directly — Coco may have already redeemed it
          try {
            const result = await this.claimPayment(mintUrl, quoteId, amount)
            if (result.isOk()) {
              onPaid(result.value)
            }
          } catch {
            // claimPayment also failed — quote is truly gone
          }
          return // Stop polling regardless
        }

        console.error('[Polling] Error checking quote status:', e)
        onError?.(e instanceof Error ? e : new Error('Unknown error'))
        // Don't stop polling on transient errors
      }

      // Continue polling
      if (!cancelled) {
        setTimeout(poll, intervalMs)
      }
    }

    // Start polling
    poll()

    // Return canceller function
    return () => {
      cancelled = true
    }
  }

  /**
   * Subscribe to all pending quotes.
   * Uses polling as the reliable base, and also tries WebSocket (NUT-17) for faster detection.
   * Both run simultaneously per quote (same pattern as cashu.me).
   */
  async subscribeToPendingQuotes(
    onPaymentReceived: (mintUrl: string, quoteId: string, amount: number) => void,
    onError?: (error: Error) => void
  ): Promise<SubscriptionCanceller> {
    const pendingQuotes = await this.getPendingQuotes()
    const cancellers: SubscriptionCanceller[] = []

    // Group quotes by mint URL
    const quotesByMint = new Map<string, PendingQuoteRecord[]>()
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours max age for quotes without expiry

    for (const quote of pendingQuotes) {
      // Skip and remove expired quotes
      if (quote.expiresAt && quote.expiresAt < now) {
        console.log('[Payment] Removing expired quote:', quote.quoteId)
        await this.removePendingQuote(quote.quoteId)
        continue
      }

      // Skip and remove quotes older than 24 hours (even without expiry)
      if (!quote.expiresAt && quote.createdAt && (now - quote.createdAt) > maxAge) {
        console.log('[Payment] Removing old quote (>24h):', quote.quoteId)
        await this.removePendingQuote(quote.quoteId)
        continue
      }

      const existing = quotesByMint.get(quote.mintUrl) || []
      existing.push(quote)
      quotesByMint.set(quote.mintUrl, existing)
    }

    // Per-quote guard to prevent double-firing onPaymentReceived.
    // No explicit cross-cancellation — same approach as cashu.me.
    const handledQuotes = new Set<string>()
    const guardedOnPaymentReceived = (mintUrl: string, quoteId: string, amount: number) => {
      if (handledQuotes.has(quoteId)) return
      handledQuotes.add(quoteId)
      onPaymentReceived(mintUrl, quoteId, amount)
    }

    // Subscribe to each mint's quotes
    for (const [mintUrl, quotes] of quotesByMint.entries()) {
      const quoteIds = quotes.map((q) => q.quoteId)
      const amountMap = new Map(quotes.map((q) => [q.quoteId, q.amount]))

      // 1. Start polling first for each quote (reliable base)
      for (const quote of quotes) {
        const pollCanceller = this.pollQuoteStatus(
          mintUrl,
          quote.quoteId,
          quote.amount,
          () => guardedOnPaymentReceived(mintUrl, quote.quoteId, quote.amount),
          onError,
          10000 // Longer interval for background polling
        )
        cancellers.push(pollCanceller)
      }

      // 2. Also try WebSocket for faster detection
      try {
        const wsCanceller = await this.cashuService.subscribeMintQuoteUpdates(
          mintUrl,
          quoteIds,
          async (quote: MintQuoteBolt11Response) => {
            if (quote.state === 'PAID') {
              const amount = amountMap.get(quote.quote)
              if (amount !== undefined) {
                try {
                  const result = await this.claimPayment(mintUrl, quote.quote, amount)
                  if (result.isOk()) {
                    guardedOnPaymentReceived(mintUrl, quote.quote, amount)
                  }
                } catch (e) {
                  // Polling will pick it up
                  console.error('[WS] Claim failed, polling will retry:', e)
                }
              }
            }
          },
          (error) => {
            console.warn('[WS] Pending quotes subscription error (polling still active):', error)
          }
        )
        if (wsCanceller) {
          cancellers.push(wsCanceller)
        }
      } catch {
        // WebSocket failed — polling is already running for each quote
      }
    }

    // Return combined canceller
    return () => {
      for (const cancel of cancellers) {
        cancel()
      }
    }
  }

  /**
   * Disconnect all WebSocket connections
   */
  async disconnectAllWebSockets(): Promise<void> {
    const pendingQuotes = await this.getPendingQuotes()
    const mintUrls = new Set(pendingQuotes.map((q) => q.mintUrl))

    for (const mintUrl of mintUrls) {
      await this.cashuService.disconnectWebSocket(mintUrl)
    }
  }
}
