import { sat } from '@/core/domain/amount'
import { createTransaction, settleAsDelivered } from '@/core/domain/transaction'
import { PaymentRoute, type RouteContext, type RouteExecutionResult, type RouteSelection } from '@/core/domain/routing'
import type { EventBus } from '@/core/events/event-bus'
import { BaseError, UnknownError } from '@/core/errors'
import type { LnurlGateway } from '@/core/ports/driven/lnurl-gateway.port'
import type { PaymentDeliveryPort } from '@/core/ports/driven/payment-delivery.port'
import type { RouteExecutionStore } from '@/core/ports/driven/route-execution-store.port'
import type { PreparedRouteMelt, RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type { SyncNotifier } from '@/core/ports/driven/sync-notifier.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { RouteExecutionUseCase } from '@/core/ports/driving/route-execution.usecase'
import type { OutgoingEcashLifecycleUseCase } from '@/core/ports/driving/outgoing-ecash-lifecycle.usecase'
import { err, ok, type Result } from '@/core/types'

export class RouteExecutionService implements RouteExecutionUseCase {
  constructor(
    private readonly paymentOperator: RoutePaymentOperator,
    private readonly txRepo: TransactionRepository,
    private readonly routeStore: RouteExecutionStore,
    private readonly delivery: PaymentDeliveryPort,
    private readonly tokenCodec: TokenCodec,
    private readonly lnurl: Pick<LnurlGateway, 'resolvePay' | 'fetchInvoice'>,
    private readonly eventBus: EventBus,
    private readonly syncNotifier?: SyncNotifier,
    private readonly outgoingLifecycle?: Pick<OutgoingEcashLifecycleUseCase, 'recordCreated' | 'recordDeliveryResult'>,
  ) {}

  async executeRoute(
    selection: RouteSelection,
    context: RouteContext,
  ): Promise<Result<RouteExecutionResult, BaseError>> {
    try {
      switch (selection.route) {
        case PaymentRoute.TOKEN_TRANSFER:
        case PaymentRoute.OWN_MINT_TOKEN:
          return ok(await this.executeTokenSendFlow(selection.sourceMintUrl, selection, context))

        case PaymentRoute.LN_INTERNAL:
        case PaymentRoute.LN_CROSS_MINT:
        case PaymentRoute.MELT_TO_LN:
          return ok(await this.executeMeltToLn(selection, context))

        case PaymentRoute.MINT_AND_DM:
          return ok(await this.executeMintAndDm(selection, context))

        case PaymentRoute.CANNOT_SEND:
        default:
          return err(new UnknownError('Cannot determine payment route'))
      }
    } catch (error) {
      return err(toBaseError(error))
    }
  }

  private async executeMeltToLn(
    selection: RouteSelection,
    context: RouteContext,
  ): Promise<RouteExecutionResult> {
    const invoice = await this.resolveInvoice(selection, context)
    if (!invoice) {
      throw new UnknownError('Failed to resolve invoice')
    }

    const { meltResult, actualFee } = await this.executeMeltFlow(
      selection.sourceMintUrl,
      invoice,
      selection.amount,
      context.addressOrInvoice || invoice,
    )
    this.notifyChanged(selection.sourceMintUrl)

    return {
      success: true,
      amount: meltResult.amount,
      fee: actualFee,
      sourceMintUrl: selection.sourceMintUrl,
      transactionId: meltResult.transactionId,
    }
  }

  private async executeMintAndDm(
    selection: RouteSelection,
    context: RouteContext,
  ): Promise<RouteExecutionResult> {
    const { sourceMintUrl, targetMintUrl } = selection
    if (!targetMintUrl) {
      throw new UnknownError('Route #4 requires targetMintUrl')
    }

    let mintQuote: { quote: string; request: string } | undefined

    try {
      mintQuote = await this.paymentOperator.createMintQuote(targetMintUrl, selection.amount)
      this.paymentOperator.markMintQuoteAsSwap(mintQuote.quote)

      const meltOp = await this.paymentOperator.prepareMelt(sourceMintUrl, mintQuote.request)
      const meltFee = meltOp.feeReserve + meltOp.swapFee
      await this.routeStore.savePendingMelt({
        quoteId: meltOp.quoteId,
        mintUrl: sourceMintUrl,
        amount: selection.amount,
        fee: meltFee,
        destination: targetMintUrl,
      })

      try {
        await this.paymentOperator.executeMelt(meltOp.operationId)
      } catch (error) {
        try { await this.paymentOperator.rollbackMelt(meltOp.operationId, 'melt failed') } catch { /* ignore */ }
        await this.routeStore.deletePendingMelt(meltOp.quoteId).catch(() => {})
        throw error
      }

      await this.routeStore.deletePendingMelt(meltOp.quoteId).catch(() => {})

      try {
        await this.paymentOperator.redeemMintQuote(targetMintUrl, mintQuote.quote, selection.amount)
      } catch (error) {
        if (!isAlreadyRedeemedQuote(error)) {
          throw error
        }
      }

      this.paymentOperator.unmarkMintQuoteAsSwap(mintQuote.quote)

      const tokenResult = await this.executeTokenSendFlow(targetMintUrl, selection, context)
      return {
        ...tokenResult,
        sourceMintUrl,
        targetMintUrl,
        fee: meltFee + tokenResult.fee,
      }
    } catch (error) {
      if (mintQuote) this.paymentOperator.unmarkMintQuoteAsSwap(mintQuote.quote)
      throw error
    }
  }

  private async executeMeltFlow(
    mintUrl: string,
    invoice: string,
    amount: number,
    destination: string,
  ): Promise<{ meltResult: { quoteId: string; amount: number; transactionId: string }; actualFee: number }> {
    let meltOp: PreparedRouteMelt | null = null

    try {
      meltOp = await this.paymentOperator.prepareMelt(mintUrl, invoice)
      const quotedFee = meltOp.feeReserve + meltOp.swapFee
      await this.routeStore.savePendingMelt({
        quoteId: meltOp.quoteId,
        mintUrl,
        amount,
        fee: quotedFee,
        destination,
      })

      const meltResult = await this.paymentOperator.executeMelt(meltOp.operationId)
      const actualFee = meltResult.effectiveFee ?? quotedFee
      const transactionId = `tx-melt-${meltOp.quoteId}`
      await this.txRepo.save(settleAsDelivered(createTransaction({
        id: transactionId,
        direction: 'send',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(meltOp.amount),
        accountId: mintUrl,
        fee: {
          quoted: sat(quotedFee),
          effective: sat(actualFee),
        },
        metadata: {
          bolt11: invoice,
          preimage: meltResult.preimage,
          destination,
          quotedFee,
          effectiveFee: actualFee,
        },
      })))

      await this.routeStore.deletePendingMelt(meltOp.quoteId).catch(() => {})

      return {
        meltResult: { quoteId: meltOp.quoteId, amount: meltOp.amount, transactionId },
        actualFee,
      }
    } catch (error) {
      if (meltOp) {
        try { await this.paymentOperator.rollbackMelt(meltOp.operationId, 'melt failed') } catch { /* ignore */ }
        await this.routeStore.deletePendingMelt(meltOp.quoteId).catch(() => {})
      }
      throw error
    }
  }

  private async executeTokenSendFlow(
    mintUrl: string,
    selection: RouteSelection,
    context: RouteContext,
  ): Promise<RouteExecutionResult> {
    let operationId: string | undefined
    let txId: string | undefined

    try {
      const p2pkPubkey = context.parsedCreq?.p2pkPubkey
      const prepared = await this.paymentOperator.prepareTokenSend({
        mintUrl,
        amount: selection.amount,
        ...(p2pkPubkey && { lockingCondition: { kind: 'P2PK', data: p2pkPubkey } }),
      })
      operationId = prepared.operationId

      txId = `tx-ecash-send-${crypto.randomUUID()}`
      const isRequestPayment = context.parsedCreq != null
      const directNostrAddress = getDirectNostrAddress(context)
      const initialDelivery = context.parsedCreq?.hasNostrTransport || context.parsedCreq?.hasPostTransport
        ? 'pending_publish' as const
        : 'not_required' as const
      const baseMetadata = {
        route: selection.route,
        operationId: prepared.operationId,
        ...(isRequestPayment && { intent: 'request-pay' }),
        ...(directNostrAddress && {
          counterpartyAddress: directNostrAddress.address,
          counterpartyAddressType: directNostrAddress.type,
        }),
        ...(prepared.fee > 0 && { fee: prepared.fee }),
      }
      await this.txRepo.save(createTransaction({
        id: txId,
        direction: 'send',
        method: 'cashu:ecash',
        protocol: 'cashu-token',
        amount: sat(selection.amount),
        accountId: mintUrl,
        memo: context.memo,
        outcome: 'unclaimed',
        ...(isRequestPayment && { intent: 'request-pay' as const }),
        ...(prepared.fee > 0 && { fee: { quoted: sat(prepared.fee) } }),
        metadata: baseMetadata,
      }))
      await this.outgoingLifecycle?.recordCreated({
        txId,
        kind: directNostrAddress ? 'direct-nostr-send' : 'token-create',
        accountId: mintUrl,
        amount: selection.amount,
        operationId: prepared.operationId,
        delivery: initialDelivery,
      })

      const { token } = await this.paymentOperator.executeTokenSend(prepared.operationId, {
        memo: context.memo,
      })
      await this.txRepo.update(txId, {
        metadata: {
          ...baseMetadata,
          token,
          tokenState: 'unspent',
        },
      })
      await this.outgoingLifecycle?.recordCreated({
        txId,
        kind: directNostrAddress ? 'direct-nostr-send' : 'token-create',
        accountId: mintUrl,
        amount: selection.amount,
        token,
        operationId: prepared.operationId,
        delivery: initialDelivery,
      })

      await this.routeStore.savePendingSendToken({
        id: txId,
        token,
        mintUrl,
        amount: selection.amount,
        operationId: prepared.operationId,
      })

      const deliveryResult = await this.delivery.deliverToken({
        token,
        parsedRequest: context.parsedCreq,
        memo: context.memo,
      })
      if (initialDelivery !== 'not_required') {
        await this.outgoingLifecycle?.recordDeliveryResult(
          txId,
          deliveryResult.success ? 'published' : 'failed',
        )
      }

      this.notifyChanged(mintUrl)

      return {
        success: deliveryResult.success,
        amount: selection.amount,
        fee: prepared.fee,
        sourceMintUrl: mintUrl,
        transactionId: txId,
        token,
        transportUsed: deliveryResult.transportUsed,
      }
    } catch (error) {
      if (operationId) {
        try { await this.paymentOperator.rollbackTokenSend(operationId) } catch { /* ignore */ }
      }
      if (txId) {
        await this.txRepo.update(txId, {
          status: 'failed',
          completedAt: Date.now(),
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            operationId,
          },
        }).catch(() => {})
      }
      throw error
    }
  }

  private async resolveInvoice(selection: RouteSelection, context: RouteContext): Promise<string | null> {
    if (selection.invoice) return selection.invoice

    const addressOrInvoice = context.addressOrInvoice
    if (!addressOrInvoice) return null

    if (this.tokenCodec.isBolt11(addressOrInvoice)) {
      const decoded = this.tokenCodec.decodeBolt11(addressOrInvoice)
      return decoded.isExpired ? null : addressOrInvoice
    }

    if (this.tokenCodec.isLightningAddress(addressOrInvoice)) {
      const params = await this.lnurl.resolvePay(addressOrInvoice)
      const result = await this.lnurl.fetchInvoice(params, selection.amount)
      return result.bolt11 ?? null
    }

    return addressOrInvoice
  }

  private notifyChanged(accountId: string): void {
    this.eventBus.emit({
      type: 'balance:changed',
      payload: { moduleId: 'cashu', accountId },
    })
    this.eventBus.emit({
      type: 'transactions:changed',
      payload: { reason: 'route-executed' },
    })
    this.syncNotifier?.notifyBalanceChanged()
  }
}

function isAlreadyRedeemedQuote(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return (
    message.includes('already pending') ||
    message.includes('already issued') ||
    message.includes('already redeemed')
  )
}

function toBaseError(error: unknown): BaseError {
  if (error instanceof BaseError) return error
  return new UnknownError(error instanceof Error ? error.message : String(error), error)
}

function getDirectNostrAddress(
  context: RouteContext,
): { address: string; type: 'npub' | 'nprofile' } | null {
  const address = context.addressOrInvoice?.trim()
  const lower = address?.toLowerCase()
  if (!address || !lower) return null
  if (!context.parsedCreq?.sameMintOnly || !context.parsedCreq.hasNostrTransport) return null
  if (lower.startsWith('npub1')) return { address, type: 'npub' }
  if (lower.startsWith('nprofile1')) return { address, type: 'nprofile' }
  return null
}
