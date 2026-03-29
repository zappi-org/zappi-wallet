/**
 * Cashu Service - Coco + P2PK 하이브리드
 *
 * Coco는 아직 P2PK receive 옵션을 노출하지 않아서,
 * P2PK 토큰 수령은 cashu-ts 직접 사용 후 Coco 저장소에 저장.
 *
 * 향후 Coco에 P2PK 지원 PR 후 이 레이어 제거 가능.
 */

import { Wallet, Mint, getDecodedToken, type Proof, type Token } from '@cashu/cashu-ts';
import { getCocoManager, getPendingMintQuotes } from './manager';
import type { PendingQuote } from '@/store/slices/wallet.slice';

// cashu-ts Wallet 캐시
const walletCache = new Map<string, Wallet>();

async function getCashuWallet(mintUrl: string): Promise<Wallet> {
  if (!walletCache.has(mintUrl)) {
    const mint = new Mint(mintUrl);
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    walletCache.set(mintUrl, wallet);
  }
  return walletCache.get(mintUrl)!;
}

/**
 * P2PK 토큰 수령 (cashu-ts 사용)
 * - P2PK로 잠긴 토큰을 unlock하고 swap
 * - 결과 proof를 Coco 저장소에 저장
 */
export async function receiveP2PKToken(
  token: string,
  privateKey: string
): Promise<{ proofs: Proof[]; mintUrl: string; amount: number }> {
  // 토큰 디코드
  const decoded = getDecodedToken(token);
  const mintUrl = decoded.mint;
  const proofs = decoded.proofs;

  if (!proofs || proofs.length === 0) {
    throw new Error('No proofs in token');
  }

  // cashu-ts로 P2PK swap
  const wallet = await getCashuWallet(mintUrl);
  const newProofs = await wallet.receive(token, { privkey: privateKey });

  const amount = newProofs.reduce((sum, p) => sum + p.amount, 0);

  // Coco Manager를 통해 일반 토큰으로 저장
  // Coco의 receive는 P2PK 옵션이 없으므로, 새로 생성된 unlocked 토큰을 생성해서 저장
  const manager = await getCocoManager();

  // 먼저 mint가 등록되어 있는지 확인하고 없으면 추가
  const knownMints = await manager.mint.getAllMints();
  const isKnown = knownMints.some(m => m.mintUrl === mintUrl);
  if (!isKnown) {
    await manager.mint.addMint(mintUrl, { trusted: true });
  }

  // 새 proofs를 Coco에 저장하기 위해 토큰 형태로 변환 후 receive
  // Note: 이 proofs는 이미 unlock된 상태이므로 일반 receive로 저장 가능
  const { getEncodedToken } = await import('@cashu/cashu-ts');
  const newToken = getEncodedToken({
    mint: mintUrl,
    proofs: newProofs,
  });

  // Coco receive로 저장 (P2PK 아닌 일반 토큰)
  await manager.wallet.receive(newToken);

  return { proofs: newProofs, mintUrl, amount };
}

/**
 * 일반 토큰 수령 (Coco 사용)
 * - P2PK가 아닌 일반 토큰
 */
export async function receiveToken(token: string): Promise<void> {
  const manager = await getCocoManager();

  // mint 등록 확인
  const decoded = getDecodedToken(token);
  const mintUrl = decoded.mint;

  const knownMints = await manager.mint.getAllMints();
  const isKnown = knownMints.some(m => m.mintUrl === mintUrl);
  if (!isKnown) {
    await manager.mint.addMint(mintUrl, { trusted: true });
  }

  await manager.wallet.receive(token);
}

/**
 * 토큰 전송 준비 (SendApi.prepareSend)
 * proof 예약 + 수수료 계산. 실행 전 수수료를 확인할 수 있다.
 * 이후 executeSendToken()으로 실행하거나 rollbackSendToken()으로 취소.
 */
export async function prepareSendToken(mintUrl: string, amount: number): Promise<{
  operationId: string;
  fee: number;
  needsSwap: boolean;
}> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, mintUrl);

  try {
    const prepared = await manager.send.prepareSend(mintUrl, amount);
    return { operationId: prepared.id, fee: prepared.fee, needsSwap: prepared.needsSwap };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Not enough funds')) {
      const { InsufficientBalanceError } = await import('@/core/errors/cashu');
      const balances = await manager.wallet.getBalances();
      const available = balances[mintUrl] || 0;

      if (available >= amount) {
        throw new InsufficientBalanceError(amount, available, err, 1);
      } else {
        throw new InsufficientBalanceError(amount, available, err);
      }
    }
    throw err;
  }
}

