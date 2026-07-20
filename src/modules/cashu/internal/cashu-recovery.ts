/**
 * Cashu Recovery — built on the PendingOperationRepository + TransactionRepository ports.
 *
 * No direct DB/legacy access; SDK calls go through injected interfaces.
 */

import { mintUrlKey } from '@/utils/url'
import { toNumber } from '@/core/domain/amount'
import { isExpired as isPendingOperationExpired, type PendingOperation } from '@/core/domain/pending-operation'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { ReconcileReport } from '@/core/ports/driving/recovery-scheduler.usecase'
import { mintAndReceive } from './cashu-backend'
import { abandonMintQuote, getCocoManager } from './coco-sdk'
import { cocoLogger as logger } from './logger'

// ─── SDK interfaces (for DI — no direct Coco dependency) ───

export interface MeltRecoveryOps {
  listInFlight(): Promise<{ id: string; createdAt?: number }[]>
  refresh(id: string): Promise<{ state: string }>
  reclaim(id: string, reason: string): Promise<void>
}

export interface SendRecoveryOps {
  runRecovery(): Promise<void>
  get(operationId: string): Promise<{ state: string } | null>
}

export interface QuoteRecoveryOps {
  checkMintQuote(quoteId: string, mintUrl: string): Promise<{ state: string }>
  mintAndReceive(quoteId: string, mintUrl: string, amount: number): Promise<void>
}

export interface RecoverTokenFn {
  (token: string): Promise<{ amount: number }>
}

/** Look up mint op state from Coco's local repo (network 0) — reconcile-only */
export interface MintOpLookup {
  (mintUrl: string, quoteId: string): Promise<{ state: string } | null>
}

// ─── Recovery deps ───

export interface CashuRecoveryDeps {
  pendingOpRepo: PendingOperationRepository
  txRepo: TransactionRepository
  meltOps: MeltRecoveryOps
  sendOps: SendRecoveryOps
  quoteOps: QuoteRecoveryOps
  receiveToken: RecoverTokenFn
  activeMintUrls?: string[]
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000

// ─── Melt Recovery ───

export async function recoverPendingMelts(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'meltOps'>,
): Promise<{ recovered: number; failed: number }> {
  const { pendingOpRepo, meltOps } = deps
  let recovered = 0
  let failed = 0
  const now = Date.now()

  // 1. SDK recovery
  try {
    const pendingOps = await meltOps.listInFlight()
    logger.info(`[Recovery] Found ${pendingOps.length} pending melt operations`)

    for (const op of pendingOps) {
      try {
        const refreshed = await meltOps.refresh(op.id)
        if (refreshed.state === 'finalized' || refreshed.state === 'rolled_back') {
          recovered++
        } else if (refreshed.state === 'failed') {
          await meltOps.reclaim(op.id, 'recovery: payment failed')
          recovered++
        } else if (op.createdAt && (now - op.createdAt) > MAX_AGE_MS) {
          await meltOps.reclaim(op.id, 'recovery: expired')
          failed++
        }
      } catch (error) {
        logger.error(`[Recovery] Failed to recover melt operation ${op.id}:`, error as Error)
        failed++
      }
    }
  } catch (error) {
    logger.error('[Recovery] Failed to get pending melt operations:', error as Error)
  }

  // 2. Legacy pendingMelts cleanup (via port)
  try {
    await pendingOpRepo.deleteExpired(MAX_AGE_MS)
  } catch (error) {
    logger.error('[Recovery] Failed to clean up legacy pending melts:', error as Error)
  }

  logger.info(`[Recovery] Melts: ${recovered} recovered, ${failed} failed`)
  return { recovered, failed }
}

// ─── Send Token Recovery ───

/**
 * Marks the transaction DB settled/reclaimed from send-op local state.
 * sendOps.get reads the Coco repo, so network 0. A building block of reconcile().
 */
export async function reconcileSendTokenOps(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo'> & {
    sendOps: Pick<SendRecoveryOps, 'get'>
  },
  sdkTokens: PendingOperation[],
): Promise<{ settled: number; reclaimed: number }> {
  const { pendingOpRepo, txRepo, sendOps } = deps
  let settled = 0
  let reclaimed = 0

  for (const pending of sdkTokens) {
    try {
      const op = await sendOps.get(pending.metadata!.operationId as string)
      if (op?.state === 'finalized') {
        const existingTx = await txRepo.getById(pending.id)
        if (existingTx?.status === 'pending' && existingTx.outcome === 'unclaimed') {
          await txRepo.update(pending.id, {
            status: 'settled',
            outcome: 'claimed',
            completedAt: Date.now(),
            metadata: {
              ...existingTx.metadata,
              tokenState: 'spent',
            },
          })
          settled++
        }
        await pendingOpRepo.delete(pending.id)
      } else if (op?.state === 'rolled_back') {
        const existingTx = await txRepo.getById(pending.id)
        if (existingTx?.status === 'pending' && existingTx.outcome === 'unclaimed') {
          await txRepo.update(pending.id, {
            status: 'settled',
            outcome: 'reclaimed',
            completedAt: Date.now(),
            metadata: {
              ...existingTx.metadata,
              reclaimed: true,
            },
          })
          reclaimed++
        }
        await pendingOpRepo.delete(pending.id)
      }
    } catch (error) {
      logger.error(`[Recovery] Failed to check SDK send operation ${pending.metadata?.operationId}:`, error as Error)
    }
  }

  return { settled, reclaimed }
}

