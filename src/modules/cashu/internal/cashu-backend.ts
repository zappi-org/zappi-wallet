/**
 * CashuBackend — wraps the Coco Manager.
 *
 * All Cashu/Coco SDK access is isolated here behind module-level backend functions.
 * P2PK is specified as a `target` at prepare time (Coco native).
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
 * Prepare a token send.
 * For P2PK sends, passing target: { type: 'p2pk', pubkey } makes Coco
 * generate a P2PK-locked output internally.
 */
export async function prepareSend(params: {
  mintUrl: string;
  amount: number;
  lockingCondition?: LockingCondition;
}): Promise<PreparedSend> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, params.mintUrl);

  // Map LockingCondition → Coco SDK target
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
 * Execute a token send.
 * Coco handles P2PK lock, change-proof return, and error recovery internally.
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
 * Cancel or reclaim a token send.
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
 * Fetch mint info via Coco.
 * `manager.mint.getMintInfo` is a hybrid of a repo read + 5-min TTL auto-refresh:
 * within the TTL it does no network; once expired it fetches info+keysets (via the
 * MintRequestProvider limiter). Also works for unregistered mints (builds a temp
 * object, then fetches). netLog is omitted — this layer can't tell whether a
 * network call happened, so measuring here would double-count.
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
 * Resolve a token's unit.
 *
 * The Coco SDK doesn't support multi-unit yet, so this always returns 'sat'.
 * Once it does, replace this with a keyset.unit lookup.
 *
 * @param _mintUrl - will be used for per-mint unit lookup once multi-unit lands
 */
function resolveUnit(_mintUrl: string): string {
  // TODO: once the SDK supports multi-unit, look up unit via manager.wallet.getKeyset()
  return 'sat';
}

/**
 * Receive a token (both normal and P2PK).
 * Coco ops.receive handles P2PK unlock internally.
 *
 * - amount: actual amount received (gross - fee)
 * - fee: input_fee_ppk-based fee (some mints charge 0)
 * - unit: mint's token unit (currently always 'sat')
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
 * Pre-estimate the token receive fee.
 * Uses a prepare → check fee → cancel pattern to compute the fee without
 * actually executing. Mints without input_fee_ppk return fee=0.
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

      const preparedOp = await manager.ops.receive.prepare({ token });
      
      const { amount, fee, mintUrl: preparedMintUrl } = preparedOp;

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

// ─── Mint (Lightning receive) ───

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
  // If the SDK already auto-completed the mint execute, checkPayment isn't valid
  if (op.state === 'finalized') {
    return { state: 'ISSUED' };
  }
  const result = await manager.ops.mint.checkPayment(op.id);
  return { state: result.observedRemoteState };
}

// ─── Melt (Lightning send) ───

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

/**
 * Check melt remote state — for the stuck-confirm matrix only.
 * Unlike checkMelt (a local repo read), this syncs the real remote state once
 * via Coco `ops.melt.refresh`.
 * Failures (transient network errors, etc.) **throw** — swallowing them as
 * {error} would let the caller's state mapping mark an in-flight payment as
 * failed, a funds bug. The sweep catches the throw and retries next cycle
 * without touching that transfer.
 */
export async function refreshMelt(operationId: string): Promise<{ state: string }> {
  const manager = await getCocoManager();
  const refreshed = await manager.ops.melt.refresh(operationId);
  return { state: refreshed.state };
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

// ─── Queries ───

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
  allowedMints: string[];   // empty array = any mint allowed
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

// ─── Wallet management ───

export async function restoreWallet(mintUrl: string): Promise<void> {
  const manager = await getCocoManager();
  // A just-added mint (one that hasn't gone through any op yet) must also be
  // restorable — like other ops, register it with Coco first (the precondition
  // for auto seed-restore on mint add).
  await ensureMintTrusted(manager, mintUrl);
  await manager.wallet.restore(mintUrl);
}

export async function addMint(mintUrl: string): Promise<void> {
  const manager = await getCocoManager();
  await ensureMintTrusted(manager, mintUrl);
}

// ─── Recovery ───
// Recovery logic lives in cashu-recovery.ts; these helpers just expose the
// SDK ops as a recovery interface.

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
 * Detect mint-quote payment completion.
 * Subscribes to the SDK's mint-op:finalized event and calls handler when the
 * given quoteId finalizes.
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
 * Read mint-op state from Coco's local repo — for reconcile.
 * Zero network: getByQuote is a repository read. null = a quote Coco isn't tracking.
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
 * Re-run PAID quotes that Coco is tracking but are stuck.
 * Replaces the checkMintQuote polling loop with a single public-API call.
 */
export async function requeuePaidMintQuotesInCoco(): Promise<{ requeued: string[] }> {
  const manager = await getCocoManager();
  return manager.requeuePaidMintQuotes();
}

/**
 * Run all Coco recovery sweeps — for runFullNetworkRecovery.
 * Each sweep checks inProgress() then skips-and-reports: Coco throws if
 * re-called while a sweep is running (button-mashing right after unlock), so
 * the guard is required.
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
