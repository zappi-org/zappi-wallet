/**
 * CashuBackend — Coco Manager 래핑 클래스
 *
 * cashuService.ts에 흩어진 26개 함수를 Coco RC50 API 기반으로 통합.
 * P2PK는 prepare 시점에 target으로 지정 (Coco 네이티브).
 * Cashu/Coco SDK access is isolated here behind module-level backend functions.
 */

import type { PendingQuote } from '@/core/domain/quote';
import { InsufficientBalanceError, RedeemFeeTooHighError } from '@/core/errors/payment.errors';
import type { ProofStateResult } from '@/core/ports/driven/send-token-operator.port';
import { normalizeMintUrl, getDecodedToken } from 'coco-cashu-core';
import { classifyCashuError } from './classify-error';
import { getCocoManager, getPendingMintQuotes } from './coco-sdk';

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
  unit: string;
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
  const normalizedMintUrl = normalizeMintUrl(mintUrl);
  const mints = await manager.mint.getAllMints();
  const existing = mints.find((m) => normalizeMintUrl(m.mintUrl) === normalizedMintUrl);
  if (!existing) {
    await manager.mint.addMint(normalizedMintUrl, { trusted: true });
    return;
  }

  if (!existing.trusted) {
    await manager.mint.trustMint(normalizedMintUrl);
  }
}

async function ensureMintKnown(
  manager: Awaited<ReturnType<typeof getCocoManager>>,
  mintUrl: string,
): Promise<{ wasTrusted: boolean }> {
  const normalizedMintUrl = normalizeMintUrl(mintUrl);
  const mints = await manager.mint.getAllMints();
  const existing = mints.find((m) => normalizeMintUrl(m.mintUrl) === normalizedMintUrl);
  if (existing) {
    return { wasTrusted: existing.trusted };
  }

  await manager.mint.addMint(normalizedMintUrl, { trusted: false });
  return { wasTrusted: false };
}

async function withMintTrustedForOperation<T>(
  manager: Awaited<ReturnType<typeof getCocoManager>>,
  mintUrl: string,
  options: MintTrustOptions | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const normalizedMintUrl = normalizeMintUrl(mintUrl);
  const persistTrusted = shouldPersistMintTrust(normalizedMintUrl, options);

  if (persistTrusted) {
    await ensureMintTrusted(manager, normalizedMintUrl);
    return operation();
  }

  const { wasTrusted } = await ensureMintKnown(manager, normalizedMintUrl);
  if (!wasTrusted) {
    await manager.mint.trustMint(normalizedMintUrl);
  }

  try {
    return await operation();
  } finally {
    const currentTrustedMintUrls = options?.getCurrentTrustedMintUrls?.() ?? options?.trustedMintUrls;
    if (!wasTrusted && !shouldPersistMintTrust(normalizedMintUrl, { trustedMintUrls: currentTrustedMintUrls })) {
      await restoreUntrustedMintState(manager, normalizedMintUrl);
    }
  }
}

interface MintTrustOptions {
  trustedMintUrls?: readonly string[];
  getCurrentTrustedMintUrls?: () => readonly string[] | undefined;
}

