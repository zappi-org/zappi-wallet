/**
 * Route Executor
 *
 * 선택된 라우트에 따라 기존 primitive를 조합하여 결제를 실행한다.
 * 6개 라우트 모두 이 모듈을 통해 실행된다.
 */

import { ok, err, type Result } from '@/core/types'
import type { BaseError } from '@/core/errors'
import { classifyCashuError } from '@/modules/cashu'
import { PaymentRoute, type RouteSelection, type RouteContext, type RouteExecutionResult } from '@/core/domain/routing'
import type { OutgoingPaymentTransport } from '@/core/ports/driven/outgoing-payment-transport.port'
import {
  prepareSend,
  executeSend,
  rollbackSend,
  prepareMelt,
  executeMelt as cocoExecuteMelt,
  rollbackMelt,
  createMintQuote,
  redeemMintQuote,
  type LockingCondition,
} from '@/modules/cashu'
import { markQuoteAsSwap, unmarkQuoteAsSwap } from '@/modules/cashu'
import { getDatabase } from '@/adapters/storage/dexie/schema'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { sendTokenViaHttp } from '@/adapters/codec/nut18-http-poller'
import { DirectLnurlAdapter } from '@/adapters/lnurl/direct-lnurl.adapter'
import { TokenCodecAdapter } from '@/adapters/codec/token-codec.adapter'

// Composition-level singleton adapters for routing helper functions
const _codec = new TokenCodecAdapter()
const _lnurl = new DirectLnurlAdapter()

// ============= Main Entry =============

export async function executeRoute(
  selection: RouteSelection,
  context: RouteContext,
): Promise<Result<RouteExecutionResult, BaseError>> {
  const { route } = selection

  console.log(`[Router] Executing route #${route} from ${selection.sourceMintUrl}${selection.targetMintUrl ? ` → ${selection.targetMintUrl}` : ''} (${selection.reason})`)

  switch (route) {
    case PaymentRoute.TOKEN_TRANSFER:
    case PaymentRoute.OWN_MINT_TOKEN:
      return executeTokenSendFlow(selection.sourceMintUrl, selection, context)

    case PaymentRoute.LN_INTERNAL:
    case PaymentRoute.LN_CROSS_MINT:
    case PaymentRoute.MELT_TO_LN:
      return executeMeltToLn(selection, context)

    case PaymentRoute.MINT_AND_DM:
      return executeMintAndDm(selection, context)

    case PaymentRoute.CANNOT_SEND:
    default:
      return err(classifyCashuError(new Error('Cannot determine payment route')))
  }
}

// ============= Route Executors =============

/**
 * Route #2 LN_INTERNAL — same mint LN settle
 * Route #3 LN_CROSS_MINT — cross mint LN
 * Route #5 MELT_TO_LN — direct bolt11 melt
 */
async function executeMeltToLn(
  selection: RouteSelection,
  context: RouteContext,
): Promise<Result<RouteExecutionResult, BaseError>> {
  try {
    const invoice = await resolveInvoice(selection, context)
    if (!invoice) {
      return err(classifyCashuError(new Error('Failed to resolve invoice')))
    }

    const result = await executeMeltFlow(selection.sourceMintUrl, invoice, selection.amount, context.addressOrInvoice || invoice)
    if (result.isErr()) return err(result.error)

    const { meltResult, actualFee } = result.value

    broadcastSync('balance_changed')

    return ok({
      success: true,
      amount: meltResult.amount,
      fee: actualFee,
      sourceMintUrl: selection.sourceMintUrl,
      transactionId: meltResult.transactionId,
    })
  } catch (error) {
    console.error('[Router] executeMeltToLn failed:', error)
    return err(classifyCashuError(error))
  }
}

/**
 * Route #4 MINT_AND_DM — cross mint: melt→mint on target + token send via DM
 *
 * 1. createMintQuote(target) → invoice
 * 2. prepareMelt(source, invoice) → executeMelt()
 * 3. redeemMintQuote(target) → get proofs on target
 * 4. prepareSendToken(target) → executeSendToken() → transport
 */