/**
 * Self-receives legacy (no operationId) send tokens.
 * receiveToken hits the network — a building block of recoverTargeted().
 */
export async function recoverLegacySendTokens(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo' | 'receiveToken'>,
  legacyTokens: PendingOperation[],
): Promise<{ reclaimed: number; recorded: number }> {
  const { pendingOpRepo, txRepo, receiveToken } = deps
  let reclaimed = 0
  let recorded = 0

  for (const pending of legacyTokens) {
    const existingTx = await txRepo.getById(pending.id)

    if (existingTx && existingTx.status === 'pending' && existingTx.method === 'cashu:ecash') {
      continue
    }

    const token = pending.metadata?.token as string | undefined

    if (!token) {
      if (!existingTx) {
        await txRepo.save({
          id: pending.id,
          direction: 'send',
          method: 'cashu:ecash',
          protocol: 'cashu-token',
          amount: pending.amount,
          accountId: pending.accountId,
          status: 'failed',
          createdAt: pending.createdAt,
          completedAt: Date.now(),
          metadata: { error: 'crash_during_token_creation' },
        })
      }
      await pendingOpRepo.delete(pending.id)
      recorded++
      continue
    }

    try {
      await receiveToken(token)
      if (existingTx) {
        // Mark original send as reclaimed + create receive record
        await txRepo.update(pending.id, {
          status: 'settled',
          outcome: 'reclaimed',
          completedAt: Date.now(),
          metadata: { ...existingTx.metadata, reclaimed: true },
        })
      }
      const now = Date.now()
      const reclaimTxId = `${pending.id}-reclaim`
      const existingReclaim = await txRepo.getById(reclaimTxId)
      if (!existingReclaim) {
        await txRepo.save({
          id: reclaimTxId,
          direction: 'receive',
          method: 'cashu:ecash',
          protocol: 'cashu-token',
          amount: pending.amount,
          accountId: pending.accountId,
          status: 'settled',
          outcome: 'reclaimed',
          createdAt: now,
          completedAt: now,
          metadata: { reclaimedFrom: pending.id },
        })
      }
      await pendingOpRepo.delete(pending.id)
      reclaimed++
    } catch (error) {
      const errorMsg = String(error).toLowerCase()
      if (errorMsg.includes('already spent') || errorMsg.includes('token already spent')) {
        if (!existingTx) {
          await txRepo.save({
            id: pending.id,
            direction: 'send',
            method: 'cashu:ecash',
            protocol: 'cashu-token',
            amount: pending.amount,
            accountId: pending.accountId,
            status: 'settled',
            outcome: 'claimed',
            createdAt: pending.createdAt,
            completedAt: Date.now(),
          })
        }
        await pendingOpRepo.delete(pending.id)
        recorded++
      } else {
        logger.error(`[Recovery] Failed to recover send token ${pending.id}:`, error as Error)
      }
    }
  }

  return { reclaimed, recorded }
}

/**
 * Full path (legacy recoverAll / ks.recovery-split ON) — reassembles the pieces.
 * Behavior matches pre-split: SDK sweep → local reconcile → legacy self-receive.
 */