/**
 * 토큰 전송 실행 (SendApi.executePreparedSend)
 * prepareSendToken() 이후 호출하여 토큰을 생성한다.
 * P2PK 옵션 제공 시 cashu-ts로 추가 swap하여 P2PK 잠금 토큰 생성.
 *
 * 실행 후 ProofStateWatcher가 자동으로 proof 상태를 감시하여
 * 수령자가 토큰을 수령하면 send:finalized 이벤트를 발행한다.
 */
export async function executeSendToken(
  operationId: string,
  options?: { p2pkPubkey?: string; memo?: string }
): Promise<{ token: string }> {
  const manager = await getCocoManager();
  const { token } = await manager.send.executePreparedSend(operationId);
  const { getEncodedToken } = await import('@cashu/cashu-ts');

  if (options?.p2pkPubkey) {
    // P2PK lock: swap unlocked proofs into P2PK-locked proofs via cashu-ts
    const mintUrl = token.mint;
    const wallet = await getCashuWallet(mintUrl);
    const encodedUnlocked = getEncodedToken(token);
    const decoded = getDecodedToken(encodedUnlocked);

    let p2pkProofs: Proof[];
    let changeProofs: Proof[];
    try {
      const amount = decoded.proofs.reduce((sum, p) => sum + p.amount, 0);
      const result = await wallet.send(
        amount,
        decoded.proofs,
        { includeFees: true },
        { send: { type: 'p2pk', options: { pubkey: options.p2pkPubkey } } }
      );
      p2pkProofs = result.send;
      changeProofs = result.keep;
    } catch (swapError) {
      // P2PK swap failed — rollback the SDK operation to reclaim proofs
      console.error('[cashuService] P2PK swap failed, rolling back send operation:', swapError);
      try {
        await manager.send.rollback(operationId);
        console.log('[cashuService] Successfully rolled back send operation after P2PK swap failure');
      } catch (rollbackError) {
        // Rollback failed — try direct reclaim as fallback
        console.error('[cashuService] Rollback failed, trying direct reclaim:', rollbackError);
        try {
          await manager.wallet.receive(encodedUnlocked);
        } catch (reclaimError) {
          console.error('[cashuService] Failed to reclaim proofs (may need manual recovery):', reclaimError);
        }
      }
      throw swapError;
    }

    // Return change proofs (denomination rounding) to Coco
    if (changeProofs.length > 0) {
      try {
        const changeToken = getEncodedToken({ mint: mintUrl, proofs: changeProofs });
        await manager.wallet.receive(changeToken);
      } catch (changeError) {
        console.error('[cashuService] Failed to return change proofs to Coco:', changeError);
        console.error('[cashuService] Lost change proofs:', JSON.stringify(changeProofs));
      }
    }

    return { token: getEncodedToken({ mint: mintUrl, proofs: p2pkProofs, memo: options?.memo }) };
  }

  return { token: getEncodedToken({ ...token, memo: options?.memo }) };
}

/**
 * 토큰 전송 롤백 (SendApi.rollback)
 * pending 상태의 토큰을 회수한다. send:rolled-back 이벤트가 자동 발행된다.
 */
export async function rollbackSendToken(operationId: string): Promise<void> {
  const manager = await getCocoManager();
  await manager.send.rollback(operationId);
}

/**
 * @deprecated Use prepareSendToken() + executeSendToken() instead.
 * 토큰 전송 (send) — 레거시 API
 * P2PK 옵션 제공 시 cashu-ts로 swap하여 P2PK 잠금 토큰 생성
 */
