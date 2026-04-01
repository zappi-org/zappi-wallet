/**
 * CashuBackend — Coco Manager 래핑 클래스
 *
 * cashuService.ts에 흩어진 26개 함수를 Coco RC50 API 기반으로 통합.
 * P2PK는 prepare 시점에 target으로 지정 (Coco 네이티브).
 * cashu-ts 직접 의존 없음.
 */

import { getCocoManager, getPendingMintQuotes } from './coco-sdk';
import type { PendingQuote } from '@/store/slices/wallet.slice';

// ─── Types ───

export interface LockingCondition {
  kind: 'P2PK';
  data: string;
  tags?: string[][];
}

export interface PreparedSend {
  operationId: string;
  fee: number;
  needsSwap: boolean;
}

export interface PreparedMelt {
  operationId: string;
  quoteId: string;
  amount: number;
  fee_reserve: number;
  swap_fee: number;
}

export interface MintQuoteResult {
  quote: string;
  request: string;
  expiry: number;
}

export interface PendingMeltOperation {
  id: string;
  mintUrl: string;
  quoteId: string;
  amount: number;
  fee_reserve: number;
  createdAt: number;
}

// ─── Helpers ───

async function ensureMintTrusted(
  manager: Awaited<ReturnType<typeof getCocoManager>>,
  mintUrl: string,
): Promise<void> {
  const mints = await manager.mint.getAllMints();
  const exists = mints.some((m) => m.mintUrl === mintUrl);
  if (!exists) {
    await manager.mint.addMint(mintUrl, { trusted: true });
  }
}

// ─── Send ───

/**
 * 토큰 전송 준비.
 * P2PK 전송 시 target: { type: 'p2pk', pubkey } 를 전달하면
 * Coco가 내부적으로 P2PK-locked output을 생성한다.
 */
export async function prepareSend(params: {
  mintUrl: string;
  amount: number;
  lockingCondition?: LockingCondition;
}): Promise<PreparedSend> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, params.mintUrl);

  // LockingCondition → Coco SDK target 변환
  const target = params.lockingCondition?.kind === 'P2PK'
    ? { type: 'p2pk' as const, pubkey: params.lockingCondition.data }
    : undefined;

  try {
    const prepared = await manager.ops.send.prepare({
      mintUrl: params.mintUrl,
      amount: params.amount,
      target,
    });
    return { operationId: prepared.id, fee: prepared.fee, needsSwap: prepared.needsSwap };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Not enough funds')) {
      const { InsufficientBalanceError } = await import('@/core/errors/cashu');
      const balances = await manager.wallet.getBalances();
      const available = balances[params.mintUrl] || 0;

      if (available >= params.amount) {
        throw new InsufficientBalanceError(params.amount, available, err, 1);
      } else {
        throw new InsufficientBalanceError(params.amount, available, err);
      }
    }
    throw err;
  }
}

/**
 * 토큰 전송 실행.
 * Coco가 P2PK lock, change proof 반환, 에러 복구를 모두 내부 처리한다.
 */
export async function executeSend(
  operationId: string,
  options?: { memo?: string },
): Promise<{ token: string }> {
  const manager = await getCocoManager();
  const { token } = await manager.ops.send.execute(operationId);
  const { getEncodedToken } = await import('@cashu/cashu-ts');
  return { token: getEncodedToken({ ...token, memo: options?.memo }) };
}

/**
 * 토큰 전송 취소/회수.
 * prepared → cancel, pending → reclaim.
 */
export async function rollbackSend(operationId: string): Promise<void> {
  const manager = await getCocoManager();
  const op = await manager.ops.send.get(operationId);
  if (op?.state === 'prepared') {
    await manager.ops.send.cancel(operationId);
  } else {
    await manager.ops.send.reclaim(operationId);
  }
}

// ─── Receive ───

/**
 * 토큰 수령 (일반 + P2PK 모두).
 * Coco RC50의 ops.receive가 P2PK unlock을 내부 처리한다.
 */
export async function receiveToken(token: string): Promise<{ amount: number }> {
  const manager = await getCocoManager();

  // mint 등록 확인 + amount 파싱
  const { getDecodedToken } = await import('@cashu/cashu-ts');
  const decoded = getDecodedToken(token);
  await ensureMintTrusted(manager, decoded.mint);
  const amount = decoded.proofs.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);

  const prepared = await manager.ops.receive.prepare({ token });
  await manager.ops.receive.execute(prepared);

  return { amount };
}

// ─── Mint (Lightning 수신) ───

export async function createMintQuote(
  mintUrl: string,
  amount: number,
): Promise<MintQuoteResult> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, mintUrl);
  const op = await manager.ops.mint.prepare({ mintUrl, amount, method: 'bolt11', methodData: {} });
  return {
    quote: op.quoteId,
    request: op.request,
    expiry: op.expiry,
  };
}

