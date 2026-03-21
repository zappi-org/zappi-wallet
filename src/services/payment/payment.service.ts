import type { Proof, MintQuoteBolt11Response } from '@cashu/cashu-ts'
import { CashuService, type SubscriptionCanceller } from '@/services/cashu/cashu.service'
import { WalletService } from '@/services/wallet/wallet.service'
import { TransactionRepository } from '@/data/repositories/transaction.repository'
import { getDatabase, type PendingMeltRecord, type PendingSendTokenRecord } from '@/data/database/schema'
import { ok, err, type Result } from '@/core/types'
import type { MintQuote } from '@/core/types'
import type { BaseError } from '@/core/errors'
import { MintConnectionError, InsufficientBalanceError, classifyCashuError, InvalidInvoiceError, InvoiceExpiredError } from '@/core/errors'
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
  prepareMelt as cocoPrepareMelt,
  executeMelt as cocoExecuteMelt,
  rollbackMelt as cocoRollbackMelt,
  getBalances as cocoGetBalances,
  redeemMintQuote as cocoRedeemMintQuote,
  receiveToken as cocoReceiveToken,
} from '@/coco/cashuService'
import { getMintQuote as cocoGetMintQuote } from '@/coco/manager'
import { markQuoteAsSwap, unmarkQuoteAsSwap } from '@/coco/bridge'
import { recordLightningReceive } from '@/coco/mintQuoteObserver'
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

      // Coco already stores the quote internally via createMintQuote()
      // Transaction record is created later when payment is confirmed (in claimPayment)

      return ok({
        quote,
      })
    } catch (error) {
      console.error('createLightningInvoice error:', error)
      return err(classifyCashuError(error))
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
      return ok({
        proofs: [],
        amount: existingTx.amount,
        transactionId,
      })
    }

    this.claimInFlight.add(quoteId)
    try {
      // Fetch bolt11 from Coco's internal quote DB
      const cocoQuote = await cocoGetMintQuote(mintUrl, quoteId)
      const bolt11 = cocoQuote?.request

      // Redeem the quote using Coco (stores proofs automatically)
      // Coco manages proofs internally, so we get an empty array back
      await cocoRedeemMintQuote(mintUrl, quoteId, amount)

      // Transaction DB 기록 (idempotent — observer와 공유)
      await recordLightningReceive({ quoteId, mintUrl, amount, bolt11 })

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
      return err(classifyCashuError(error))
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
      return err(classifyCashuError(error))
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
          return err(new InvoiceExpiredError('Invoice has expired'))
        }

        invoiceAmount = decoded.amountSats
        if (invoiceAmount === 0) {
          // Zero-amount invoice - use the provided amount
          invoiceAmount = amount
        }
      } else {
        return err(new InvalidInvoiceError('Invalid Lightning Address or invoice'))
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

        let meltOp: Awaited<ReturnType<typeof cocoPrepareMelt>> | null = null
        try {
          // Prepare melt (2-phase: reserves proofs, creates quote)
          console.log('Preparing melt for invoice:', invoice.substring(0, 50) + '...')
          meltOp = await cocoPrepareMelt(targetMint, invoice)
          const totalNeeded = meltOp.amount + meltOp.fee_reserve + meltOp.swap_fee
          console.log(`Melt prepared: amount=${meltOp.amount}, fee_reserve=${meltOp.fee_reserve}, swap_fee=${meltOp.swap_fee}, total=${totalNeeded}`)

          // Check if this mint has enough balance
          if (available < totalNeeded) {
            const gap = totalNeeded - available
            console.log(`[sendLightning] Mint ${targetMint} insufficient: need ${totalNeeded}, have ${available}, gap ${gap}`)
            if (!bestAttempt || gap < bestAttempt.gap) {
              bestAttempt = { mint: targetMint, needed: totalNeeded, available, gap }
            }
            await cocoRollbackMelt(meltOp.operationId, 'insufficient balance')
            meltOp = null
            continue // Try next mint
          }

          // Save pending melt BEFORE execution (for crash recovery)
          await this.savePendingMelt({
            meltQuoteId: meltOp.quoteId,
            mintUrl: targetMint,
            amount: invoiceAmount,
            fee: meltOp.fee_reserve + meltOp.swap_fee,
            destination: addressOrInvoice,
            createdAt: Date.now(),
          })

          // Execute melt (2-phase: performs the Lightning payment)
          console.log('Executing melt...')
          await cocoExecuteMelt(meltOp.operationId)
          console.log('Melt completed successfully')

          // Use deterministic transaction ID based on melt quote
          const transactionId = `tx-melt-${meltOp.quoteId}`
          const actualFee = meltOp.fee_reserve + meltOp.swap_fee

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
          await this.removePendingMelt(meltOp.quoteId)

          return ok({
            paid: true,
            amount: invoiceAmount,
            fee: actualFee,
            mintUrl: targetMint,
            transactionId,
          })
        } catch (meltError) {
          console.error(`[sendLightning] Mint ${targetMint} melt failed:`, meltError)
          // Rollback to reclaim reserved proofs
          if (meltOp) {
            try {
              await cocoRollbackMelt(meltOp.operationId, 'melt failed')
            } catch (rollbackError) {
              console.error('[sendLightning] Rollback also failed:', rollbackError)
            }
            await this.removePendingMelt(meltOp.quoteId).catch(() => {})
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
      return err(classifyCashuError(error))
    }
  }

  /**
   * Estimate the Lightning fee for a cross-mint swap (non-destructive).
   * Creates mint quote + melt quote but does NOT pay.
   * Returns fee_reserve in sats, or throws on failure.
   */
  async estimateSwapFee(
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ): Promise<{ fee: number; totalNeeded: number }> {
    const mintQuote = await cocoCreateMintQuote(toMintUrl, amount)
    const meltOp = await cocoPrepareMelt(fromMintUrl, mintQuote.request)
    const fee = meltOp.fee_reserve + meltOp.swap_fee
    // Rollback immediately — this was just an estimate
    await cocoRollbackMelt(meltOp.operationId, 'fee estimation only').catch((err) => {
      console.error('[estimateSwapFee] Rollback failed:', err)
    })
    return {
      fee,
      totalNeeded: meltOp.amount + fee,
    }
  }

  /**
   * Swap tokens between mints via Lightning
   * Creates a mint quote on target mint, pays it from source mint via melt
   */
  async mintSwap(
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
    options?: { drain?: boolean }
  ): Promise<Result<MintSwapResult, BaseError>> {
    let mintQuote: Awaited<ReturnType<typeof cocoCreateMintQuote>> | undefined
    try {
      console.log(`[MintSwap] Starting swap: ${amount} sats from ${fromMintUrl} to ${toMintUrl}${options?.drain ? ' (drain mode)' : ''}`)

      // 1. Check source mint balance
      const balances = await cocoGetBalances()
      const sourceBalance = balances[fromMintUrl] || 0

      if (sourceBalance < amount) {
        return err(new InsufficientBalanceError(amount, sourceBalance))
      }

      // 2. Create mint quote on target + prepare melt on source (2-phase)
      let swapAmount = amount
      let meltOp: Awaited<ReturnType<typeof cocoPrepareMelt>>

      // First attempt with requested amount
      console.log('[MintSwap] Creating mint quote on target mint...')
      mintQuote = await cocoCreateMintQuote(toMintUrl, swapAmount)
      markQuoteAsSwap(mintQuote.quote)

      console.log('[MintSwap] Preparing melt on source mint...')
      meltOp = await cocoPrepareMelt(fromMintUrl, mintQuote.request)
      let totalNeeded = meltOp.amount + meltOp.fee_reserve + meltOp.swap_fee
      console.log(`[MintSwap] Melt prepared: amount=${meltOp.amount}, fee_reserve=${meltOp.fee_reserve}, swap_fee=${meltOp.swap_fee}, totalNeeded=${totalNeeded}, sourceBalance=${sourceBalance}`)

      // If balance insufficient and drain mode: rollback and retry with adjusted amount
      if (sourceBalance < totalNeeded && options?.drain) {
        const adjustedAmount = amount - meltOp.fee_reserve - meltOp.swap_fee
        if (adjustedAmount <= 0) {
          await cocoRollbackMelt(meltOp.operationId, 'drain: adjusted amount <= 0')
          unmarkQuoteAsSwap(mintQuote!.quote)
          return err(new InsufficientBalanceError(totalNeeded, sourceBalance))
        }
        console.log(`[MintSwap] Drain: fee exceeds balance, rolling back and retrying with ${adjustedAmount} sats`)
        await cocoRollbackMelt(meltOp.operationId, 'drain: retry with adjusted amount')
        swapAmount = adjustedAmount

        unmarkQuoteAsSwap(mintQuote.quote)
        mintQuote = await cocoCreateMintQuote(toMintUrl, swapAmount)
        markQuoteAsSwap(mintQuote.quote)
        meltOp = await cocoPrepareMelt(fromMintUrl, mintQuote.request)
        totalNeeded = meltOp.amount + meltOp.fee_reserve + meltOp.swap_fee
        console.log(`[MintSwap] Drain retry: amount=${meltOp.amount}, fee_reserve=${meltOp.fee_reserve}, swap_fee=${meltOp.swap_fee}, totalNeeded=${totalNeeded}`)
      }

      // Final balance check
      if (sourceBalance < totalNeeded) {
        console.log(`[MintSwap] Insufficient balance: need ${totalNeeded} but have ${sourceBalance}`)
        await cocoRollbackMelt(meltOp.operationId, 'insufficient balance')
        unmarkQuoteAsSwap(mintQuote!.quote)
        return err(new InsufficientBalanceError(totalNeeded, sourceBalance))
      }

      // 5. Coco already stores the mint quote internally via createMintQuote()

      // 6. Execute melt (2-phase: performs the Lightning payment)
      console.log('[MintSwap] Executing melt...')
      try {
        await cocoExecuteMelt(meltOp.operationId)
      } catch (meltError) {
        // Melt failed — rollback to reclaim reserved proofs
        try {
          await cocoRollbackMelt(meltOp.operationId, 'melt failed')
        } catch (rollbackError) {
          console.error('[MintSwap] Rollback also failed:', rollbackError)
        }
        throw meltError
      }

      // 7. Redeem mint quote on target mint (receive the tokens)
      // MintQuoteWatcher may have already redeemed this quote automatically,
      // so "already pending" or "already issued" errors are safe to ignore.
      console.log('[MintSwap] Redeeming mint quote on target mint...')
      try {
        await cocoRedeemMintQuote(toMintUrl, mintQuote.quote, swapAmount)
      } catch (redeemError) {
        const msg = String(redeemError).toLowerCase()
        if (msg.includes('already pending') || msg.includes('already issued') || msg.includes('already redeemed')) {
          console.log('[MintSwap] Quote already redeemed by MintQuoteWatcher, continuing')
        } else {
          throw redeemError
        }
      }

      // 8. Create transaction records (send from source + receive on target)
      const fee = meltOp.fee_reserve + meltOp.swap_fee
      const now = Date.now()
      const swapId = crypto.randomUUID()

      const transactionId = await this.transactionRepo.create({
        id: `tx-swap-send-${swapId}`,
        direction: 'send',
        type: 'swap',
        amount: swapAmount,
        mintUrl: fromMintUrl,
        status: 'completed',
        createdAt: now,
        completedAt: now,
        memo: `${swapAmount} sats`,
        metadata: {
          swapType: 'mint_swap',
          fromMintUrl,
          toMintUrl,
          fee,
        },
      })

      await this.transactionRepo.create({
        id: `tx-swap-recv-${swapId}`,
        direction: 'receive',
        type: 'swap',
        amount: swapAmount,
        mintUrl: toMintUrl,
        status: 'completed',
        createdAt: now,
        completedAt: now,
        memo: `${swapAmount} sats`,
        metadata: {
          swapType: 'mint_swap',
          fromMintUrl,
          toMintUrl,
        },
      })

      console.log(`[MintSwap] Swap completed successfully: ${swapAmount} sats`)

      return ok({
        success: true,
        amount: swapAmount,
        fee,
        fromMintUrl,
        toMintUrl,
        transactionId,
      })
    } catch (error) {
      console.error('mintSwap error:', error)
      if (mintQuote) unmarkQuoteAsSwap(mintQuote.quote)
      return err(classifyCashuError(error))
    }
  }

  /**
   * Calculate total amount from proofs
   */
  getTotalAmount(proofs: Proof[]): number {
    return proofs.reduce((sum, p) => sum + p.amount, 0)
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

  // ===== Pending Received Token Management (Offline P2PK Recovery) =====

  /**
   * Store a token accepted offline for later redemption
   */
  async storeOfflineToken(
    token: string,
    amount: number,
    mintUrl: string,
    dleqStatus: 'valid' | 'missing',
  ): Promise<string> {
    const db = getDatabase()
    const id = `pending-recv-${crypto.randomUUID()}`
    await db.pendingReceivedTokens.put({
      id,
      token,
      mintUrl,
      amount,
      dleqStatus,
      createdAt: Date.now(),
    })
    return id
  }

  /**
   * Redeem all pending received tokens (called on online recovery)
   * Returns count of successfully redeemed and failed tokens
   */
  async redeemPendingReceivedTokens(): Promise<{ redeemed: number; failed: number }> {
    const db = getDatabase()
    const pendingTokens = await db.pendingReceivedTokens.toArray()

    if (pendingTokens.length === 0) return { redeemed: 0, failed: 0 }

    const idsToDelete: string[] = []
    const results = await Promise.allSettled(
      pendingTokens.map(async (pending) => {
        const result = await this.receiveEcash(pending.token)
        if (result.isOk()) {
          idsToDelete.push(pending.id)
          console.log(`[OfflineRecovery] Redeemed token ${pending.id}: ${pending.amount} sats`)
          return true
        }
        // Token already spent or permanently unredeemable — remove it
        if (result.error.code === 'TOKEN_SPENT' || result.error.code === 'INVALID_TOKEN' || result.error.code === 'INVALID_PROOF') {
          idsToDelete.push(pending.id)
          console.warn(`[OfflineRecovery] Token ${pending.id} ${result.error.code}, removing`)
        } else {
          // Transient errors (network, mint down) — leave for next retry
          // But clean up old entries to prevent infinite retry
          const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
          if (Date.now() - pending.createdAt > MAX_AGE_MS) {
            idsToDelete.push(pending.id)
            console.warn(`[OfflineRecovery] Token ${pending.id} expired after 7 days, removing`)
          }
        }
        return false
      })
    )

    // Batch delete all processed tokens
    if (idsToDelete.length > 0) {
      await db.pendingReceivedTokens.bulkDelete(idsToDelete)
    }

    let redeemed = 0
    let failed = 0
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) redeemed++
      else failed++
    }

    return { redeemed, failed }
  }

  /**
   * Recover all pending operations (quotes, melts, send tokens, offline received tokens)
   * Should be called at app init, on visibility change, etc.
   */
  async recoverAll(): Promise<{
    quotes: { recovered: number; failed: number; expired: number }
    melts: { recovered: number; failed: number }
    sendTokens: { reclaimed: number; recorded: number }
    receivedTokens: { redeemed: number; failed: number }
  }> {
    const { recoverPendingQuotes, recoverPendingMelts, recoverPendingSendTokens } = await import('@/coco/cashuService')

    const [quotes, melts, sendTokens, receivedTokens] = await Promise.allSettled([
      recoverPendingQuotes(),
      recoverPendingMelts(),
      recoverPendingSendTokens(),
      this.redeemPendingReceivedTokens(),
    ])

    return {
      quotes: quotes.status === 'fulfilled' ? quotes.value : { recovered: 0, failed: 0, expired: 0 },
      melts: melts.status === 'fulfilled' ? melts.value : { recovered: 0, failed: 0 },
      sendTokens: sendTokens.status === 'fulfilled' ? sendTokens.value : { reclaimed: 0, recorded: 0 },
      receivedTokens: receivedTokens.status === 'fulfilled' ? receivedTokens.value : { redeemed: 0, failed: 0 },
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
    // Cross-cancellation: when one mechanism detects payment, stop the other immediately.
    let paidHandled = false
    let pollCanceller: SubscriptionCanceller | null = null
    let wsCanceller: SubscriptionCanceller | null = null

    const guardedOnPaid = (result: ClaimPaymentResult) => {
      if (paidHandled) return
      paidHandled = true
      // Stop both mechanisms immediately
      pollCanceller?.()
      wsCanceller?.()
      onPaid(result)
    }

    // 1. Start polling (reliable base)
    pollCanceller = this.pollQuoteStatus(mintUrl, quoteId, amount, guardedOnPaid, onError)

    // 2. Also try WebSocket for faster detection
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
      paidHandled = true // Prevent any late callbacks
      pollCanceller?.()
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
   * Disconnect all WebSocket connections
   */
  async disconnectAllWebSockets(): Promise<void> {
    const { getPendingMintQuotes } = await import('@/coco/manager')
    const pendingQuotes = await getPendingMintQuotes()
    const mintUrls = new Set(pendingQuotes.map((q) => q.mintUrl))

    for (const mintUrl of mintUrls) {
      await this.cashuService.disconnectWebSocket(mintUrl)
    }
  }
}
