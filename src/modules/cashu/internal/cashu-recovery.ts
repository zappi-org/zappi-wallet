/**
 * Cashu Recovery — PendingOperationRepository + TransactionRepository 포트 기반
 *
 * cashu-backend.ts에 있던 recovery 함수들을 포트 경유로 전환.
 * DB/legacy 직접 접근 없음. SDK 호출은 주입된 인터페이스를 통해.
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

/** Coco 로컬 repo의 mint op 상태 조회 (네트워크 0) — reconcile 전용 */
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
 * B3 — send op 로컬 상태 → 거래DB settle/reclaim 마킹 (설계 §6.1).
 * sendOps.get은 Coco repo 읽기라 네트워크 0. reconcile()의 구성 요소.
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
 * B4 — legacy(무operationId) send 토큰 self-receive (설계 §6.1).
 * receiveToken이 네트워크를 탄다 — recoverTargeted()의 구성 요소.
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
 * Full 경로(레거시 recoverAll / ks.recovery-split ON) — B1+B3+B4 재조립.
 * 행동은 분해 전과 동일: SDK sweep → 로컬 정합 → legacy self-receive.
 */
export async function recoverPendingSendTokens(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo' | 'sendOps' | 'receiveToken'>,
): Promise<{ reclaimed: number; recorded: number }> {
  // 1. SDK recovery (B1)
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

  // 3. SDK-managed cleanup (B3)
  const b3 = await reconcileSendTokenOps(deps, sdkTokens)
  // 4. Legacy recovery (B4)
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

// ─── Reconcile (로컬 정합 — 네트워크 0) ───

/**
 * mint-quote 로컬 정합 (설계 §6.1 B5 + B6 이중망 + B7b).
 *
 * recoverPendingQuotes와 달리 원격 확인(checkMintQuote/mintAndReceive)이 없다:
 * - B5: 만료·제거민트 quote → 거래DB 실패 마킹 (기존과 동일)
 * - B6 이중망: Coco 로컬 op가 finalized인데 거래가 pending → settle
 *   (observer 이벤트를 앱 킬로 놓친 경우의 회수 — push의 로컬 잔상 스캔)
 * - B7b: Coco 비추적 quote(getByQuote null) → 실패 마킹 — **의도적 행동 변경**:
 *   기존은 checkMintQuote throw→로그만 남기고 영원히 pending으로 재시도했다.
 *   push도 requeue(B7a)도 닿지 않는 quote는 회생 경로가 없으므로 종결한다.
 *   (importQuote 구제는 상태 오염 비용 때문에 명시적 범위 외 — 설계 §6.1)
 * 종결 = tx status 갱신 그 자체다: mint-quote는 pendingOpRepo의 실제 행이
 * 아니라 transactions(status=pending)의 가상 뷰라, failed/settled 마킹이 곧
 * 다음 스캔에서의 제거다 (dexie-pending-operation.repository.ts:107-125).
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
      // B5: 식별 불가·제거민트·만료 → 실패 종결
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
        // B7b: 비추적 — push/requeue가 절대 닿지 않는다 → 종결 (행동 변경, 위 주석)
        await txRepo.update(op.id, { status: 'failed', completedAt: now })
        failed++
      } else if (cocoOp.state === 'finalized') {
        // B6 이중망: observer 유실분 settle
        await txRepo.update(op.id, { status: 'settled', outcome: 'claimed', completedAt: now })
        settled++
      } else if (cocoOp.state === 'failed') {
        await txRepo.update(op.id, { status: 'failed', completedAt: now })
        failed++
      }
      // 'init'|'pending'|'executing' — Coco 진행 중: push/B7a 소관, 손대지 않음
    } catch (error) {
      logger.error(`[Recovery] Failed to reconcile quote ${quoteId}:`, error as Error)
    }
  }

  return { settled, failed }
}

/**
 * reconcile() 오케스트레이터 (설계 §6.2) — B3 + B5/B6이중망/B7b + B8.
 * 전 항목 로컬 읽기/쓰기만: 네트워크 0이 계약이다.
 */
export async function reconcileCashu(
  deps: Pick<CashuRecoveryDeps, 'pendingOpRepo' | 'txRepo' | 'activeMintUrls'> & {
    sendOps: Pick<SendRecoveryOps, 'get'>
    mintOpLookup: MintOpLookup
  },
): Promise<ReconcileReport> {
  // B3: send op 로컬 상태 정합
  const allPending = await deps.pendingOpRepo.list()
  const sdkTokens = allPending.filter((op) => op.kind === 'send-token' && op.metadata?.operationId)
  const sends = await reconcileSendTokenOps(
    { pendingOpRepo: deps.pendingOpRepo, txRepo: deps.txRepo, sendOps: deps.sendOps },
    sdkTokens,
  )

  // B5 + B6 이중망 + B7b: mint-quote 정합
  const quotes = await reconcileMintQuotes(deps)

  // B8: legacy 만료 행 정리
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
 * Coco SDK 내부에 stuck된 pending mint operation을 정리.
 * 5일 이상 경과 → abandon, 그 외 → mintAndReceive로 복구 시도.
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
