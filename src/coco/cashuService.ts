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
 * 토큰 전송 (send)
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
  const quote = await manager.quotes.createMintQuote(mintUrl, amount);
  return {
    quote: quote.quote,
    request: quote.request,
    expiry: quote.expiry,
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
  await manager.quotes.redeemMintQuote(mintUrl, quoteId);

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
 * Two phases of pending records:
 * - token=undefined: Crash during cocoSendToken. Proofs may or may not be consumed.
 *   We can't recover the token, but we record the potential loss.
 * - token=set: Token was created but tx record wasn't saved.
 *   Try to reclaim (receiveToken). If "already spent", record as send.
 */
export async function recoverPendingSendTokens(): Promise<{
  reclaimed: number;
  recorded: number;
}> {
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();

  const pendingTokens = await db.pendingSendTokens.toArray();
  if (pendingTokens.length === 0) return { reclaimed: 0, recorded: 0 };

  console.log(`[Recovery] Found ${pendingTokens.length} pending send tokens`);
  let reclaimed = 0;
  let recorded = 0;
  const maxAge = 24 * 60 * 60 * 1000;

  for (const pending of pendingTokens) {
    // Phase 1 record: token was never created (crash during cocoSendToken)
    if (!pending.token) {
      console.warn(`[Recovery] Send intent without token: ${pending.id} (${pending.amount} sats)`);
      // Proofs may have been consumed by Coco without returning a token.
      // We cannot recover - record as failed send so the user knows.
      const existingTx = await db.transactions.get(pending.id);
      if (!existingTx) {
        await db.transactions.put({
          id: pending.id,
          direction: 'send',
          type: 'ecash',
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

    // Phase 2 record: token exists but tx wasn't saved
    try {
      // Try to reclaim the token (receive it back)
      await receiveToken(pending.token);
      await db.pendingSendTokens.delete(pending.id);
      reclaimed++;
      console.log(`[Recovery] Reclaimed ecash token: ${pending.amount} sats`);
    } catch (error) {
      const errorMsg = String(error).toLowerCase();
      if (errorMsg.includes('already spent') || errorMsg.includes('token already spent')) {
        // Token was sent to recipient - create send transaction record
        const existingTx = await db.transactions.get(pending.id);
        if (!existingTx) {
          await db.transactions.put({
            id: pending.id,
            direction: 'send',
            type: 'ecash',
            amount: pending.amount,
            mintUrl: pending.mintUrl,
            status: 'completed',
            createdAt: pending.createdAt,
            completedAt: Date.now(),
          });
        }
        await db.pendingSendTokens.delete(pending.id);
        recorded++;
        console.log(`[Recovery] Created send tx for spent token: ${pending.amount} sats`);
      } else {
        console.error(`[Recovery] Failed to recover send token ${pending.id}:`, error);
        // Clean up old entries that can't be recovered
        if (Date.now() - pending.createdAt > maxAge) {
          await db.pendingSendTokens.delete(pending.id);
        }
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