async function executeMintAndDm(
  selection: RouteSelection,
  context: RouteContext,
): Promise<Result<RouteExecutionResult, BaseError>> {
  const { sourceMintUrl, targetMintUrl } = selection
  if (!targetMintUrl) {
    return err(classifyCashuError(new Error('Route #4 requires targetMintUrl')))
  }

  let mintQuote: Awaited<ReturnType<typeof createMintQuote>> | undefined

  try {
    // 1. Mint quote on target
    console.log('[Router #4] Creating mint quote on target mint...')
    mintQuote = await createMintQuote(targetMintUrl, selection.amount)
    markQuoteAsSwap(mintQuote.quote)

    // 2. Melt on source (pay the invoice)
    console.log('[Router #4] Preparing melt on source mint...')
    const meltOp = await prepareMelt(sourceMintUrl, mintQuote.request)

    // Save pending melt for crash recovery
    const db = getDatabase()
    await db.pendingMelts.put({
      meltQuoteId: meltOp.quoteId,
      mintUrl: sourceMintUrl,
      amount: selection.amount,
      fee: meltOp.fee_reserve + meltOp.swap_fee,
      destination: targetMintUrl,
      createdAt: Date.now(),
    })

    console.log('[Router #4] Executing melt...')
    try {
      await cocoExecuteMelt(meltOp.operationId)
    } catch (meltError) {
      try { await rollbackMelt(meltOp.operationId, 'melt failed') } catch { /* ignore */ }
      await db.pendingMelts.delete(meltOp.quoteId).catch(() => {})
      throw meltError
    }

    await db.pendingMelts.delete(meltOp.quoteId).catch(() => {})

    // 3. Redeem mint quote on target
    console.log('[Router #4] Redeeming mint quote on target...')
    try {
      await redeemMintQuote(targetMintUrl, mintQuote.quote, selection.amount)
    } catch (redeemError) {
      const msg = String(redeemError).toLowerCase()
      if (msg.includes('already pending') || msg.includes('already issued') || msg.includes('already redeemed')) {
        console.log('[Router #4] Quote already redeemed by watcher, continuing')
      } else {
        throw redeemError
      }
    }

    unmarkQuoteAsSwap(mintQuote.quote)

    // 4. Create token on target mint + send via transport
    console.log('[Router #4] Creating token on target mint...')
    const tokenResult = await executeTokenSendFlow(targetMintUrl, selection, context)
    if (tokenResult.isErr()) return tokenResult

    return ok({
      ...tokenResult.value,
      sourceMintUrl,
      targetMintUrl,
      fee: meltOp.fee_reserve + meltOp.swap_fee + (tokenResult.value.fee || 0),
    })
  } catch (error) {
    console.error('[Router #4] executeMintAndDm failed:', error)
    if (mintQuote) unmarkQuoteAsSwap(mintQuote.quote)
    return err(classifyCashuError(error))
  }
}

// ============= Shared Flows =============

/**
 * Melt flow: prepareMelt → executeMelt → TX record + crash recovery
 * Routes #2, #3, #5 에서 공유
 */
async function executeMeltFlow(
  mintUrl: string,
  invoice: string,
  amount: number,
  destination: string,
): Promise<Result<{ meltResult: { quoteId: string; amount: number; transactionId: string }; actualFee: number }, BaseError>> {
  let meltOp: Awaited<ReturnType<typeof prepareMelt>> | null = null

  try {
    meltOp = await prepareMelt(mintUrl, invoice)
    const quotedFee = meltOp.fee_reserve + meltOp.swap_fee

    // Save pending melt for crash recovery
    const db = getDatabase()
    await db.pendingMelts.put({
      meltQuoteId: meltOp.quoteId,
      mintUrl,
      amount,
      fee: quotedFee,
      destination,
      createdAt: Date.now(),
    })

    const meltResult = await cocoExecuteMelt(meltOp.operationId)

    // Use effectiveFee from SDK if available, otherwise fall back to quoted
    const actualFee = meltResult.effectiveFee ?? quotedFee

    // TX record
    const transactionId = `tx-melt-${meltOp.quoteId}`
    await getDatabase().transactions.put({
      id: transactionId,
      direction: 'send',
      type: 'lightning',
      amount: meltOp.amount,
      mintUrl,
      status: 'completed',
      createdAt: Date.now(),
      completedAt: Date.now(),
      bolt11: invoice,
      preimage: meltResult.preimage,
      metadata: {
        fee: actualFee,
        destination,
        ...(meltResult.effectiveFee !== undefined && { quotedFee, effectiveFee: meltResult.effectiveFee }),
      },
    })

    // Clean up pending melt
    await db.pendingMelts.delete(meltOp.quoteId).catch(() => {})

    return ok({
      meltResult: { quoteId: meltOp.quoteId, amount: meltOp.amount, transactionId },
      actualFee,
    })
  } catch (error) {
    if (meltOp) {
      try { await rollbackMelt(meltOp.operationId, 'melt failed') } catch { /* ignore */ }
      const db = getDatabase()
      await db.pendingMelts.delete(meltOp.quoteId).catch(() => {})
    }
    return err(classifyCashuError(error))
  }
}

/**
 * Token send flow: prepareSendToken → executeSendToken → transport + crash recovery
 * Routes #1, #4, #6 에서 공유
 */