export async function recoverPendingSendTokens(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo' | 'sendOps' | 'receiveToken'>,
): Promise<{ reclaimed: number; recorded: number }> {
  // 1. SDK recovery
  try {
    await deps.sendOps.runRecovery()
    logger.info('[Recovery] SDK recoverPendingOperations completed')
  } catch (error) {
    logger.error('[Recovery] SDK recoverPendingOperations failed:', error as Error)
  }

  // 2. List pending send-token operations via port
  const allPending = await deps.pendingOpRepo.list()
  const pendingTokens = allPending.filter((op) => op.kind === 'send-token')
  if (pendingTokens.length === 0) return { reclaimed: 0, recorded: 0 }

  logger.info(`[Recovery] Found ${pendingTokens.length} pending send tokens`)

  const sdkTokens = pendingTokens.filter((p) => p.metadata?.operationId)
  const legacyTokens = pendingTokens.filter((p) => !p.metadata?.operationId)

  // 3. SDK-managed cleanup
  const b3 = await reconcileSendTokenOps(deps, sdkTokens)
  // 4. Legacy recovery
  const b4 = await recoverLegacySendTokens(deps, legacyTokens)

  const reclaimed = b3.reclaimed + b4.reclaimed
  const recorded = b3.settled + b4.recorded
  logger.info(`[Recovery] Send tokens: ${reclaimed} reclaimed, ${recorded} recorded`)
  return { reclaimed, recorded }
}

// ─── Mint Quote Recovery ───

export async function recoverPendingQuotes(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo' | 'quoteOps' | 'activeMintUrls'>,
): Promise<{ recovered: number; failed: number; expired: number }> {
  const { pendingOpRepo, txRepo, quoteOps, activeMintUrls } = deps

  let recovered = 0
  let failed = 0
  let expired = 0
  const now = Date.now()
  const normalizedActiveMintUrls = activeMintUrls
    ? new Set(activeMintUrls.map(mintUrlKey))
    : null

  const allPending = await pendingOpRepo.list()
  const mintQuotes = allPending.filter((op) => op.kind === 'mint-quote')

  logger.info(`[Recovery] Found ${mintQuotes.length} pending Lightning receive transactions`)

  for (const op of mintQuotes) {
    const quoteId = op.metadata?.quoteId as string | undefined
    const mintUrl = op.accountId

    if (!quoteId || !mintUrl) {
      if (isExpiredQuoteOp(op, now)) {
        await txRepo.update(op.id, { status: 'failed', completedAt: now })
        expired++
      }
      continue
    }

    if (normalizedActiveMintUrls && !normalizedActiveMintUrls.has(mintUrlKey(mintUrl))) {
      await txRepo.update(op.id, { status: 'failed', completedAt: now })
      failed++
      continue
    }

    if (isExpiredQuoteOp(op, now)) {
      await txRepo.update(op.id, { status: 'failed', completedAt: now })
      expired++
      continue
    }

    try {
      const quoteStatus = await quoteOps.checkMintQuote(quoteId, mintUrl)

      if (quoteStatus.state === 'ISSUED') {
        await txRepo.update(op.id, { status: 'settled', outcome: 'claimed', completedAt: now })
        recovered++
      } else if (quoteStatus.state === 'PAID') {
        await quoteOps.mintAndReceive(quoteId, mintUrl, toNumber(op.amount))
        await txRepo.update(op.id, { status: 'settled', outcome: 'claimed', completedAt: now })
        recovered++
      } else if (quoteStatus.state === 'UNPAID') {
        // still waiting — leave as pending
      } else {
        await txRepo.update(op.id, { status: 'failed' })
        failed++
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg.includes('already issued')) {
        await txRepo.update(op.id, { status: 'settled', outcome: 'claimed', completedAt: now })
        recovered++
      } else {
        logger.error(`[Recovery] Failed to recover quote ${quoteId}:`, error as Error)
        failed++
      }
    }
  }

  logger.info(`[Recovery] Complete: ${recovered} recovered, ${failed} failed, ${expired} expired`)
  return { recovered, failed, expired }
}

function isExpiredQuoteOp(op: PendingOperation, now: number): boolean {
  return isPendingOperationExpired(op, now) || (op.expiresAt == null && (now - op.createdAt) > MAX_AGE_MS)
}

// ─── Reconcile (local reconciliation — network 0) ───