export async function sendToken(
  mintUrl: string,
  amount: number,
  options?: { p2pkPubkey?: string; memo?: string }
): Promise<string> {
  const manager = await getCocoManager();

  await ensureMintTrusted(manager, mintUrl);
  let token: Token;
  try {
    token = await manager.wallet.send(mintUrl, amount);
  } catch (err) {
    // "Not enough funds" 에러를 정확한 InsufficientBalanceError로 변환
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Not enough funds')) {
      const { InsufficientBalanceError } = await import('@/core/errors/cashu');
      const balances = await manager.wallet.getBalances();
      const available = balances[mintUrl] || 0;

      if (available >= amount) {
        // 잔액 >= 금액이지만 swap 수수료 때문에 실패
        // 정확한 수수료는 라이브러리 내부에서만 계산 가능 → fee=1로 isFeeShortage만 활성화
        throw new InsufficientBalanceError(amount, available, err, 1);
      } else {
        // 순수 잔액 부족
        throw new InsufficientBalanceError(amount, available, err);
      }
    }
    throw err;
  }

  const { getEncodedToken } = await import('@cashu/cashu-ts');

  if (options?.p2pkPubkey) {
    // P2PK lock: swap Coco's unlocked proofs into P2PK-locked proofs via cashu-ts
    const wallet = await getCashuWallet(mintUrl);
    const encodedUnlocked = getEncodedToken(token);
    const decoded = getDecodedToken(encodedUnlocked);

    let p2pkProofs: Proof[];
    let changeProofs: Proof[];
    try {
      const result = await wallet.send(
        amount,
        decoded.proofs,
        { includeFees: true },
        { send: { type: 'p2pk', options: { pubkey: options.p2pkPubkey } } }
      );
      p2pkProofs = result.send;
      changeProofs = result.keep;
    } catch (swapError) {
      // P2PK swap failed — reclaim unlocked proofs back to Coco
      console.error('[cashuService] P2PK swap failed, reclaiming proofs:', swapError);
      try {
        await manager.wallet.receive(encodedUnlocked);
        console.log('[cashuService] Successfully reclaimed proofs after P2PK swap failure');
      } catch (reclaimError) {
        console.error('[cashuService] Failed to reclaim proofs (may need manual recovery):', reclaimError);
      }
      throw swapError;
    }

    // Return change proofs (denomination rounding) to Coco
    if (changeProofs.length > 0) {
      try {
        const changeToken = getEncodedToken({ mint: mintUrl, proofs: changeProofs });
        await manager.wallet.receive(changeToken);
      } catch (changeError) {
        // Change proofs exist but failed to save — log for manual recovery
        console.error('[cashuService] Failed to return change proofs to Coco:', changeError);
        console.error('[cashuService] Lost change proofs:', JSON.stringify(changeProofs));
      }
    }

    return getEncodedToken({ mint: mintUrl, proofs: p2pkProofs, memo: options?.memo });
  }

  return getEncodedToken({ ...token, memo: options?.memo });
}

/**
 * 잔액 조회
 */
export async function getBalances(): Promise<{ [mintUrl: string]: number }> {
  const manager = await getCocoManager();
  return manager.wallet.getBalances();
}


/**
 * Ensure mint is registered and trusted in Coco before operations
 */
async function ensureMintTrusted(manager: Awaited<ReturnType<typeof getCocoManager>>, mintUrl: string): Promise<void> {
  const mints = await manager.mint.getAllMints();
  const exists = mints.some((m) => m.mintUrl === mintUrl);
  if (!exists) {
    await manager.mint.addMint(mintUrl, { trusted: true });
  }
}

/**
 * Mint Quote 생성 (입금)
 */
export async function createMintQuote(
  mintUrl: string,
  amount: number
): Promise<{ quote: string; request: string; expiry: number }> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, mintUrl);
  const op = await manager.ops.mint.prepare({ mintUrl, amount, method: 'bolt11', methodData: {} });
  return {
    quote: op.quoteId,
    request: op.request,
    expiry: op.expiry,
  };
}

/**
 * Mint Quote 상환 (proofs 발급)
 * Returns the redeemed amount for confirmation
 */
export async function redeemMintQuote(
  mintUrl: string,
  quoteId: string,
  expectedAmount: number
): Promise<Proof[]> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, mintUrl);

  // Get balance before redemption
  const balancesBefore = await manager.wallet.getBalances();
  const balanceBefore = balancesBefore[mintUrl] || 0;

  // Redeem the quote (proofs are stored internally by Coco)
  const mintOp = await manager.ops.mint.getByQuote(mintUrl, quoteId);
  if (!mintOp) throw new Error(`Mint operation not found for quote ${quoteId}`);
  await manager.ops.mint.execute(mintOp);

  // Get balance after redemption
  const balancesAfter = await manager.wallet.getBalances();
  const balanceAfter = balancesAfter[mintUrl] || 0;

  // Calculate actual redeemed amount
  const redeemedAmount = balanceAfter - balanceBefore;
  console.log(`[Coco] Redeemed ${redeemedAmount} sats (expected: ${expectedAmount})`);

  // Return empty proofs array - Coco manages proofs internally
  // The caller can use expectedAmount or calculate from balance change
  return [];
}