export async function redeemMintQuote(
  mintUrl: string,
  quoteId: string,
  expectedAmount: number,
): Promise<void> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, mintUrl);

  const mintOp = await manager.ops.mint.getByQuote(mintUrl, quoteId);
  if (!mintOp) throw new Error(`Mint operation not found for quote ${quoteId}`);
  await manager.ops.mint.execute(mintOp);

  console.log(`[CashuBackend] Redeemed quote ${quoteId} (expected: ${expectedAmount} sats)`);
}

// ─── Melt (Lightning 전송) ───

export async function prepareMelt(
  mintUrl: string,
  invoice: string,
): Promise<PreparedMelt> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, mintUrl);
  const operation = await manager.ops.melt.prepare({ mintUrl, method: 'bolt11', methodData: { invoice } });
  return {
    operationId: operation.id,
    quoteId: operation.quoteId,
    amount: operation.amount,
    fee_reserve: operation.fee_reserve,
    swap_fee: operation.swap_fee,
  };
}

export async function executeMelt(operationId: string): Promise<{ state: string }> {
  const manager = await getCocoManager();
  const result = await manager.ops.melt.execute(operationId);
  return { state: result.state };
}

export async function rollbackMelt(operationId: string, reason?: string): Promise<void> {
  const manager = await getCocoManager();
  const op = await manager.ops.melt.get(operationId);
  if (op?.state === 'prepared') {
    await manager.ops.melt.cancel(operationId, reason);
  } else {
    await manager.ops.melt.reclaim(operationId, reason);
  }
}

// ─── 조회 ───

export async function getBalances(): Promise<{ [mintUrl: string]: number }> {
  const manager = await getCocoManager();
  return manager.wallet.getBalances();
}

export async function getPendingMeltOperations(): Promise<PendingMeltOperation[]> {
  const manager = await getCocoManager();
  const ops = await manager.ops.melt.listInFlight();
  return ops.map(op => ({
    id: op.id,
    mintUrl: op.mintUrl,
    quoteId: 'quoteId' in op ? (op as { quoteId: string }).quoteId : '',
    amount: 'amount' in op ? (op as { amount: number }).amount : 0,
    fee_reserve: 'fee_reserve' in op ? (op as { fee_reserve: number }).fee_reserve : 0,
    createdAt: op.createdAt,
  }));
}

export async function checkMeltQuoteStatus(
  mintUrl: string,
  quoteId: string,
): Promise<{ state: string; paid: boolean }> {
  const manager = await getCocoManager();
  const op = await manager.ops.melt.getByQuote(mintUrl, quoteId);
  if (!op) return { state: 'UNKNOWN', paid: false };
  const refreshed = await manager.ops.melt.refresh(op.id);
  return { state: refreshed.state, paid: refreshed.state === 'finalized' };
}

export async function getActivePendingQuotes(): Promise<PendingQuote[]> {
  const quotes = await getPendingMintQuotes();
  const now = Date.now();

  return quotes
    .filter((q) => {
      if (q.expiry && q.expiry * 1000 < now) return false;
      return true;
    })
    .map((q) => ({
      quoteId: q.quote,
      mintUrl: q.mintUrl,
      amount: q.amount,
      invoice: q.request,
      expiry: q.expiry ? q.expiry * 1000 : 0,
    }));
}

// ─── Payment Request (NUT-18) ───

export interface ResolvedCreq {
  payableMints: string[];
  allowedMints: string[];   // 빈 배열 = 아무 mint 허용
  amount?: number;
  transport: { type: 'inband' } | { type: 'http'; url: string };
  nut10?: { kind: string; data: string; tags?: string[][] };
}

export interface PreparedCreq {
  operationId: string;
  resolved: ResolvedCreq;
}

export interface CreqExecutionResult {
  type: 'inband' | 'http';
  token?: string;
}

export async function parsePaymentRequest(creq: string): Promise<ResolvedCreq> {
  const manager = await getCocoManager();
  const resolved = await manager.paymentRequests.parse(creq);
  const nut10 = resolved.paymentRequest.nut10;
  return {
    payableMints: resolved.payableMints,
    allowedMints: resolved.allowedMints,
    amount: resolved.amount,
    transport: resolved.transport,
    nut10: nut10 ? { kind: nut10.kind, data: nut10.data, tags: nut10.tags } : undefined,
  };
}

export async function preparePaymentRequest(
  resolved: ResolvedCreq,
  options: { mintUrl: string; amount?: number },
): Promise<PreparedCreq> {
  const manager = await getCocoManager();
  const prepared = await manager.paymentRequests.prepare(
    resolved as Parameters<typeof manager.paymentRequests.prepare>[0],
    options,
  );
  return {
    operationId: prepared.sendOperation.id,
    resolved,
  };
}