/**
 * Local mint-quote reconciliation.
 *
 * Unlike recoverPendingQuotes, does no remote check (checkMintQuote/mintAndReceive):
 * - Expired / removed-mint quote → mark the transaction failed (unchanged).
 * - Dual-net: Coco local op is finalized but the transaction is still pending → settle
 *   (recovers cases where an app kill dropped the observer event — a local residue
 *   scan for push).
 * - Coco-untracked quote (getByQuote null) → mark failed. Intentional behavior change:
 *   this used to let checkMintQuote throw, only log, and retry as pending forever. A
 *   quote that neither push nor requeue can ever reach has no revival path, so we
 *   terminate it. (importQuote rescue is deliberately out of scope given its
 *   state-pollution cost.)
 * Termination = the tx status update itself: a mint-quote is not a real row in
 * pendingOpRepo but a virtual view over transactions(status=pending), so marking it
 * failed/settled is what removes it from the next scan
 * (dexie-pending-operation.repository.ts:107-125).
 */
export async function reconcileMintQuotes(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo' | 'activeMintUrls'> & {
    mintOpLookup: MintOpLookup
  },
): Promise<{ settled: number; failed: number }> {
  const { pendingOpRepo, txRepo, mintOpLookup, activeMintUrls } = deps
  let settled = 0
  let failed = 0
  const now = Date.now()
  const normalizedActiveMintUrls = activeMintUrls
    ? new Set(activeMintUrls.map(mintUrlKey))
    : null

  const allPending = await pendingOpRepo.list()
  const mintQuotes = allPending.filter((op) => op.kind === 'mint-quote')

  for (const op of mintQuotes) {
    const quoteId = op.metadata?.quoteId as string | undefined
    const mintUrl = op.accountId

    try {
      // Unidentifiable / removed-mint / expired → terminate as failed
      if (!quoteId || !mintUrl) {
        if (isExpiredQuoteOp(op, now)) {
          await txRepo.update(op.id, { status: 'failed', completedAt: now })
          failed++
        }
        continue
      }
      if (normalizedActiveMintUrls && !normalizedActiveMintUrls.has(mintUrlKey(mintUrl))) {
        await txRepo.update(op.id, { status: 'failed', completedAt: now })
        failed++
        continue
      }
      if (isExpiredQuoteOp(op, now)) {
        await txRepo.update(op.id, { status: 'failed', completedAt: now })
        failed++
        continue
      }

      const cocoOp = await mintOpLookup(mintUrl, quoteId)

      if (cocoOp === null) {
        // Untracked — push/requeue can never reach it → terminate (behavior change; see doc above)
        await txRepo.update(op.id, { status: 'failed', completedAt: now })
        failed++
      } else if (cocoOp.state === 'finalized') {
        // Dual-net: settle what the observer missed
        await txRepo.update(op.id, { status: 'settled', outcome: 'claimed', completedAt: now })
        settled++
      } else if (cocoOp.state === 'failed') {
        await txRepo.update(op.id, { status: 'failed', completedAt: now })
        failed++
      }
      // 'init'|'pending'|'executing' — Coco in progress: owned by push/requeue, left untouched
    } catch (error) {
      logger.error(`[Recovery] Failed to reconcile quote ${quoteId}:`, error as Error)
    }
  }

  return { settled, failed }
}

/**
 * reconcile() orchestrator — send-op reconcile + mint-quote reconcile + legacy
 * expiry cleanup. Local reads/writes only: network 0 is the contract.
 */
export async function reconcileCashu(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo' | 'activeMintUrls'> & {
    sendOps: Pick<SendRecoveryOps, 'get'>
    mintOpLookup: MintOpLookup
  },
): Promise<ReconcileReport> {
  // send-op local-state reconcile
  const allPending = await deps.pendingOpRepo.list()
  const sdkTokens = allPending.filter((op) => op.kind === 'send-token' && op.metadata?.operationId)
  const sends = await reconcileSendTokenOps(
    { pendingOpRepo: deps.pendingOpRepo, txRepo: deps.txRepo, sendOps: deps.sendOps },
    sdkTokens,
  )

  // mint-quote reconcile
  const quotes = await reconcileMintQuotes(deps)

  // clean up legacy expired rows
  let cleaned = 0
  try {
    cleaned = await deps.pendingOpRepo.deleteExpired(MAX_AGE_MS)
  } catch (error) {
    logger.error('[Recovery] deleteExpired failed:', error as Error)
  }

  const report: ReconcileReport = {
    settled: sends.settled + quotes.settled,
    reclaimed: sends.reclaimed,
    failed: quotes.failed,
    cleaned,
  }
  logger.info(
    `[Reconcile] settled=${report.settled} reclaimed=${report.reclaimed} failed=${report.failed} cleaned=${report.cleaned}`,
  )
  return report
}