/**
 * Melt 준비 (2-phase: prepare)
 * proof를 reserve하고 quote를 생성한다. 실패 시 rollbackMelt로 복구.
 */
export async function prepareMelt(
  mintUrl: string,
  invoice: string
): Promise<{
  operationId: string;
  quoteId: string;
  amount: number;
  fee_reserve: number;
  swap_fee: number;
}> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, mintUrl);
  const operation = await manager.quotes.prepareMeltBolt11(mintUrl, invoice);
  return {
    operationId: operation.id,
    quoteId: operation.quoteId,
    amount: operation.amount,
    fee_reserve: operation.fee_reserve,
    swap_fee: operation.swap_fee,
  };
}

/**
 * Melt 실행 (2-phase: execute)
 * prepare된 operation을 실행하여 Lightning 결제를 수행한다.
 */
export async function executeMelt(
  operationId: string
): Promise<{ state: string }> {
  const manager = await getCocoManager();
  const result = await manager.quotes.executeMelt(operationId);
  return { state: result.state };
}

/**
 * Melt 롤백
 * prepare 또는 실패한 operation의 reserved proof를 복구한다.
 */
export async function rollbackMelt(
  operationId: string,
  reason?: string
): Promise<void> {
  const manager = await getCocoManager();
  await manager.quotes.rollbackMelt(operationId, reason);
}

/**
 * Pending melt operation 목록 조회 (recovery용)
 */
export async function getPendingMeltOperations(): Promise<
  Array<{ id: string; mintUrl: string; quoteId: string; amount: number; fee_reserve: number; createdAt: number }>
> {
  const manager = await getCocoManager();
  const ops = await manager.quotes.getPendingMeltOperations();
  return ops.map(op => ({
    id: op.id,
    mintUrl: op.mintUrl,
    quoteId: 'quoteId' in op ? (op as { quoteId: string }).quoteId : '',
    amount: 'amount' in op ? (op as { amount: number }).amount : 0,
    fee_reserve: 'fee_reserve' in op ? (op as { fee_reserve: number }).fee_reserve : 0,
    createdAt: op.createdAt,
  }));
}

/**
 * 지갑 복구
 */
export async function restoreWallet(mintUrl: string): Promise<void> {
  const manager = await getCocoManager();
  await manager.wallet.restore(mintUrl);
}

/**
 * Mint 추가
 */
export async function addMint(mintUrl: string): Promise<void> {
  const manager = await getCocoManager();
  await manager.mint.addMint(mintUrl, { trusted: true });
}

/**
 * Wallet 캐시 초기화
 */
export function clearWalletCache(): void {
  walletCache.clear();
}

/**
 * Check melt quote status (for Lightning send recovery)
 * Uses coco API to avoid dual cashu-ts version issues
 */
export async function checkMeltQuoteStatus(
  mintUrl: string,
  quoteId: string
): Promise<{ state: string; paid: boolean }> {
  const manager = await getCocoManager();
  const result = await manager.quotes.checkPendingMeltByQuote(mintUrl, quoteId);
  if (!result) return { state: 'UNKNOWN', paid: false };
  return { state: result, paid: result === 'finalize' };
}

/**
 * Recover pending melt operations via coco's 2-phase API.
 * Also handles legacy pendingMelts table entries from before the migration.
 */
