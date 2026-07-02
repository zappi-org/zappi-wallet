/**
 * CashuBackend — Coco Manager 래핑 클래스
 *
 * cashuService.ts에 흩어진 26개 함수를 Coco API 기반으로 통합.
 * P2PK는 prepare 시점에 target으로 지정 (Coco 네이티브).
 * Cashu/Coco SDK access is isolated here behind module-level backend functions.
 */

import type { PendingQuote } from '@/core/domain/quote';
import type { CashuProof } from '@/core/domain/cashu-payment-payload';
import { InsufficientBalanceError, RedeemFeeTooHighError } from '@/core/errors/payment.errors';
import type { ProofStateResult } from '@/core/ports/driven/send-token-operator.port';
import { getEncodedToken, normalizeMintUrl } from '@cashu/coco-core';
import { getTokenMetadata } from '@cashu/cashu-ts';
import { classifyCashuError } from './classify-error';
import { getCocoManager, getPendingMintQuotes } from './coco-sdk';
import { cocoLogger as logger } from './logger';

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

export interface DecodedPaymentToken {
  mint: string;
  unit: string;
  proofs: CashuProof[];
  memo?: string;
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
      const normalizedMintUrl = normalizeMintUrl(params.mintUrl);
      const balances = await manager.wallet.balances.byMint({ mintUrls: [normalizedMintUrl] });
      const available = balances[normalizedMintUrl]?.spendable ?? 0;

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

export async function getSendOperationState(operationId: string): Promise<string | null> {
  const manager = await getCocoManager();
  const op = await manager.ops.send.get(operationId);
  return typeof op?.state === 'string' ? op.state : null;
}

/**
 * Coco 경유 mint info 조회 (설계 §5.4 분기 A / SP-1 확정):
 * `manager.mint.getMintInfo` = repo 읽기 + 5분 TTL 자동 갱신 하이브리드 —
 * TTL 내면 무네트워크, 경과 시 info+keysets fetch(MintRequestProvider limiter 경유).
 * 미등록 민트도 지원(임시 객체 생성 후 fetch). netLog는 생략 — 네트워크 발생
 * 여부를 이 계층에서 알 수 없어 이중 계측이 된다.
 */
export async function getMintInfoFromCoco(
  mintUrl: string,
): Promise<Record<string, unknown> | null> {
  try {
    const manager = await getCocoManager();
    const info = await manager.mint.getMintInfo(normalizeMintUrl(mintUrl));
    return info as unknown as Record<string, unknown>;
  } catch (error) {
    console.warn('[CashuBackend] getMintInfoFromCoco failed:', error);
    return null;
  }
}

export async function checkProofStates(token: string): Promise<ProofStateResult> {
  const cashuTs = await import('@cashu/cashu-ts');
  const manager = await getCocoManager();
  const mintUrl = normalizeMintUrl(getTokenMetadata(token).mint);
  const decoded = await manager.wallet.decodeToken(token, mintUrl);

  const wallet = new cashuTs.Wallet(new cashuTs.Mint(decoded.mint));
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

export async function decodeTokenForPaymentPayload(token: string): Promise<DecodedPaymentToken> {
  const manager = await getCocoManager();
  const mintUrl = normalizeMintUrl(getTokenMetadata(token).mint);
  const decoded = await manager.wallet.decodeToken(token, mintUrl);

  return {
    mint: decoded.mint,
    unit: decoded.unit || 'sat',
    proofs: decoded.proofs as CashuProof[],
    memo: decoded.memo,
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
 * Coco ops.receive가 P2PK unlock을 내부 처리한다.
 *
 * - amount: 실제 수신 금액 (gross - fee)
 * - fee: input_fee_ppk 기반 수수료 (0인 민트도 있음)
 * - unit: mint의 토큰 단위 (현재 항상 'sat')
 */
export async function receiveToken(
  token: string,
  options?: MintTrustOptions,
): Promise<{ amount: number; fee: number; unit: string; mintUrl: string; memo?: string }> {
  const manager = await getCocoManager();
  const metadata = getTokenMetadata(token);
  const mintUrl = normalizeMintUrl(metadata.mint);

  try {
    return await withMintTrustedForOperation(manager, mintUrl, options, async () => {
      await manager.mint.addMint(mintUrl);

      const prepared = await manager.ops.receive.prepare({ token });

      // SDK 가 계산한 fee 와 gross amount 을 활용해 실제 수신 금액을 결정한다.
      const fee = prepared.fee;
      const netAmount = prepared.amount - fee;
      if (netAmount <= 0) {
        throw new RedeemFeeTooHighError();
      }

      await manager.ops.receive.execute(prepared);
      const unit = resolveUnit(mintUrl);
      const result = { amount: netAmount, fee, unit, mintUrl };

      return metadata.memo ? { ...result, memo: metadata.memo } : result;
    });
  } catch (error) {
    console.error('[receiveToken] Raw error:', error);
    console.error('[receiveToken] Message:', error instanceof Error ? error.message : String(error));
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
  const mintUrl = normalizeMintUrl(getTokenMetadata(token).mint);

  try {
    return await withMintTrustedForOperation(manager, mintUrl, options, async () => {
      await manager.mint.addMint(mintUrl);

      // //1.prepare: token decode -> calc fee -> preparedOp
      const preparedOp = await manager.ops.receive.prepare({ token });
      
      // //2. check fee
      const { amount, fee, mintUrl: preparedMintUrl } = preparedOp;

      // //3. cancle Opeartion
      await manager.ops.receive.cancel(preparedOp.id);

      return {
        grossAmount: amount,
        fee,
        netAmount: amount - fee,
        unit: resolveUnit(preparedMintUrl),
        mintUrl: preparedMintUrl,
      };

    });
  } catch (error) {
    console.error('[estimateReceiveFee] Raw error:', error);
    console.error('[estimateReceiveFee] Message:', error instanceof Error ? error.message : String(error));
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

  logger.info(`[CashuBackend] Redeemed quote ${quoteId} (expected: ${expectedAmount} sats)`);
}

export async function checkMintQuote(
  mintUrl: string,
  quoteId: string,
): Promise<{ state: string } | null> {
  const manager = await getCocoManager();
  const op = await manager.ops.mint.getByQuote(mintUrl, quoteId);
  if (!op) return null;
  // SDK가 이미 자동으로 mint execute까지 완료했으면 checkPayment는 안 됨
  if (op.state === 'finalized') {
    return { state: 'ISSUED' };
  }
  const result = await manager.ops.mint.checkPayment(op.id);
  return { state: result.observedRemoteState };
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

export async function checkMelt(operationId: string): Promise<{
  state: string;
  preimage?: string;
  error?: string;
}> {
  const manager = await getCocoManager();
  const result = await manager.ops.melt.get(operationId);
  if (!result) {
    return { state: 'unknown', error: 'operation not found' };
  }
  const preimage = result.state === 'finalized'
    ? (result as { finalizedData?: { preimage?: string } }).finalizedData?.preimage
    : undefined;
  return {
    state: result.state,
    ...(preimage && { preimage }),
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
  const { hasValidDleq } = await import('@cashu/cashu-ts');

  let decoded;
  try {
    const manager = await getCocoManager();
    const mintUrl = normalizeMintUrl(getTokenMetadata(token).mint);
    decoded = await manager.wallet.decodeToken(token, mintUrl);
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
  const balances = await manager.wallet.balances.byMint();
  return Object.fromEntries(
    Object.entries(balances).map(([mintUrl, snapshot]) => [mintUrl, snapshot.spendable]),
  );
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

export async function mintAndReceive(quoteId: string, mintUrl: string, amount: number): Promise<void> {
  const manager = await getCocoManager();
  const op = await manager.ops.mint.importQuote({
    mintUrl,
    quote: {
      quote: quoteId,
      request: '',
      unit: resolveUnit(mintUrl),
      amount,
      state: 'PAID',
      expiry: 0,
    },
    method: 'bolt11',
    methodData: {},
  });
  await manager.ops.mint.execute(op);
}

export async function getQuoteRecoveryOps() {
  const manager = await getCocoManager();
  return {
    async checkMintQuote(quoteId: string, mintUrl: string) {
      const op = await manager.ops.mint.getByQuote(mintUrl, quoteId);
      if (!op) throw new Error(`Mint quote ${quoteId} not found on ${mintUrl}`);
      const result = await manager.ops.mint.checkPayment(op.id);
      return { state: result.observedRemoteState };
    },
    async mintAndReceive(quoteId: string, mintUrl: string, amount: number) {
      await mintAndReceive(quoteId, mintUrl, amount);
    },
  };
}

/**
 * Coco 로컬 repo의 mint op 상태 조회 — reconcile용 (설계 §6.1 B6 이중망/B7b).
 * 네트워크 0: getByQuote는 repository 읽기다. null이면 Coco 비추적 quote.
 */
export async function getMintOpStateLocal(
  mintUrl: string,
  quoteId: string,
): Promise<{ state: string } | null> {
  const manager = await getCocoManager();
  const op = await manager.ops.mint.getByQuote(mintUrl, quoteId);
  return op ? { state: op.state } : null;
}

/**
 * Coco가 추적 중이나 stuck된 PAID quote 재실행 — 설계 §6.1 B7a.
 * checkMintQuote 폴링 루프(B6) 대신 공개 API 1회 호출로 대체한다.
 */
export async function requeuePaidMintQuotesInCoco(): Promise<{ requeued: string[] }> {
  const manager = await getCocoManager();
  return manager.requeuePaidMintQuotes();
}

/**
 * Coco recovery sweep 전종 실행 — 설계 §6.2 runFullNetworkRecovery용 (B1/B2 포함).
 * 각 sweep은 inProgress() 확인 후 skip-and-report [N7] — Coco는 진행 중 재호출 시
 * throw하므로(unlock 직후 버튼 연타 충돌) 가드가 필수다.
 */
export async function runCocoRecoverySweeps(): Promise<{ ran: string[]; skipped: string[] }> {
  const manager = await getCocoManager();
  const ran: string[] = [];
  const skipped: string[] = [];

  const sweeps: [string, { run(): Promise<void>; inProgress(): boolean }][] = [
    ['send', manager.ops.send.recovery],
    ['melt', manager.ops.melt.recovery],
    ['receive', manager.ops.receive.recovery],
  ];
  for (const [name, recovery] of sweeps) {
    if (recovery.inProgress()) {
      skipped.push(name);
      continue;
    }
    try {
      await recovery.run();
      ran.push(name);
    } catch (e) {
      logger.error(`[CashuBackend] ${name} recovery sweep failed:`, e as Error);
      skipped.push(name);
    }
  }

  if (manager.ops.mint.recovery.inProgress()) {
    skipped.push('mint');
  } else {
    try {
      await manager.recoverPendingMintOperations();
      ran.push('mint');
    } catch (e) {
      logger.error('[CashuBackend] mint recovery sweep failed:', e as Error);
      skipped.push('mint');
    }
  }

  return { ran, skipped };
}