// ─── Coco SDK Internal Stuck Mint Ops Cleanup ───

const STALE_MINT_OP_MS = 24 * 60 * 60 * 1000

/**
 * Cleans up pending mint operations stuck inside the Coco SDK.
 * Past STALE_MINT_OP_MS → abandon; otherwise retry recovery via mintAndReceive.
 */
export async function cleanAndRecoverStaleMintOps(): Promise<{ recovered: number; abandoned: number; failed: number }> {
  let recovered = 0
  let abandoned = 0
  let failed = 0
  const now = Date.now()

  try {
    const manager = await getCocoManager()
    const pending = await manager.ops.mint.listPending()

    if (pending.length === 0) return { recovered, abandoned, failed }

    logger.info(`[Recovery] Found ${pending.length} stuck pending mint ops in Coco SDK`)

    for (const op of pending) {
      if (op.createdAt && (now - op.createdAt) > STALE_MINT_OP_MS) {
        try {
          await abandonMintQuote(op.mintUrl, op.quoteId)
          abandoned++
          logger.info(`[Recovery] Abandoned stale mint op: ${op.quoteId} (${op.mintUrl})`)
        } catch (e) {
          failed++
          logger.error(`[Recovery] Failed to abandon stale mint op ${op.quoteId}:`, e as Error)
        }
      } else {
        try {
          await mintAndReceive(op.quoteId, op.mintUrl, op.amount ?? 0)
          recovered++
          logger.info(`[Recovery] Recovered stuck mint op: ${op.quoteId} (${op.mintUrl})`)
        } catch (e) {
          const msg = String(e).toLowerCase()
          if (msg.includes('not paid') || msg.includes('400') || msg.includes('expired') || msg.includes('not found')) {
            try {
              await abandonMintQuote(op.mintUrl, op.quoteId)
              abandoned++
              logger.info(`[Recovery] Abandoned unrecoverable mint op: ${op.quoteId}`)
            } catch {
              failed++
            }
          } else {
            failed++
            logger.error(`[Recovery] Failed to recover mint op ${op.quoteId}:`, e as Error)
          }
        }
      }
    }

    logger.info(`[Recovery] Stale mint ops: ${recovered} recovered, ${abandoned} abandoned, ${failed} failed`)
  } catch (e) {
    logger.error('[Recovery] cleanAndRecoverStaleMintOps failed:', e as Error)
  }

  return { recovered, abandoned, failed }
}

// ─── Stale 'prepared' operation sweep ───

/**
 * Crash-leftover 'prepared' send/melt ops hold proof reservations forever:
 * coco recovery only logs them ("user can rollback manually") and its orphan
 * cleanup skips non-terminal ops, so `spendable` stays depressed for good.
 *
 * Safe by construction: live flows never park an op in 'prepared' across a
 * user wait (every prepare is followed by execute or rollback in the same
 * call), and created-but-unclaimed tokens are 'pending', never 'prepared' —
 * this sweep cannot reclaim redeemable money. The age cutoff (ops touched
 * before this process started) plus the once-per-process guard keep it away
 * from anything a live flow in this process prepares.
 */
const PROCESS_STARTED_AT = Date.now()
let preparedSweepDone = false

export async function sweepStalePreparedOps(): Promise<void> {
  if (preparedSweepDone) return
  preparedSweepDone = true
  try {
    const manager = await getCocoManager()
    const [sends, melts] = await Promise.all([
      manager.ops.send.listPrepared(),
      manager.ops.melt.listPrepared(),
    ])
    for (const op of sends) {
      if (op.updatedAt >= PROCESS_STARTED_AT) continue
      try {
        await manager.ops.send.cancel(op.id)
        logger.warn('[recovery] cancelled stale prepared send op', { id: op.id })
      } catch (error) {
        logger.warn('[recovery] stale prepared send cancel failed', { id: op.id, error })
      }
    }
    for (const op of melts) {
      if (op.updatedAt >= PROCESS_STARTED_AT) continue
      try {
        await manager.ops.melt.cancel(op.id, 'stale_prepared_sweep')
        logger.warn('[recovery] cancelled stale prepared melt op', { id: op.id })
      } catch (error) {
        logger.warn('[recovery] stale prepared melt cancel failed', { id: op.id, error })
      }
    }
  } catch (error) {
    logger.warn('[recovery] stale prepared sweep failed', { error })
  }
}