async function executeTokenSendFlow(
  mintUrl: string,
  selection: RouteSelection,
  context: RouteContext,
): Promise<Result<RouteExecutionResult, BaseError>> {
  let operationId: string | undefined

  try {
    // 1. Prepare (P2PK는 prepare 시점에 lockingCondition으로 지정) + execute token
    const p2pkPubkey = context.parsedCreq?.p2pkPubkey
    const lockingCondition: LockingCondition | undefined = p2pkPubkey
      ? { kind: 'P2PK', data: p2pkPubkey }
      : undefined

    const prepared = await prepareSend({ mintUrl, amount: selection.amount, lockingCondition })
    operationId = prepared.operationId

    const { token } = await executeSend(prepared.operationId, {
      memo: context.memo,
    })

    // 2. TX record
    const txId = `tx-ecash-send-${crypto.randomUUID()}`
    const isCreqPayment = context.parsedCreq != null
    await getDatabase().transactions.put({
      id: txId,
      direction: 'send',
      type: 'ecash-token',
      amount: selection.amount,
      mintUrl,
      status: 'pending',
      createdAt: Date.now(),
      memo: context.memo,
      token,
      tokenState: 'unspent',
      operationId: prepared.operationId,
      ...(isCreqPayment && { intent: 'request-pay' }),
      metadata: {
        route: selection.route,
        ...(isCreqPayment && { intent: 'request-pay' }),
        ...(prepared.fee > 0 && { fee: prepared.fee }),
      },
    })

    // 3. Save pending send token for crash recovery
    const db = getDatabase()
    await db.pendingSendTokens.put({
      id: txId,
      token,
      mintUrl,
      amount: selection.amount,
      operationId: prepared.operationId,
      createdAt: Date.now(),
    })

    // 4. Transport
    const transportResult = await executeTransport(token, context)

    broadcastSync('balance_changed')

    return ok({
      success: transportResult.success,
      amount: selection.amount,
      fee: prepared.fee,
      sourceMintUrl: mintUrl,
      transactionId: txId,
      token,
      transportUsed: transportResult.transportUsed,
    })
  } catch (error) {
    if (operationId) {
      try { await rollbackSend(operationId) } catch { /* ignore */ }
    }
    console.error('[Router] executeTokenSendFlow failed:', error)
    return err(classifyCashuError(error))
  }
}

/**
 * Transport: Nostr DM (primary) → HTTP POST (fallback)
 */
async function executeTransport(
  token: string,
  context: RouteContext,
): Promise<{ success: boolean; transportUsed: 'nostr' | 'post' | 'none' }> {
  const { parsedCreq, outgoingTransport, memo } = context

  if (!parsedCreq) {
    return { success: true, transportUsed: 'none' }
  }

  // Nostr DM (primary) — via OutgoingPaymentTransport port
  if (parsedCreq.hasNostrTransport && parsedCreq.nostrTarget && outgoingTransport) {
    try {
      const transport = outgoingTransport as OutgoingPaymentTransport
      const result = await transport.send({
        recipientPubkey: parsedCreq.nostrTarget,
        token,
        memo,
        requestId: parsedCreq.id,
      })
      if (result.success) {
        return { success: true, transportUsed: 'nostr' }
      }
    } catch (e) {
      console.warn('[Router] Nostr DM failed, trying HTTP fallback:', e)
    }
  }

  // HTTP POST (fallback)
  if (parsedCreq.hasPostTransport && parsedCreq.postTarget) {
    try {
      const result = await sendTokenViaHttp({
        endpoint: parsedCreq.postTarget,
        token,
        requestId: parsedCreq.id,
        memo,
      })
      if (result.success) {
        return { success: true, transportUsed: 'post' }
      }
    } catch (e) {
      console.warn('[Router] HTTP POST also failed:', e)
    }
  }

  // No transport specified in creq — token created locally is the success
  if (!parsedCreq.hasNostrTransport && !parsedCreq.hasPostTransport) {
    return { success: true, transportUsed: 'none' }
  }

  return { success: false, transportUsed: 'none' }
}

// ============= Helpers =============

async function resolveInvoice(
  selection: RouteSelection,
  context: RouteContext,
): Promise<string | null> {
  if (selection.invoice) return selection.invoice

  const addr = context.addressOrInvoice
  if (!addr) return null

  if (_codec.isBolt11(addr)) {
    const decoded = _codec.decodeBolt11(addr)
    if (decoded.isExpired) return null
    return addr
  }

  if (_codec.isLightningAddress(addr)) {
    const params = await _lnurl.resolvePay(addr)
    const result = await _lnurl.fetchInvoice(params, selection.amount)
    return result.bolt11 ?? null
  }

  return addr
}
