/**
 * Cashu Service — Thin wrapper over CashuBackend
 *
 * Phase 3a: 모든 Coco SDK 호출이 CashuBackend로 이전됨.
 * 이 파일은 기존 호출자를 위한 호환 레이어.
 * Phase 7에서 삭제 예정.
 */

import * as backend from '@/modules/cashu/internal/cashu-backend';
import type { Proof } from '@cashu/cashu-ts';


// ─── Token 수신 ───

/**
 * P2PK 토큰 수령.
 * Coco RC50의 ops.receive가 P2PK unlock을 내부 처리한다.
 */
export async function receiveP2PKToken(
  token: string,
  _privateKey: string,
): Promise<{ proofs: Proof[]; mintUrl: string; amount: number }> {
  const { getDecodedToken } = await import('@cashu/cashu-ts');
  const decoded = getDecodedToken(token);
  const amount = decoded.proofs.reduce((sum, p) => sum + p.amount, 0);

  await backend.receiveToken(token);

  return { proofs: [], mintUrl: decoded.mint, amount };
}

export async function receiveToken(token: string): Promise<void> {
  await backend.receiveToken(token);
}

// ─── Token 전송 ───

export async function prepareSendToken(mintUrl: string, amount: number): Promise<{
  operationId: string;
  fee: number;
  needsSwap: boolean;
}> {
  return backend.prepareSend({ mintUrl, amount });
}

/**
 * P2PK 옵션은 무시됨 — prepare 시점에 CashuBackend.prepareSend({ target })으로 지정해야 한다.
 */
export async function executeSendToken(
  operationId: string,
  options?: { p2pkPubkey?: string; memo?: string },
): Promise<{ token: string }> {
  if (options?.p2pkPubkey) {
    console.warn('[cashuService] p2pkPubkey in executeSendToken is ignored. Use backend.prepareSend({ target: { type: "p2pk", pubkey } }) instead.');
  }
  return backend.executeSend(operationId, { memo: options?.memo });
}

export async function rollbackSendToken(operationId: string): Promise<void> {
  return backend.rollbackSend(operationId);
}

/**
 * @deprecated Use prepareSendToken() + executeSendToken() instead.
 */
export async function sendToken(
  mintUrl: string,
  amount: number,
  options?: { p2pkPubkey?: string; memo?: string },
): Promise<string> {
  const lockingCondition = options?.p2pkPubkey
    ? { kind: 'P2PK' as const, data: options.p2pkPubkey }
    : undefined;
  const prepared = await backend.prepareSend({ mintUrl, amount, lockingCondition });
  const { token } = await backend.executeSend(prepared.operationId, { memo: options?.memo });
  return token;
}

// ─── 잔액 ───

export async function getBalances(): Promise<{ [mintUrl: string]: number }> {
  return backend.getBalances();
}

// ─── Mint (Lightning 수신) ───

export async function createMintQuote(
  mintUrl: string,
  amount: number,
): Promise<{ quote: string; request: string; expiry: number }> {
  return backend.createMintQuote(mintUrl, amount);
}

export async function redeemMintQuote(
  mintUrl: string,
  quoteId: string,
  expectedAmount: number,
): Promise<Proof[]> {
  await backend.redeemMintQuote(mintUrl, quoteId, expectedAmount);
  return [];
}

// ─── Melt (Lightning 전송) ───

export async function prepareMelt(
  mintUrl: string,
  invoice: string,
): Promise<{
  operationId: string;
  quoteId: string;
  amount: number;
  fee_reserve: number;
  swap_fee: number;
}> {
  return backend.prepareMelt(mintUrl, invoice);
}

export async function executeMelt(operationId: string): Promise<{ state: string }> {
  return backend.executeMelt(operationId);
}

export async function rollbackMelt(operationId: string, reason?: string): Promise<void> {
  return backend.rollbackMelt(operationId, reason);
}

// ─── 조회 ───

export async function getPendingMeltOperations(): Promise<
  Array<{ id: string; mintUrl: string; quoteId: string; amount: number; fee_reserve: number; createdAt: number }>
> {
  return backend.getPendingMeltOperations();
}

export async function checkMeltQuoteStatus(
  mintUrl: string,
  quoteId: string,
): Promise<{ state: string; paid: boolean }> {
  return backend.checkMeltQuoteStatus(mintUrl, quoteId);
}

// getActivePendingQuotes removed — use cashu-backend.getActivePendingQuotes() directly

// ─── Wallet 관리 ───

export async function restoreWallet(mintUrl: string): Promise<void> {
  return backend.restoreWallet(mintUrl);
}

export async function addMint(mintUrl: string): Promise<void> {
  return backend.addMint(mintUrl);
}

export function clearWalletCache(): void {
  // cashu-ts Wallet 캐시는 더 이상 사용하지 않음
  // 하위 호환을 위해 빈 함수 유지
}

// ─── Recovery (포트 경유 — cashu-recovery.ts 위임) ───

export async function recoverPendingMelts(): Promise<{ recovered: number; failed: number }> {
  const { recoverPendingMelts } = await import('@/modules/cashu/internal/cashu-recovery')
  const { getMeltRecoveryOps } = await import('@/modules/cashu/internal/cashu-backend')
  const { DexiePendingOperationRepository } = await import('@/adapters/storage/dexie/dexie-pending-operation.repository')
  return recoverPendingMelts({
    pendingOpRepo: new DexiePendingOperationRepository(),
    meltOps: await getMeltRecoveryOps(),
  })
}

export async function recoverPendingSendTokens(): Promise<{ reclaimed: number; recorded: number }> {
  const { recoverPendingSendTokens } = await import('@/modules/cashu/internal/cashu-recovery')
  const { getSendRecoveryOps } = await import('@/modules/cashu/internal/cashu-backend')
  const { DexiePendingOperationRepository } = await import('@/adapters/storage/dexie/dexie-pending-operation.repository')
  const { DexieTransactionRepository } = await import('@/adapters/storage/dexie/dexie-transaction.repository')
  return recoverPendingSendTokens({
    pendingOpRepo: new DexiePendingOperationRepository(),
    txRepo: new DexieTransactionRepository(),
    sendOps: await getSendRecoveryOps(),
    receiveToken: async (token: string) => backend.receiveToken(token),
  })
}

export async function recoverPendingQuotes(): Promise<{
  recovered: number;
  failed: number;
  expired: number;
}> {
  const { recoverPendingQuotes } = await import('@/modules/cashu/internal/cashu-recovery')
  const { getQuoteRecoveryOps } = await import('@/modules/cashu/internal/cashu-backend')
  const { DexiePendingOperationRepository } = await import('@/adapters/storage/dexie/dexie-pending-operation.repository')
  const { DexieTransactionRepository } = await import('@/adapters/storage/dexie/dexie-transaction.repository')
  return recoverPendingQuotes({
    pendingOpRepo: new DexiePendingOperationRepository(),
    txRepo: new DexieTransactionRepository(),
    quoteOps: await getQuoteRecoveryOps(),
  })
}
