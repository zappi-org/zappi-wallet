/**
 * Cashu Recovery — PendingOperationRepository + TransactionRepository 포트 기반
 *
 * cashu-backend.ts에 있던 recovery 함수들을 포트 경유로 전환.
 * DB/legacy 직접 접근 없음. SDK 호출은 주입된 인터페이스를 통해.
 */

import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { PendingOperation } from '@/core/domain/pending-operation'
import { toNumber } from '@/core/domain/amount'

// ─── SDK interfaces (DI용 — Coco 직접 의존 없음) ───

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

// ─── Recovery deps ───

export interface CashuRecoveryDeps {
  pendingOpRepo: PendingOperationRepository
  txRepo: TransactionRepository
  meltOps: MeltRecoveryOps
  sendOps: SendRecoveryOps
  quoteOps: QuoteRecoveryOps
  receiveToken: RecoverTokenFn
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
    console.log(`[Recovery] Found ${pendingOps.length} pending melt operations`)

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
        console.error(`[Recovery] Failed to recover melt operation ${op.id}:`, error)
        failed++
      }
    }
  } catch (error) {
    console.error('[Recovery] Failed to get pending melt operations:', error)
  }

  // 2. Legacy pendingMelts cleanup (via port)
  try {
    await pendingOpRepo.deleteExpired(MAX_AGE_MS)
  } catch (error) {
    console.error('[Recovery] Failed to clean up legacy pending melts:', error)
  }

  console.log(`[Recovery] Melts: ${recovered} recovered, ${failed} failed`)
  return { recovered, failed }
}

// ─── Send Token Recovery ───

export async function recoverPendingSendTokens(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo' | 'sendOps' | 'receiveToken'>,
): Promise<{ reclaimed: number; recorded: number }> {
  const { pendingOpRepo, txRepo, sendOps, receiveToken } = deps

  // 1. SDK recovery
  try {
    await sendOps.runRecovery()
    console.log('[Recovery] SDK recoverPendingOperations completed')
  } catch (error) {
    console.error('[Recovery] SDK recoverPendingOperations failed:', error)
  }

  // 2. List pending send-token operations via port
  const allPending = await pendingOpRepo.list()
  const pendingTokens = allPending.filter((op) => op.kind === 'send-token')
  if (pendingTokens.length === 0) return { reclaimed: 0, recorded: 0 }

  console.log(`[Recovery] Found ${pendingTokens.length} pending send tokens`)

  const sdkTokens = pendingTokens.filter((p) => p.metadata?.operationId)
  const legacyTokens = pendingTokens.filter((p) => !p.metadata?.operationId)

  let reclaimed = 0
  let recorded = 0

  // 3. SDK-managed cleanup
  for (const pending of sdkTokens) {
    try {
      const op = await sendOps.get(pending.metadata!.operationId as string)
      if (op && (op.state === 'finalized' || op.state === 'rolled_back')) {
        await pendingOpRepo.delete(pending.id)
      }
    } catch (error) {
      console.error(`[Recovery] Failed to check SDK send operation ${pending.metadata?.operationId}:`, error)
    }
  }

  // 4. Legacy recovery
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
        console.error(`[Recovery] Failed to recover send token ${pending.id}:`, error)
      }
    }
  }

  console.log(`[Recovery] Send tokens: ${reclaimed} reclaimed, ${recorded} recorded`)
  return { reclaimed, recorded }
}

// ─── Mint Quote Recovery ───

export async function recoverPendingQuotes(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo' | 'quoteOps'>,
): Promise<{ recovered: number; failed: number; expired: number }> {
  const { pendingOpRepo, txRepo, quoteOps } = deps

  let recovered = 0
  let failed = 0
  const expired = 0
  const now = Date.now()

  const allPending = await pendingOpRepo.list()
  const mintQuotes = allPending.filter((op) => op.kind === 'mint-quote')

  console.log(`[Recovery] Found ${mintQuotes.length} pending Lightning receive transactions`)

  for (const op of mintQuotes) {
    const quoteId = op.metadata?.quoteId as string | undefined
    const mintUrl = op.accountId

    if (!quoteId || !mintUrl) {
      if (isExpiredOp(op)) {
        await txRepo.update(op.id, { status: 'failed' })
      }
      continue
    }

    if (isExpiredOp(op)) {
      await txRepo.update(op.id, { status: 'failed' })
      failed++
      continue
    }

    try {
      const quoteStatus = await quoteOps.checkMintQuote(quoteId, mintUrl)

      if (quoteStatus.state === 'ISSUED') {
        await txRepo.update(op.id, { status: 'settled', outcome: 'claimed', completedAt: now })
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
      } else {
        console.error(`[Recovery] Failed to recover quote ${quoteId}:`, error)
        failed++
      }
    }
  }

  console.log(`[Recovery] Complete: ${recovered} recovered, ${failed} failed, ${expired} expired`)
  return { recovered, failed, expired }
}

function isExpiredOp(op: PendingOperation): boolean {
  return Date.now() - op.createdAt > MAX_AGE_MS
}