export async function recoverPendingMelts(): Promise<{
  recovered: number;
  failed: number;
}> {
  const manager = await getCocoManager();
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();

  let recovered = 0;
  let failed = 0;
  const maxAge = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // 1. Recover coco pending melt operations (new 2-phase API)
  try {
    const pendingOps = await manager.quotes.getPendingMeltOperations();
    console.log(`[Recovery] Found ${pendingOps.length} pending melt operations`);

    for (const op of pendingOps) {
      try {
        const result = await manager.quotes.checkPendingMelt(op.id);
        if (result === 'finalize') {
          // Payment completed — coco handles finalization internally
          recovered++;
          console.log(`[Recovery] Melt operation ${op.id} finalized`);
        } else if (result === 'rollback') {
          // Payment failed — rollback to reclaim proofs
          await manager.quotes.rollbackMelt(op.id, 'recovery: payment failed');
          recovered++;
          console.log(`[Recovery] Melt operation ${op.id} rolled back`);
        } else if (op.createdAt && (now - op.createdAt) > maxAge) {
          // Still pending after 24h — force rollback
          console.warn(`[Recovery] Melt operation ${op.id} stuck >24h, rolling back`);
          await manager.quotes.rollbackMelt(op.id, 'recovery: expired');
          failed++;
        }
        // 'stay_pending': leave for next recovery cycle
      } catch (error) {
        console.error(`[Recovery] Failed to recover melt operation ${op.id}:`, error);
        failed++;
      }
    }
  } catch (error) {
    console.error('[Recovery] Failed to get pending melt operations:', error);
  }

  // 2. Clean up legacy pendingMelts table entries
  try {
    const legacyMelts = await db.pendingMelts.toArray();
    for (const melt of legacyMelts) {
      if (now - melt.createdAt > maxAge) {
        await db.pendingMelts.delete(melt.meltQuoteId);
        console.log(`[Recovery] Cleaned up legacy pending melt: ${melt.meltQuoteId}`);
      }
    }
  } catch (error) {
    console.error('[Recovery] Failed to clean up legacy pending melts:', error);
  }

  console.log(`[Recovery] Melts: ${recovered} recovered, ${failed} failed`);
  return { recovered, failed };
}

/**
 * Recover pending send tokens (Ecash sends that may not have completed)
 *
 * Three recovery paths:
 * 1. SDK operations (operationId exists): SDK's recoverPendingOperations() handles
 *    auto-finalize (proofs spent) or resumes watching (proofs pending).
 *    sendTokenObserver picks up the resulting events.
 * 2. Legacy phase 1 (no operationId, no token): Crash during token creation.
 *    Record as failed send.
 * 3. Legacy phase 2 (no operationId, token exists): Token created but tx not saved.
 *    Try reclaim; if spent, record as completed send.
 */