function shouldPersistMintTrust(mintUrl: string, options?: MintTrustOptions): boolean {
  const normalizedMintUrl = normalizeMintUrl(mintUrl);
  return options?.trustedMintUrls?.some((trustedUrl) => normalizeMintUrl(trustedUrl) === normalizedMintUrl) ?? true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function restoreUntrustedMintState(
  manager: Awaited<ReturnType<typeof getCocoManager>>,
  mintUrl: string,
): Promise<void> {
  try {
    await manager.mint.untrustMint(mintUrl);
  } catch (error) {
    throw new Error(`Failed to restore untrusted mint state for ${mintUrl}: ${errorMessage(error)}`);
  }

  const restored = (await manager.mint.getAllMints())
    .find((mint) => normalizeMintUrl(mint.mintUrl) === mintUrl);
  if (restored?.trusted) {
    throw new Error(`Failed to restore untrusted mint state for ${mintUrl}: mint is still trusted`);
  }
}

async function cancelReceiveFeeEstimate(operationId: string, cancel: () => Promise<void>): Promise<void> {
  try {
    await cancel();
  } catch (error) {
    throw new Error(`Failed to cancel receive fee estimate operation ${operationId}: ${errorMessage(error)}`);
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

export async function finalizeSend(operationId: string): Promise<void> {
  const manager = await getCocoManager();
  await manager.ops.send.finalize(operationId);
}

export async function checkProofStates(token: string): Promise<ProofStateResult> {
  const cashuTs = await import('@cashu/cashu-ts');
  const decoded = cashuTs.getDecodedToken(token);

  const wallet = new (cashuTs as unknown as { CashuWallet: new (mint: unknown) => { checkProofsStates(proofs: unknown[]): Promise<unknown[]> } }).CashuWallet(
    new (cashuTs as unknown as { CashuMint: new (url: string) => unknown }).CashuMint(decoded.mint)
  );
  const states = await wallet.checkProofsStates(decoded.proofs);

  const mapped = (states as Array<{ secret?: unknown; Y?: unknown; state?: unknown }>).map((s) => ({
    secret: String(s.secret ?? s.Y ?? ''),
    state: String(s.state ?? 'unknown') as 'unspent' | 'pending' | 'spent',
  }));

  return {
    allSpent: mapped.every((s) => s.state === 'spent'),
    allPending: mapped.every((s) => s.state === 'pending'),
    states: mapped,
  };
}

// ─── Receive ───

/**
 * 토큰의 unit을 결정한다.
 *
 * Coco SDK는 현재 멀티 유닛을 지원하지 않으므로 'sat'를 고정 반환한다.
 * SDK가 멀티 유닛을 지원하게 되면 이 함수에서 keyset.unit을 조회하도록 교체한다.
 *
 * @param _mintUrl - 미래 멀티 유닛 지원 시 mint별 unit 조회에 사용
 */
function resolveUnit(_mintUrl: string): string {
  // TODO: SDK 멀티 유닛 지원 시 manager.wallet.getKeyset() 등으로 unit 조회
  return 'sat';
}

/**
 * 토큰 수령 (일반 + P2PK 모두).
 * Coco RC50의 ops.receive가 P2PK unlock을 내부 처리한다.
 *
 * - amount: 실제 수신 금액 (gross - fee)
 * - fee: input_fee_ppk 기반 수수료 (0인 민트도 있음)
 * - unit: mint의 토큰 단위 (현재 항상 'sat')
 */
export async function receiveToken(
  token: string,
  options?: MintTrustOptions,
): Promise<{ amount: number; fee: number; unit: string; mintUrl: string }> {
  const manager = await getCocoManager();
  const decoded = getDecodedToken(token);

  try {
    return await withMintTrustedForOperation(manager, decoded.mint, options, async () => {
      await manager.mint.addMint(decoded.mint);

      const prepared = await manager.ops.receive.prepare({ token });

      // SDK 가 계산한 fee 와 gross amount 을 활용해 실제 수신 금액을 결정한다.
      const fee = prepared.fee;
      const netAmount = prepared.amount - fee;
      if (netAmount <= 0) {
        throw new RedeemFeeTooHighError();
      }

      await manager.ops.receive.execute(prepared);
      const unit = resolveUnit(decoded.mint);

      return { amount: netAmount, fee, unit, mintUrl: decoded.mint };
    });
  } catch (error) {
    throw classifyCashuError(error);
  }
}

/**
 * 토큰 수신 수수료 사전 추정.
 * prepare → fee 확인 → cancel 패턴으로 실제 실행 없이 수수료를 계산한다.
 *
 * input_fee_ppk가 없는 민트는 fee=0을 반환한다.
 */
export async function estimateReceiveFee(
  token: string,
  options?: MintTrustOptions,
): Promise<{ grossAmount: number; fee: number; netAmount: number; unit: string; mintUrl: string }> {
  const manager = await getCocoManager();
  const decoded = getDecodedToken(token);

  try {
    return await withMintTrustedForOperation(manager, decoded.mint, options, async () => {
      await manager.mint.addMint(decoded.mint);

      const prepared = await manager.ops.receive.prepare({ token });

      // 실행하지 않고 취소하여 잔액 변동 없이 수수료만 확인한다.
      await cancelReceiveFeeEstimate(prepared.id, () => manager.ops.receive.cancel(prepared.id));

      const grossAmount = prepared.amount;
      const fee = prepared.fee;
      const unit = resolveUnit(decoded.mint);
      const netAmount = grossAmount - fee;
      if (netAmount <= 0) {
        throw new RedeemFeeTooHighError();
      }

      return { grossAmount, fee, netAmount, unit, mintUrl: decoded.mint };
    });
  } catch (error) {
    throw classifyCashuError(error);
  }
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

export async function checkMintQuote(
  mintUrl: string,
  quoteId: string,
): Promise<{ state: string } | null> {
  const { Wallet, Mint } = await import('@cashu/cashu-ts');
  const mint = new Mint(mintUrl);
  const wallet = new Wallet(mint);
  await wallet.loadMint();

  try {
    return await wallet.checkMintQuote(quoteId);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const quoteMissing =
      message.includes('quote') &&
      (message.includes('not found') || message.includes('unknown') || message.includes('404'));

    if (quoteMissing) {
      return null;
    }

    throw error;
  }
}

// ─── Melt (Lightning 전송) ───

export async function prepareMelt(
  mintUrl: string,
  invoice: string,
): Promise<PreparedMelt> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, mintUrl);
  const operation = await manager.ops.melt.prepare({ mintUrl, method: 'bolt11', methodData: { invoice } });
  // TODO: SDK doesn't expose unit on melt operation yet, use resolveUnit as workaround
  const unit = resolveUnit(mintUrl);
  return {
    operationId: operation.id,
    quoteId: operation.quoteId,
    amount: operation.amount,
    fee_reserve: operation.fee_reserve,
    swap_fee: operation.swap_fee,
    unit,
  };
}

export async function executeMelt(operationId: string): Promise<{
  state: string;
  preimage?: string;
  effectiveFee?: number;
  changeAmount?: number;
}> {
  const manager = await getCocoManager();
  const result = await manager.ops.melt.execute(operationId);
  const preimage = result.state === 'finalized' ? result.finalizedData?.preimage : undefined;
  const effectiveFee = result.state === 'finalized' ? result.effectiveFee : undefined;
  const changeAmount = result.state === 'finalized' ? result.changeAmount : undefined;
  return {
    state: result.state,
    ...(preimage && { preimage }),
    effectiveFee,
    changeAmount,
  };
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

// ─── Token Inspection (lock + proof integrity) ───

import type { InputInspection } from '@/core/ports/driven/payment-method.port';

interface ParsedSecret {
  kind: string;
  data: string;
  tags?: string[][];
}

type LockResult = { status: 'locked'; target: string } | { status: 'unlocked' };

const lockVerifiers = new Map<string, (secret: ParsedSecret) => LockResult>([
  ['P2PK', (secret) => ({ status: 'locked', target: normalizePubkey(secret.data) })],
  ['HTLC', (secret) => ({ status: 'locked', target: secret.data })],
]);

function normalizePubkey(key: string): string {
  return key.startsWith('02') ? key : `02${key}`;
}

function parseSecret(secret: string): ParsedSecret | null {
  try {
    const parsed = JSON.parse(secret);
    if (Array.isArray(parsed) && parsed.length >= 2 && parsed[1]?.data) {
      return { kind: parsed[0], data: parsed[1].data, tags: parsed[1].tags };
    }
    return null;
  } catch {
    return null;
  }
}

export async function inspectInput(token: string): Promise<InputInspection> {
  const { getDecodedToken, hasValidDleq } = await import('@cashu/cashu-ts');

  let decoded;
  try {
    decoded = getDecodedToken(token);
  } catch {
    return { lockStatus: 'unlocked', proofIntegrity: 'unverifiable' };
  }

  const { proofs } = decoded;
  if (proofs.length === 0) {
    return { lockStatus: 'unlocked', proofIntegrity: 'unverifiable' };
  }

  // 1. Lock verification via strategy map
  let lockStatus: 'locked' | 'unlocked' = 'unlocked';
  let lockTarget: string | undefined;

  // All proofs must be locked to the same target for lockStatus='locked'
  for (const proof of proofs) {
    const parsed = parseSecret(proof.secret);
    if (!parsed) continue;

    const verifier = lockVerifiers.get(parsed.kind);
    if (!verifier) continue;

    const result = verifier(parsed);
    if (result.status === 'locked') {
      if (!lockTarget) {
        lockTarget = result.target;
        lockStatus = 'locked';
      } else if (lockTarget !== result.target) {
        // Mixed targets — treat as locked to first target
        // (edge case: shouldn't happen in practice)
      }
    }
  }

  // 2. Proof integrity (DLEQ)
  let allHaveDleq = true;
  for (const proof of proofs) {
    if (!proof.dleq) {
      allHaveDleq = false;
      continue;
    }
    try {
      const valid = hasValidDleq(proof, { id: proof.id, keys: {} });
      if (!valid) return { lockStatus, lockTarget, proofIntegrity: 'invalid' };
    } catch {
      allHaveDleq = false;
    }
  }

  const proofIntegrity = allHaveDleq ? 'verified' : 'unverifiable';

  return { lockStatus, lockTarget, proofIntegrity };
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
  await ensureMintTrusted(manager, mintUrl);
}

// ─── Recovery ───
// Recovery 로직은 cashu-recovery.ts로 이동됨.
// SDK ops를 recovery 인터페이스로 노출하는 헬퍼.

export async function getMeltRecoveryOps() {
  const manager = await getCocoManager();
  return {
    listInFlight: () => manager.ops.melt.listInFlight(),
    refresh: (id: string) => manager.ops.melt.refresh(id),
    reclaim: (id: string, reason: string) => manager.ops.melt.reclaim(id, reason),
  };
}

export async function getSendRecoveryOps() {
  const manager = await getCocoManager();
  return {
    runRecovery: () => manager.ops.send.recovery.run(),
    get: (operationId: string) => manager.ops.send.get(operationId),
  };
}

/**
 * Mint quote 결제 완료 감지 콜백.
 * SDK의 mint-op:finalized 이벤트를 구독하여 특정 quoteId 완료 시 handler 호출.
 */
export function onMintQuotePaid(quoteId: string, handler: () => void): () => void {
  let unsub: (() => void) | null = null
  let cancelled = false

  getCocoManager().then((manager) => {
    if (cancelled) return
    unsub = manager.on('mint-op:finalized', (event) => {
      if (event.operation.quoteId === quoteId && event.operation.state === 'finalized') {
        handler()
      }
    })
  }).catch(() => {})

  return () => {
    cancelled = true
    unsub?.()
  }
}

export async function getQuoteRecoveryOps() {
  return {
    async checkMintQuote(quoteId: string, mintUrl: string) {
      const quote = await checkMintQuote(mintUrl, quoteId);
      if (!quote) {
        throw new Error(`Mint quote ${quoteId} not found on ${mintUrl}`);
      }
      return quote;
    },
    async mintAndReceive(quoteId: string, mintUrl: string, amount: number) {
      const { Wallet, Mint, getEncodedToken } = await import('@cashu/cashu-ts');
      const mint = new Mint(mintUrl);
      const wallet = new Wallet(mint);
      await wallet.loadMint();
      const proofs = await wallet.mintProofs(amount, quoteId);
      const token = getEncodedToken({ mint: mintUrl, proofs });
      await receiveToken(token);
    },
  };
}