export async function executePaymentRequest(
  prepared: PreparedCreq,
): Promise<CreqExecutionResult> {
  const manager = await getCocoManager();
  const sendOp = await manager.ops.send.get(prepared.operationId);
  if (!sendOp || sendOp.state !== 'prepared') {
    throw new Error(`Send operation ${prepared.operationId} not in prepared state`);
  }

  const { token } = await manager.ops.send.execute(sendOp);
  const { getEncodedToken } = await import('@cashu/cashu-ts');
  const encodedToken = getEncodedToken(token);

  if (prepared.resolved.transport.type === 'http') {
    const { url } = prepared.resolved.transport as { type: 'http'; url: string };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: encodedToken }),
    });
    return { type: 'http' };
  }

  return { type: 'inband', token: encodedToken };
}

// ─── Wallet 관리 ───

export async function restoreWallet(mintUrl: string): Promise<void> {
  const manager = await getCocoManager();
  await manager.wallet.restore(mintUrl);
}

export async function addMint(mintUrl: string): Promise<void> {
  const manager = await getCocoManager();
  await manager.mint.addMint(mintUrl, { trusted: true });
}

// ─── Recovery ───

export async function recoverPendingMelts(): Promise<{ recovered: number; failed: number }> {
  const manager = await getCocoManager();
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();

  let recovered = 0;
  let failed = 0;
  const maxAge = 24 * 60 * 60 * 1000;
  const now = Date.now();

  try {
    const pendingOps = await manager.ops.melt.listInFlight();
    console.log(`[Recovery] Found ${pendingOps.length} pending melt operations`);

    for (const op of pendingOps) {
      try {
        const refreshed = await manager.ops.melt.refresh(op.id);
        if (refreshed.state === 'finalized') {
          recovered++;
        } else if (refreshed.state === 'rolled_back') {
          recovered++;
        } else if (refreshed.state === 'failed') {
          await manager.ops.melt.reclaim(op.id, 'recovery: payment failed');
          recovered++;
        } else if (op.createdAt && (now - op.createdAt) > maxAge) {
          await manager.ops.melt.reclaim(op.id, 'recovery: expired');
          failed++;
        }
      } catch (error) {
        console.error(`[Recovery] Failed to recover melt operation ${op.id}:`, error);
        failed++;
      }
    }
  } catch (error) {
    console.error('[Recovery] Failed to get pending melt operations:', error);
  }

  // Legacy pendingMelts cleanup
  try {
    const legacyMelts = await db.pendingMelts.toArray();
    for (const melt of legacyMelts) {
      if (now - melt.createdAt > maxAge) {
        await db.pendingMelts.delete(melt.meltQuoteId);
      }
    }
  } catch (error) {
    console.error('[Recovery] Failed to clean up legacy pending melts:', error);
  }

  console.log(`[Recovery] Melts: ${recovered} recovered, ${failed} failed`);
  return { recovered, failed };
}