export async function recoverPendingSendTokens(): Promise<{
  reclaimed: number;
  recorded: number;
}> {
  const manager = await getCocoManager();
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();

  // 1. SDK가 pending send operation 자동 복구
  //    → finalize if proofs spent, keep watching if still pending
  //    → send:finalized / send:rolled-back 이벤트 → sendTokenObserver가 처리
  try {
    await manager.send.recoverPendingOperations();
    console.log('[Recovery] SDK recoverPendingOperations completed');
  } catch (error) {
    console.error('[Recovery] SDK recoverPendingOperations failed:', error);
  }

  const pendingTokens = await db.pendingSendTokens.toArray();
  if (pendingTokens.length === 0) return { reclaimed: 0, recorded: 0 };

  console.log(`[Recovery] Found ${pendingTokens.length} pending send tokens`);

  // Separate SDK-managed vs legacy
  const sdkTokens = pendingTokens.filter(p => p.operationId);
  const legacyTokens = pendingTokens.filter(p => !p.operationId);

  let reclaimed = 0;
  let recorded = 0;

  // 2. SDK-managed: clean up already finalized/rolled-back entries
  for (const pending of sdkTokens) {
    try {
      const op = await manager.send.getOperation(pending.operationId!);
      if (op && (op.state === 'finalized' || op.state === 'rolled_back')) {
        // sendTokenObserver should have handled this, but clean up just in case
        await db.pendingSendTokens.delete(pending.id);
        console.log(`[Recovery] Cleaned up SDK send token (${op.state}): ${pending.id}`);
      }
      // 'pending' state: ProofStateWatcher is monitoring, leave it
    } catch (error) {
      console.error(`[Recovery] Failed to check SDK send operation ${pending.operationId}:`, error);
      // ecash proofs never expire; keep for future retry
    }
  }

  // 3. Legacy recovery (no operationId)
  const { getTransactionRepo } = await import('@/data/repositories/transaction.repository');
  for (const pending of legacyTokens) {
    const existingTx = await db.transactions.get(pending.id);

    // 정상 pending ecash-token은 스킵
    if (existingTx && existingTx.status === 'pending' && existingTx.type === 'ecash-token') {
      console.log(`[Recovery] Skipping normal pending ecash-token: ${pending.id}`);
      continue;
    }

    // Phase 1: token was never created (crash during cocoSendToken)
    if (!pending.token) {
      console.warn(`[Recovery] Send intent without token: ${pending.id} (${pending.amount} sats)`);
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

    // Phase 2: token exists but tx wasn't saved (crash after cocoSendToken)
    try {
      await receiveToken(pending.token);
      if (existingTx) {
        const { markSendReclaimed } = await import('@/coco/sendTokenObserver');
        await markSendReclaimed(pending.id);
      } else {
        // tx가 없는 경우 (crash 직후) — receive 거래만 생성
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
      console.log(`[Recovery] Reclaimed ecash token: ${pending.amount} sats`);
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
        console.log(`[Recovery] Created send tx for spent token: ${pending.amount} sats`);
      } else {
        // Transient error (network, mint down) — keep for future retry
        console.error(`[Recovery] Failed to recover send token ${pending.id}:`, error);
      }
    }
  }

  console.log(`[Recovery] Send tokens: ${reclaimed} reclaimed, ${recorded} recorded`);
  return { reclaimed, recorded };
}

/**
 * Get active (non-expired) pending quotes from Coco's internal DB
 * Single source of truth for pending quote filtering — consolidates the 24h filter
 */
export async function getActivePendingQuotes(): Promise<PendingQuote[]> {
  const quotes = await getPendingMintQuotes();
  const now = Date.now();

  return quotes
    .filter((q) => {
      // Filter out expired quotes (expiry is Unix timestamp in seconds)
      if (q.expiry && q.expiry * 1000 < now) return false;
      // Filter out quotes older than 24h (estimate from expiry — mints typically set 10-15min expiry)
      // Since Coco doesn't track createdAt, rely on expiry for age filtering
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

/**
 * Try to recover a single quote by quoteId
 */
async function tryRecoverQuote(
  quoteId: string,
  mintUrl: string,
  amount: number
): Promise<{ status: 'recovered' | 'failed' | 'not_paid' | 'already_issued'; error?: string }> {
  try {
    console.log(`[Recovery] Trying to recover quote ${quoteId} for ${amount} sats from ${mintUrl}`);

    // Get cashu-ts wallet for this mint
    const wallet = await getCashuWallet(mintUrl);

    // Check quote status first
    const quoteStatus = await wallet.checkMintQuote(quoteId);
    console.log(`[Recovery] Quote ${quoteId} status:`, quoteStatus);

    if (quoteStatus.state === 'ISSUED') {
      console.log(`[Recovery] Quote ${quoteId} already issued`);
      return { status: 'already_issued' };
    }

    if (quoteStatus.state !== 'PAID') {
      console.log(`[Recovery] Quote ${quoteId} not paid, skipping`);
      return { status: 'not_paid' };
    }

    // Mint the tokens using cashu-ts directly
    const proofs = await wallet.mintProofs(amount, quoteId);
    console.log(`[Recovery] Minted ${proofs.length} proofs for quote ${quoteId}`);

    // Store the proofs via Coco by creating a token and receiving it
    const { getEncodedToken } = await import('@cashu/cashu-ts');
    const token = getEncodedToken({
      mint: mintUrl,
      proofs,
    });

    // Receive via Coco to store properly
    await receiveToken(token);

    console.log(`[Recovery] Successfully recovered quote ${quoteId}`);
    return { status: 'recovered' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Recovery] Failed to recover quote ${quoteId}:`, error);

    // Check if already issued
    if (errorMsg.includes('already issued')) {
      return { status: 'already_issued' };
    }

    return { status: 'failed', error: errorMsg };
  }
}

/**
 * Recover pending quotes
 * Coco-managed quotes는 MintQuoteWatcher가 단독 처리 (race condition 방지)
 * 여기서는 legacy pending transactions만 복구
 */
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
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  // Coco-managed quotes: MintQuoteWatcher가 watchExistingPendingOnStart로 처리
  // 수동 recovery(tryRecoverQuote)와 watcher가 동시에 같은 quote를 redeem하면
  // "already issued" 에러 발생 → 이벤트 유실 → 잔액 미갱신
  // → watcher 단독 경로로 통일

  // Legacy: pending transactions에 남아있는 Lightning receive 복구
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
      console.log(`[Recovery] Marking stale pending tx as failed (>24h): ${tx.id}`);
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
