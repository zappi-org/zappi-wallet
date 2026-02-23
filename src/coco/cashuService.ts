/**
 * Cashu Service - Coco + P2PK 하이브리드
 *
 * Coco는 아직 P2PK receive 옵션을 노출하지 않아서,
 * P2PK 토큰 수령은 cashu-ts 직접 사용 후 Coco 저장소에 저장.
 *
 * 향후 Coco에 P2PK 지원 PR 후 이 레이어 제거 가능.
 */

import { Wallet, Mint, getDecodedToken, type Proof } from '@cashu/cashu-ts';
import { getCocoManager } from './manager';

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
  const token = await manager.wallet.send(mintUrl, amount);
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
 * Mint Quote 생성 (입금)
 */
export async function createMintQuote(
  mintUrl: string,
  amount: number
): Promise<{ quote: string; request: string; expiry: number }> {
  const manager = await getCocoManager();
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
 * Melt Quote 생성 (출금 견적)
 */
export async function createMeltQuote(
  mintUrl: string,
  invoice: string
): Promise<{
  quote: string;
  amount: number;
  fee_reserve: number;
}> {
  const manager = await getCocoManager();
  const quote = await manager.quotes.createMeltQuote(mintUrl, invoice);
  return {
    quote: quote.quote,
    amount: quote.amount,
    fee_reserve: quote.fee_reserve,
  };
}

/**
 * Melt Quote 결제 (Lightning 출금)
 */
export async function payMeltQuote(
  mintUrl: string,
  quoteId: string
): Promise<void> {
  const manager = await getCocoManager();
  await manager.quotes.payMeltQuote(mintUrl, quoteId);
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
 */
export async function checkMeltQuoteStatus(
  mintUrl: string,
  quoteId: string
): Promise<{ state: string; paid: boolean }> {
  const wallet = await getCashuWallet(mintUrl);
  const quote = await wallet.checkMeltQuoteBolt11(quoteId);
  return { state: quote.state, paid: quote.state === 'PAID' };
}

/**
 * Recover pending melt quotes (Lightning sends that may have completed without a transaction record)
 */
export async function recoverPendingMelts(): Promise<{
  recovered: number;
  failed: number;
}> {
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();

  const pendingMelts = await db.pendingMelts.toArray();
  if (pendingMelts.length === 0) return { recovered: 0, failed: 0 };

  console.log(`[Recovery] Found ${pendingMelts.length} pending melts`);
  let recovered = 0;
  let failed = 0;
  const maxAge = 24 * 60 * 60 * 1000;

  for (const melt of pendingMelts) {
    try {
      const { state, paid } = await checkMeltQuoteStatus(melt.mintUrl, melt.meltQuoteId);

      if (paid) {
        // Payment was sent - create transaction record
        const transactionId = `tx-melt-${melt.meltQuoteId}`;
        const existingTx = await db.transactions.get(transactionId);
        if (!existingTx) {
          await db.transactions.put({
            id: transactionId,
            direction: 'send',
            type: 'lightning',
            amount: melt.amount,
            mintUrl: melt.mintUrl,
            status: 'completed',
            createdAt: melt.createdAt,
            completedAt: Date.now(),
            metadata: {
              fee: melt.fee,
              destination: melt.destination,
            },
          });
        }
        await db.pendingMelts.delete(melt.meltQuoteId);
        recovered++;
        console.log(`[Recovery] Recovered melt ${melt.meltQuoteId}: ${melt.amount} sats`);
      } else if (state === 'UNPAID') {
        // Payment was NOT sent - clean up if old
        if (Date.now() - melt.createdAt > maxAge) {
          await db.pendingMelts.delete(melt.meltQuoteId);
        }
      } else if (Date.now() - melt.createdAt > maxAge) {
        // PENDING or unknown state: clean up if older than maxAge
        // Mint should resolve within 24h; if not, it's stuck
        console.warn(`[Recovery] Melt ${melt.meltQuoteId} stuck in state '${state}' for >24h, removing`);
        await db.pendingMelts.delete(melt.meltQuoteId);
        failed++;
      }
    } catch (error) {
      console.error(`[Recovery] Failed to check melt ${melt.meltQuoteId}:`, error);
      if (Date.now() - melt.createdAt > maxAge) {
        await db.pendingMelts.delete(melt.meltQuoteId);
      }
      failed++;
    }
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
 * Recover lost quotes using cashu-ts directly
 * This is for quotes created with cashu-ts but not tracked by Coco
 * Checks both pendingQuotes table AND pending transactions
 */
export async function recoverPendingQuotes(): Promise<{
  recovered: number;
  failed: number;
  details: Array<{ quoteId: string; amount: number; status: 'recovered' | 'failed' | 'not_paid' | 'already_issued'; error?: string }>;
}> {
  const { getDatabase } = await import('@/data/database/schema');
  const db = getDatabase();

  const results: Array<{ quoteId: string; amount: number; status: 'recovered' | 'failed' | 'not_paid' | 'already_issued'; error?: string }> = [];
  let recovered = 0;
  let failed = 0;
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  // Set to track processed quoteIds to avoid duplicates
  const processedQuoteIds = new Set<string>();

  // 1. First check pendingQuotes table
  const pendingQuotes = await db.pendingQuotes.toArray();
  console.log(`[Recovery] Found ${pendingQuotes.length} pending quotes in pendingQuotes table`);

  for (const quote of pendingQuotes) {
    processedQuoteIds.add(quote.quoteId);
    const transactionId = `tx-${quote.quoteId}`;

    // Clean up expired quotes (expiresAt is set by mint)
    if (quote.expiresAt && quote.expiresAt < now) {
      console.log(`[Recovery] Removing expired quote: ${quote.quoteId}`);
      await db.pendingQuotes.delete(quote.quoteId);
      continue;
    }

    // Clean up quotes older than maxAge (even without expiresAt)
    if (quote.createdAt && (now - quote.createdAt) > maxAge) {
      console.log(`[Recovery] Removing stale quote (>24h): ${quote.quoteId}`);
      await db.pendingQuotes.delete(quote.quoteId);
      failed++;
      continue;
    }

    const result = await tryRecoverQuote(quote.quoteId, quote.mintUrl, quote.amount);
    results.push({ quoteId: quote.quoteId, amount: quote.amount, ...result });

    if (result.status === 'recovered') {
      recovered++;
      // Create completed transaction if it doesn't exist
      const existingTx = await db.transactions.get(transactionId);
      if (!existingTx) {
        await db.transactions.put({
          id: transactionId,
          direction: 'receive',
          type: 'lightning',
          amount: quote.amount,
          mintUrl: quote.mintUrl,
          status: 'completed',
          createdAt: quote.createdAt || Date.now(),
          completedAt: Date.now(),
          metadata: { quoteId: quote.quoteId },
        });
      } else if (existingTx.status !== 'completed') {
        await db.transactions.update(transactionId, { status: 'completed', completedAt: Date.now() });
      }
      await db.pendingQuotes.delete(quote.quoteId);
    } else if (result.status === 'already_issued') {
      // Token was already issued - ensure transaction exists as completed
      const existingTx = await db.transactions.get(transactionId);
      if (!existingTx) {
        await db.transactions.put({
          id: transactionId,
          direction: 'receive',
          type: 'lightning',
          amount: quote.amount,
          mintUrl: quote.mintUrl,
          status: 'completed',
          createdAt: quote.createdAt || Date.now(),
          completedAt: Date.now(),
          metadata: { quoteId: quote.quoteId },
        });
      } else if (existingTx.status !== 'completed') {
        await db.transactions.update(transactionId, { status: 'completed', completedAt: Date.now() });
      }
      await db.pendingQuotes.delete(quote.quoteId);
    } else if (result.status === 'failed') {
      // Always delete failed quotes — they can't be recovered
      await db.pendingQuotes.delete(quote.quoteId);
      failed++;
    }
    // not_paid: quote is still valid and not yet paid — leave it for next recovery cycle
    // (bounded by expiresAt and maxAge checks above)
  }

  // 2. Also check pending transactions for Lightning receive
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
      // Transaction without quoteId can't be recovered — clean up if old
      if (tx.createdAt && (now - tx.createdAt) > maxAge) {
        await db.transactions.update(tx.id, { status: 'failed' });
      }
      continue;
    }

    // Skip if already processed
    if (processedQuoteIds.has(quoteId)) {
      continue;
    }

    // Clean up stale pending transactions
    if (tx.createdAt && (now - tx.createdAt) > maxAge) {
      console.log(`[Recovery] Marking stale pending tx as failed (>24h): ${tx.id}`);
      await db.transactions.update(tx.id, { status: 'failed' });
      failed++;
      continue;
    }

    processedQuoteIds.add(quoteId);

    const result = await tryRecoverQuote(quoteId, mintUrl, tx.amount);
    results.push({ quoteId, amount: tx.amount, ...result });

    if (result.status === 'recovered') {
      recovered++;
      await db.transactions.update(tx.id, { status: 'completed', completedAt: Date.now() });
    } else if (result.status === 'already_issued') {
      await db.transactions.update(tx.id, { status: 'completed', completedAt: Date.now() });
    } else if (result.status === 'failed') {
      // Failed to recover — mark tx as failed so it doesn't stay pending forever
      await db.transactions.update(tx.id, { status: 'failed' });
      failed++;
    }
    // not_paid: leave as pending — bounded by maxAge check above
  }

  console.log(`[Recovery] Complete: ${recovered} recovered, ${failed} failed`);
  return { recovered, failed, details: results };
}