export async function recoverPendingSendTokens(): Promise<{ reclaimed: number; recorded: number }> {
  const manager = await getCocoManager();
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();

  // 1. SDK recovery
  try {
    await manager.ops.send.recovery.run();
    console.log('[Recovery] SDK recoverPendingOperations completed');
  } catch (error) {
    console.error('[Recovery] SDK recoverPendingOperations failed:', error);
  }

  const pendingTokens = await db.pendingSendTokens.toArray();
  if (pendingTokens.length === 0) return { reclaimed: 0, recorded: 0 };

  console.log(`[Recovery] Found ${pendingTokens.length} pending send tokens`);

  const sdkTokens = pendingTokens.filter(p => p.operationId);
  const legacyTokens = pendingTokens.filter(p => !p.operationId);

  let reclaimed = 0;
  let recorded = 0;

  // 2. SDK-managed cleanup
  for (const pending of sdkTokens) {
    try {
      const op = await manager.ops.send.get(pending.operationId!);
      if (op && (op.state === 'finalized' || op.state === 'rolled_back')) {
        await db.pendingSendTokens.delete(pending.id);
      }
    } catch (error) {
      console.error(`[Recovery] Failed to check SDK send operation ${pending.operationId}:`, error);
    }
  }

  // 3. Legacy recovery
  const { getTransactionRepo } = await import('@/data/repositories/transaction.repository');
  for (const pending of legacyTokens) {
    const existingTx = await db.transactions.get(pending.id);

    if (existingTx && existingTx.status === 'pending' && existingTx.type === 'ecash-token') {
      continue;
    }

    if (!pending.token) {
      if (!existingTx) {
        await getTransactionRepo().save({
          id: pending.id,
          direction: 'send',
          type: 'ecash-token',
          amount: pending.amount,
          mintUrl: pending.mintUrl,
          status: 'failed',
          createdAt: pending.createdAt,
          completedAt: Date.now(),
          metadata: { error: 'crash_during_token_creation' },
        });
      }
      await db.pendingSendTokens.delete(pending.id);
      recorded++;
      continue;
    }

    try {
      await receiveToken(pending.token);
      if (existingTx) {
        const { markSendReclaimed } = await import('@/coco/sendTokenObserver');
        await markSendReclaimed(pending.id);
      } else {
        const now = Date.now();
        const reclaimTxId = `${pending.id}-reclaim`;
        await getTransactionRepo().save({
          id: reclaimTxId,
          direction: 'receive',
          type: 'ecash-token',
          amount: pending.amount,
          mintUrl: pending.mintUrl,
          status: 'completed',
          createdAt: now,
          completedAt: now,
          metadata: { reclaimedFrom: pending.id },
        });
        await db.pendingSendTokens.delete(pending.id);
      }
      reclaimed++;
    } catch (error) {
      const errorMsg = String(error).toLowerCase();
      if (errorMsg.includes('already spent') || errorMsg.includes('token already spent')) {
        if (!existingTx) {
          await getTransactionRepo().save({
            id: pending.id,
            direction: 'send',
            type: 'ecash-token',
            amount: pending.amount,
            mintUrl: pending.mintUrl,
            status: 'completed',
            createdAt: pending.createdAt,
            completedAt: Date.now(),
            tokenState: 'spent',
          });
        }
        await db.pendingSendTokens.delete(pending.id);
        recorded++;
      } else {
        console.error(`[Recovery] Failed to recover send token ${pending.id}:`, error);
      }
    }
  }

  console.log(`[Recovery] Send tokens: ${reclaimed} reclaimed, ${recorded} recorded`);
  return { reclaimed, recorded };
}

export async function recoverPendingQuotes(): Promise<{
  recovered: number;
  failed: number;
  expired: number;
}> {
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();

  let recovered = 0;
  let failed = 0;
  const expired = 0;
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;

  // Legacy pending Lightning receive transactions
  const pendingTransactions = await db.transactions
    .where('status')
    .equals('pending')
    .and(tx => tx.type === 'lightning' && tx.direction === 'receive')
    .toArray();

  console.log(`[Recovery] Found ${pendingTransactions.length} pending Lightning receive transactions`);

  for (const tx of pendingTransactions) {
    const quoteId = tx.metadata?.quoteId as string | undefined;
    const mintUrl = tx.mintUrl;

    if (!quoteId || !mintUrl) {
      if (tx.createdAt && (now - tx.createdAt) > maxAge) {
        await db.transactions.update(tx.id, { status: 'failed' });
      }
      continue;
    }

    if (tx.createdAt && (now - tx.createdAt) > maxAge) {
      await db.transactions.update(tx.id, { status: 'failed' });
      failed++;
      continue;
    }

    const result = await tryRecoverQuote(quoteId, mintUrl, tx.amount);

    if (result.status === 'recovered') {
      recovered++;
      await db.transactions.update(tx.id, { status: 'completed', completedAt: Date.now() });
    } else if (result.status === 'already_issued') {
      await db.transactions.update(tx.id, { status: 'completed', completedAt: Date.now() });
    } else if (result.status === 'failed') {
      await db.transactions.update(tx.id, { status: 'failed' });
      failed++;
    }
  }

  console.log(`[Recovery] Complete: ${recovered} recovered, ${failed} failed, ${expired} expired`);
  return { recovered, failed, expired };
}

/**
 * Legacy quote recovery — cashu-ts 직접 사용 (Coco에 mint quote recovery API 없음).
 * Phase 7에서 legacy pending tx 정리 후 제거 대상.
 */
async function tryRecoverQuote(
  quoteId: string,
  mintUrl: string,
  amount: number,
): Promise<{ status: 'recovered' | 'failed' | 'not_paid' | 'already_issued'; error?: string }> {
  try {
    const { Wallet, Mint, getEncodedToken } = await import('@cashu/cashu-ts');
    const mint = new Mint(mintUrl);
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    const quoteStatus = await wallet.checkMintQuote(quoteId);

    if (quoteStatus.state === 'ISSUED') {
      return { status: 'already_issued' };
    }

    if (quoteStatus.state !== 'PAID') {
      return { status: 'not_paid' };
    }

    const proofs = await wallet.mintProofs(amount, quoteId);
    const token = getEncodedToken({ mint: mintUrl, proofs });
    await receiveToken(token);

    return { status: 'recovered' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('already issued')) {
      return { status: 'already_issued' };
    }
    return { status: 'failed', error: errorMsg };
  }
}
